//! dsh_relay — 简约对话引擎（zosma 移植）的 Rust 中继层
//!
//! 与 `agent-sidecar/`（Node 进程）走 stdin/stdout JSON 行协议：
//!   - stdout 事件流：`{"type":"event","event":<pi事件>}` 广播给当前 prompt 的
//!     `tauri::ipc::Channel`（前端 usePiStream 消费）；`done` 信封结束一轮；
//!   - 命令（send_prompt/abort/steer/follow_up/clear_queue/get_models/
//!     set_active_model/load_session）通过 stdin 下发，`result`/`error` 信封
//!     经 oneshot 回包。
//!
//! 与 acp.rs 同风格：std::process + 读线程（同步 IO），命令侧用
//! spawn_blocking 包住阻塞写，避免 tokio 子进程跨 await 持有锁的问题。

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct DshRelayState {
    pub stdin: Mutex<Option<ChildStdin>>,
    pub ready: Arc<AtomicBool>,
    /// 最近一次 ready 信封的 UNIX 秒（restart loop guard 判定"健康长跑"用；
    /// 每轮 spawn 前清零，只反映当前进程）
    pub last_ready_epoch: Arc<AtomicU64>,
    /// 当前 sidecar 进程 id（app 退出时杀进程树用）
    pub pid: Mutex<Option<u32>>,
}

pub struct PendingPrompt {
    pub channel: tauri::ipc::Channel<Value>,
}

pub struct PendingRequest {
    pub sender: tokio::sync::oneshot::Sender<Result<Value, String>>,
}

#[derive(Default)]
pub struct DshAppState {
    pub sidecar: DshRelayState,
    pub pending_prompts: Arc<Mutex<HashMap<String, PendingPrompt>>>,
    pub pending_requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
}

/// 便携运行时根目录：约定为 exe 同级的 runtime/（分享包结构见 scripts/build_portable.ps1）。
/// env MIRACH_RUNTIME_DIR 覆盖；不存在时返回 None（开发期走仓库相对路径回退）。
fn runtime_root() -> Option<std::path::PathBuf> {
    if let Ok(d) = std::env::var("MIRACH_RUNTIME_DIR") {
        if !d.is_empty() {
            return Some(std::path::PathBuf::from(d));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let portable = exe.parent()?.join("runtime");
    if portable.join("agent-sidecar").is_dir() {
        Some(portable)
    } else {
        None
    }
}

/// 侧边进程的 Node 可执行文件（dsh 运行时要求 Node ≥22.23.2，独立安装）。
/// 解析顺序：NODE_22_BIN env → 便携包 runtime/node/node.exe → D:\node.exe → 本机独立安装回退。
fn node_bin() -> String {
    if let Ok(b) = std::env::var("NODE_22_BIN") {
        if !b.is_empty() {
            return b;
        }
    }
    if let Some(root) = runtime_root() {
        let p = root.join("node").join("node.exe");
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    if std::path::Path::new("D:\\node.exe").exists() {
        return "D:\\node.exe".into();
    }
    "I:\\node-v22.23.2-win-x64\\node.exe".into()
}

/// agent-sidecar 目录：便携包 runtime/agent-sidecar 优先，开发期回退仓库相对路径。
fn sidecar_dir() -> std::path::PathBuf {
    if let Some(root) = runtime_root() {
        let p = root.join("agent-sidecar");
        if p.is_dir() {
            return p;
        }
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("agent-sidecar")
}

/// agent-sidecar 入口：dev 直接跑 src/index.ts（本机有 tsx）；生产打包时
/// 需要 bundle（当前阶段 dev 为主，路径缺失时错误会明确报出）。
fn sidecar_entry() -> String {
    sidecar_dir().join("src").join("index.ts").to_string_lossy().into_owned()
}

/// 启动 sidecar 子进程；返回 (child, stdout, stdin)。stdout 读线程随后接管。
/// stderr 单独起线程转发到 tauri dev 终端（sidecar 日志），同时避免 pipe 积压阻塞。
pub fn spawn_sidecar() -> Result<(Child, ChildStdout, ChildStdin), String> {
    let entry = sidecar_entry();
    let node = node_bin();
    let mut c = StdCommand::new(&node);
    c.arg("--import").arg("tsx").arg(&entry);
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // sidecar 内 tsx 从 agent-sidecar/node_modules 解析
    let sidecar_path = sidecar_dir();
    c.current_dir(&sidecar_path);
    c.env("SIDECAR_LOG_LEVEL", if cfg!(debug_assertions) { "debug" } else { "warn" });
    // 便携化：把 node/引擎路径显式传给 sidecar（覆盖其硬编码候选列表）
    c.env("DSH_NODE_BIN", &node);
    if let Some(root) = runtime_root() {
        let harness = root.join("deepseek-harness");
        if harness.is_dir() {
            c.env("DSH_HARNESS_ROOT", harness.to_string_lossy().into_owned());
        }
    }

    let mut child = c.spawn().map_err(|e| format!("sidecar spawn failed: {e}"))?;
    let stdin = child.stdin.take().ok_or("no sidecar stdin")?;
    let stdout = child.stdout.take().ok_or("no sidecar stdout")?;
    // stderr 转发：sidecar 日志可见 + 防 pipe 缓冲区写满阻塞 sidecar
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end();
                        if !trimmed.is_empty() {
                            eprintln!("[sidecar] {trimmed}");
                        }
                    }
                }
            }
        });
    }
    Ok((child, stdout, stdin))
}

/// UNIX 秒（restart loop guard 的时间戳）。
fn unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// stdout 读循环：ready/event/done/result/error 信封分派。
pub fn read_stdout(
    out: ChildStdout,
    pp: Arc<Mutex<HashMap<String, PendingPrompt>>>,
    pr: Arc<Mutex<HashMap<String, PendingRequest>>>,
    rd: Arc<AtomicBool>,
    lr: Arc<AtomicU64>,
    app: tauri::AppHandle,
) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(out);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let l = line.trim();
            if l.is_empty() {
                continue;
            }
            let m: Value = match serde_json::from_str(l) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match m.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "ready" => {
                    rd.store(true, Ordering::Release);
                    lr.store(unix_secs(), Ordering::Release);
                    let _ = app.emit("dsh_ready", m);
                }
                "event" => {
                    if let Some(e) = m.get("event") {
                        // queue_update 全局广播（前端 listen 用，与 prompt 流无关）
                        if let Some(t) = e.get("type").and_then(|v| v.as_str()) {
                            if t == "queue_update" {
                                let _ = app.emit("queue_update", e.clone());
                            }
                        }
                        // 有 runId 只发对应 prompt 的 channel（防多 prompt 混播）；
                        // 无 runId（question 桥等全局事件）广播给所有在途 channel
                        match m.get("runId").and_then(|v| v.as_str()) {
                            Some(rid) => {
                                let pp = pp.lock().unwrap();
                                if let Some(p) = pp.get(rid) {
                                    let _ = p.channel.send(e.clone());
                                }
                            }
                            None => {
                                for p in pp.lock().unwrap().values() {
                                    let _ = p.channel.send(e.clone());
                                }
                            }
                        }
                    }
                }
                "done" => {
                    if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                        if let Some(p) = pp.lock().unwrap().remove(id) {
                            let _ = p.channel.send(serde_json::json!({"type":"done"}));
                        }
                    }
                }
                "result" => {
                    if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                        if let Some(p) = pr.lock().unwrap().remove(id) {
                            let _ = p.sender.send(Ok(m.get("data").cloned().unwrap_or(Value::Null)));
                        }
                    }
                }
                "error" => {
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let t = m.get("message").and_then(|v| v.as_str()).unwrap_or("err");
                    eprintln!("[dsh_relay] sidecar error response id={id}: {t}");
                    if let Some(p) = pr.lock().unwrap().remove(id) {
                        let _ = p.sender.send(Err(t.into()));
                    } else if let Some(p) = pp.lock().unwrap().remove(id) {
                        // remove：错误信封后该 prompt 已终结，从表移除（防泄漏）
                        let _ = p.channel.send(serde_json::json!({"type":"error","message":t}));
                    }
                }
                _ => {}
            }
        }
        rd.store(false, Ordering::Release);
        let _ = app.emit("dsh_lost", ());
    });
}

/// 向 sidecar stdin 写一条 JSON 命令（阻塞写；命令函数已是 async，直接同步写即可）。
fn scmd_sync(s: &DshAppState, m: &Value) -> Result<(), String> {
    let mut guard = s.sidecar.stdin.lock().unwrap();
    let i = guard.as_mut().ok_or_else(|| "no sidecar".to_string())?;
    let l = format!("{}\n", serde_json::to_string(m).map_err(|e| e.to_string())?);
    i.write_all(l.as_bytes()).map_err(|e| e.to_string())?;
    i.flush().map_err(|e| e.to_string())
}

async fn scmd(s: &DshAppState, m: &Value) -> Result<(), String> {
    scmd_sync(s, m)
}

async fn scmd_r(s: &DshAppState, m: &Value, t: std::time::Duration) -> Result<Value, String> {
    let id = m.get("id").and_then(|v| v.as_str()).ok_or("no id")?.to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    s.pending_requests.lock().unwrap().insert(id.clone(), PendingRequest { sender: tx });
    // 所有早退路径（写失败/超时/取消/通道关闭）都必须先移除 pending 条目，
    // 否则 oneshot sender 与表项永久泄漏（成功路径由 result/error 信封移除）
    let drop_pending = |s: &DshAppState, id: &str| {
        s.pending_requests.lock().unwrap().remove(id);
    };
    if let Err(e) = scmd(s, m).await {
        drop_pending(s, &id);
        return Err(e);
    }
    let result: Value = match tokio::time::timeout(t, rx).await {
        Ok(Ok(Ok(v))) => v,
        Ok(Ok(Err(_))) => {
            drop_pending(s, &id);
            return Err("closed".to_string());
        }
        Ok(Err(_)) => {
            drop_pending(s, &id);
            return Err("recv cancelled".to_string());
        }
        Err(_) => {
            drop_pending(s, &id);
            return Err("timeout".to_string());
        }
    };
    Ok(result)
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{nanos:x}-{}", std::process::id())
}

// ── Tauri 命令 ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_prompt(text: String, ch: tauri::ipc::Channel<Value>, provider: Option<String>, model: Option<String>, s: State<'_, DshAppState>) -> Result<(), String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("p-{}", uuid_v4());
    s.pending_prompts.lock().unwrap().insert(id.clone(), PendingPrompt { channel: ch });
    let mut m = serde_json::json!({"type":"prompt","id":id,"text":text});
    if let Some(p) = provider {
        m["provider"] = serde_json::Value::String(p);
    }
    if let Some(mdl) = model {
        m["model"] = serde_json::Value::String(mdl);
    }
    if let Err(e) = scmd(&s, &m).await {
        // 写 stdin 失败（管道已断等）：回滚 pending 条目，否则死 channel 会
        // 接住之后所有无 runId 的全局广播，且表项滞留到 sidecar 死亡才清
        s.pending_prompts.lock().unwrap().remove(&id);
        return Err(e);
    }
    Ok(())
}

/// 同步设置页 providerConfig（自定义端点/模型/API key）给 sidecar。
/// 前端在挂载简约档/保存设置后调用；sidecar 合并进模型目录，
/// 自定义 baseURL/key 在 runtime 启动时注入 env。
#[tauri::command]
pub async fn sync_provider_config(configs: Vec<Value>, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"sync_provider_config","id":format!("spc-{}", uuid_v4()),"configs":configs}), std::time::Duration::from_secs(10)).await
}

#[tauri::command]
pub async fn abort_prompt(s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"abort","id":format!("ab-{}", uuid_v4())}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn steer_prompt(text: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"steer","id":format!("st-{}", uuid_v4()),"text":text}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn follow_up_prompt(text: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"follow_up","id":format!("fu-{}", uuid_v4()),"text":text}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn clear_queue(s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"clear_queue","id":format!("cq-{}", uuid_v4())}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn get_models(s: State<'_, DshAppState>) -> Result<Value, String> {
    scmd_r(&s, &serde_json::json!({"type":"get_models","id":format!("gm-{}", uuid_v4())}), std::time::Duration::from_secs(30))
        .await
        .map(|r| r.get("models").cloned().unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
pub async fn get_active_model(s: State<'_, DshAppState>) -> Result<Value, String> {
    scmd_r(&s, &serde_json::json!({"type":"get_active_model","id":format!("gam-{}", uuid_v4())}), std::time::Duration::from_secs(10)).await
}

#[tauri::command]
pub async fn set_active_model(provider: String, model: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    scmd_r(&s, &serde_json::json!({"type":"set_model","id":format!("sm-{}", uuid_v4()),"provider":provider,"model":model}), std::time::Duration::from_secs(10)).await
}

/// 切换 dsh 会话（前端左栏会话 ↔ dsh sessionId 映射）。
#[tauri::command]
pub async fn load_dsh_session(session_id: String, dsh_session_id: Option<String>, s: State<'_, DshAppState>) -> Result<Value, String> {
    // dsh_session_id：「所有会话」点开磁盘历史时直接采纳该 dsh 会话 id（不新建）
    let mut m = serde_json::json!({"type":"load_session","id":format!("ls-{}", uuid_v4()),"sessionId":session_id});
    if let Some(d) = dsh_session_id {
        m["dshSessionId"] = Value::String(d);
    }
    scmd_r(&s, &m, std::time::Duration::from_secs(10)).await
}

/// 读取指定前端会话的 dsh 历史（sidecar 读持久化日志回放；用于重启/切会话续聊）。
#[tauri::command]
pub async fn dsh_get_history(session_id: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"get_history","id":format!("gh-{}", uuid_v4()),"sessionId":session_id}), std::time::Duration::from_secs(10)).await
}

/// 设置推理强度（low/medium/high/max/off；重启运行时生效）。
#[tauri::command]
pub async fn dsh_set_effort(effort: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"set_effort","id":format!("se-{}", uuid_v4()),"effort":effort}), std::time::Duration::from_secs(10)).await
}

/// 切换工作环境（环境隔离）：envId 做会话映射命名空间，cwd 是引擎工作区
/// 根（同时决定 dsh 会话持久化的目录分组）。sidecar 只记录，切换后下一条
/// 消息触发 runtime 重启换到新工作区。
#[tauri::command]
pub async fn dsh_set_env(
    env_id: String,
    cwd: Option<String>,
    system_prompt: Option<String>,
    s: State<'_, DshAppState>,
) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    if env_id.trim().is_empty() {
        return Err("empty env_id".into());
    }
    // cwd 路径基本消毒：拒绝含控制字符的值（防 JSONL/配置注入）
    if let Some(c) = &cwd {
        if c.chars().any(|ch| ch.is_control()) {
            return Err("invalid cwd".into());
        }
    }
    if let Some(sp) = &system_prompt {
        if sp.chars().any(|ch| ch.is_control()) {
            return Err("invalid system_prompt".into());
        }
    }
    let payload =
        serde_json::json!({"type":"set_env","id":format!("env-{}", uuid_v4()),"envId":env_id.trim(),"cwd":cwd,"systemPrompt":system_prompt});
    scmd_r(&s, &payload, std::time::Duration::from_secs(5)).await
}

/// 通用 JSON-RPC 透传（反馈上报 / 工作流 / 交付物等 runtime 服务）。
/// 外层超时须大于 sidecar 内层（workflow.* 最长 5 分钟）。
#[tauri::command]
pub async fn dsh_rpc(method: String, params: Option<Value>, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(
        &s,
        &serde_json::json!({"type":"rpc","id":format!("rpc-{}", uuid_v4()),"method":method,"params":params}),
        std::time::Duration::from_secs(320),
    )
    .await
}

/// 列出 dsh 持久化会话（sidecar 扫 DSH_SESSION_ROOT）。
#[tauri::command]
pub async fn dsh_list_sessions(s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"list_sessions","id":format!("lss-{}", uuid_v4())}), std::time::Duration::from_secs(10)).await
}

/// sidecar 是否就绪（前端启动时探测）。
#[tauri::command]
pub fn dsh_sidecar_ready(s: State<'_, DshAppState>) -> bool {
    s.sidecar.ready.load(Ordering::Acquire)
}

/// 在 setup 中启动 sidecar 并注册 stdout 读线程。
/// sidecar 退出后自动重建（崩溃自愈）：重 spawn + 换 stdin + 起新读循环；
/// ready 仅由 sidecar 的 ready 信封置位（避免"spawn 即 ready"竞态）。
pub fn setup_sidecar(app: &tauri::AppHandle, st: DshAppState) {
    let pp = st.pending_prompts.clone();
    let pr = st.pending_requests.clone();
    let rd = st.sidecar.ready.clone();
    let lr = st.sidecar.last_ready_epoch.clone();
    app.manage(st);
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        // 崩溃自愈退避：连续失败按 2^n 秒增长、封顶 30s。
        // Restart loop guard（对照 Hermes restart_loop_guard 语义）：固定窗口内
        // 崩溃达阈值 → 进入"响亮失败态"——停止快 respawn、拉长冷却并显著告警，
        // 防止确定性崩溃（坏配置/坏产物/端口占用）变成秒级无限循环。
        // 健康长跑（ready 且存活超 HEALTHY_SECS）清零窗口并恢复正常自愈节奏。
        // 旧实现的两处缺陷一并修复：spawn 成功即重置退避（秒退型崩溃退化成
        // ~1s 循环）改为健康长跑才重置；崩溃永不封顶改为有界 + 可见。
        const WINDOW_SECS: u64 = 600;
        const THRESHOLD: usize = 5;
        const SUSPEND_COOLDOWN_SECS: u64 = 300;
        const HEALTHY_SECS: u64 = 60;
        let mut backoff_secs: u64 = 1;
        let mut crash_times: Vec<u64> = Vec::new();
        let mut suspended = false;
        loop {
            // 本轮进程的 ready 时刻从零计：上一进程的旧值不许污染健康判定
            lr.store(0, Ordering::Release);
            match spawn_sidecar() {
                Ok((mut c, o, i)) => {
                    let s: State<DshAppState> = h.state();
                    *s.sidecar.stdin.lock().unwrap() = Some(i);
                    *s.sidecar.pid.lock().unwrap() = Some(c.id());
                    rd.store(false, Ordering::Release); // 等 ready 信封再置位
                    let pid = c.id();
                    read_stdout(o, pp.clone(), pr.clone(), rd.clone(), lr.clone(), h.clone());
                    match c.wait() {
                        Ok(status) => eprintln!("[dsh_relay] sidecar pid={pid} EXITED: {status:?} — respawning"),
                        Err(e) => eprintln!("[dsh_relay] sidecar pid={pid} wait error: {e} — respawning"),
                    }
                    *h.state::<DshAppState>().sidecar.pid.lock().unwrap() = None;
                    let _ = h.emit("dsh_lost", ());
                    // sidecar 死亡后无法回包：清掉所有 pending，避免前端永久等待
                    fail_pending_sidecar(&h.state::<DshAppState>(), "sidecar exited");
                }
                Err(e) => {
                    eprintln!("[dsh_relay] sidecar spawn failed: {e}");
                }
            }
            // —— restart loop guard 记账（spawn 失败 / 秒退 / 长跑后崩溃统一处理）——
            let now = unix_secs();
            let ready_at = lr.load(Ordering::Acquire);
            if ready_at > 0 && now.saturating_sub(ready_at) > HEALTHY_SECS {
                // 健康长跑后的崩溃 = 偶发：清零窗口、恢复快自愈节奏
                crash_times.clear();
                backoff_secs = 1;
                if suspended {
                    suspended = false;
                    eprintln!("[dsh_relay] restart loop guard: stable run detected — normal respawn restored");
                    let _ = h.emit(
                        "dsh_sidecar_suspended",
                        serde_json::json!({"resumed": true}),
                    );
                }
            }
            crash_times.retain(|t| now.saturating_sub(*t) < WINDOW_SECS);
            crash_times.push(now);
            let count = crash_times.len();
            let delay = if count >= THRESHOLD {
                if !suspended {
                    suspended = true;
                    eprintln!(
                        "[dsh_relay] restart loop guard: {count} crashes within {WINDOW_SECS}s — suspending fast respawn (cooldown {SUSPEND_COOLDOWN_SECS}s)"
                    );
                    let _ = h.emit(
                        "dsh_sidecar_suspended",
                        serde_json::json!({
                            "resumed": false,
                            "crashes": count,
                            "windowSecs": WINDOW_SECS,
                            "cooldownSecs": SUSPEND_COOLDOWN_SECS
                        }),
                    );
                }
                SUSPEND_COOLDOWN_SECS
            } else if suspended {
                // 已在抑制态但尚未出现健康长跑：维持冷却节奏
                SUSPEND_COOLDOWN_SECS
            } else {
                let d = backoff_secs;
                backoff_secs = (backoff_secs * 2).min(30);
                d
            };
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        }
    });
}

/// app 退出时终止 sidecar 进程树：Node 存活时不因 stdin EOF 退出会留下孤儿
/// node.exe + dsh runtime 孙进程。Windows 用 taskkill /T 连树杀。
pub fn shutdown_sidecar(app: &tauri::AppHandle) {
    let s = app.state::<DshAppState>();
    s.sidecar.ready.store(false, Ordering::Release);
    *s.sidecar.stdin.lock().unwrap() = None;
    let pid = match s.sidecar.pid.lock().unwrap().take() {
        Some(p) => p,
        None => return,
    };
    #[cfg(target_os = "windows")]
    {
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = StdCommand::new("kill").arg("-9").arg(pid.to_string()).status();
    }
    eprintln!("[dsh_relay] sidecar pid={pid} killed on app exit");
}

/// sidecar 死亡：所有在途 pending 请求/对话补发错误收尾（防前端永久等待 + 表泄漏）。
fn fail_pending_sidecar(s: &DshAppState, msg: &str) {
    let mut pr = s.pending_requests.lock().unwrap();
    for (_, p) in pr.drain() {
        let _ = p.sender.send(Err(msg.to_string()));
    }
    drop(pr);
    let mut pp = s.pending_prompts.lock().unwrap();
    for (_, p) in pp.drain() {
        let _ = p.channel.send(serde_json::json!({"type":"error","message":msg}));
    }
}

// ── 窗口最大化（系统命令路径） ────────────────────────────────────────────
//
// 实测结论（本机）：tao 的 set_maximized（JS toggleMaximize）与 SetWindowPos
// 自管边界两种方式在 decorations:false+transparent 窗口上都会"闪一下回原样"；
// 唯一稳定的是系统命令 WM_SYSCOMMAND SC_MAXIMIZE/SC_RESTORE（Windows 自己维护
// 还原边界与任务栏排除）。用 GetWindowPlacement 判定当前态。

#[tauri::command]
pub fn toggle_main_maximize(app: tauri::AppHandle) -> Result<bool, String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SendMessageW, SC_MAXIMIZE, SC_RESTORE, SW_SHOWMAXIMIZED,
        WINDOWPLACEMENT, WM_SYSCOMMAND,
    };
    use windows::Win32::Foundation::{LPARAM, WPARAM};

    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let hwnd = win.hwnd().map_err(|e| e.to_string())?;

    let mut plc = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    unsafe {
        GetWindowPlacement(hwnd, &mut plc).map_err(|e| e.to_string())?;
    }
    let maximized = plc.showCmd == SW_SHOWMAXIMIZED.0 as u32;
    eprintln!("[maximize] entry: showCmd={} maximized={}", plc.showCmd, maximized);
    let cmd = if maximized { SC_RESTORE } else { SC_MAXIMIZE };
    unsafe {
        SendMessageW(hwnd, WM_SYSCOMMAND, Some(WPARAM(cmd as usize)), Some(LPARAM(0)));
    }
    // 采样线程：观察发送后窗口矩形演化（定位回弹时机）
    let hwnd_val = hwnd.0 as isize;
    std::thread::spawn(move || {
        use windows::Win32::Foundation::{HWND, RECT};
        let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
        let mut prev: u64 = 0;
        for ms in [200u64, 600, 1500, 3000] {
            std::thread::sleep(std::time::Duration::from_millis(ms - prev));
            prev = ms;
            let mut r = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut r) }.is_ok() {
                eprintln!("[maximize] t+{}ms rect = {}x{} at {},{}", ms, r.right - r.left, r.bottom - r.top, r.left, r.top);
            }
        }
    });
    Ok(!maximized)
}
