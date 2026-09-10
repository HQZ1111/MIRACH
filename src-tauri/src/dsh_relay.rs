//! dsh_relay — 简约对话引擎（zosma 移植）的 Rust 中继层
//!
//! 与 `agent-sidecar/`（Node 进程）走 stdin/stdout JSON 行协议：
//!   - stdout 事件流：`{"type":"event","event":<pi事件>}` 广播给当前 prompt 的
//!     `tauri::ipc::Channel`（前端 usePiStream 消费）；`done` 信封结束一轮；
//!   - 命令（send_prompt/abort/steer/follow_up/clear_queue/get_models/
//!     set_active_model/load_session）通过 stdin 下发，`result`/`error` 信封
//!     经 oneshot 回包。
//!
//! 进程模型：std::process + 独立 stdout 读线程 + 独立 stdin 写线程（同步 IO，
//! 命令侧永不因管道写阻塞 tokio worker）；sidecar 进程加入 Windows Job Object
//! （KILL_ON_JOB_CLOSE），应用退出（含被强杀）时整棵进程树一并结束。

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct DshRelayState {
    /// 写线程入队端（真正的 ChildStdin 由写线程持有；断开此 sender = 关闭 stdin）
    pub stdin_tx: Mutex<Option<SyncSender<Vec<u8>>>>,
    pub ready: Arc<AtomicBool>,
    /// 引擎 runtime 就绪（prewarm/prompt 首次成功后置位；对齐 hermes
    /// "后端 ready 才算连接"语义——sidecar 进程存活 ≠ 引擎可服务）。
    pub engine_ready: Arc<AtomicBool>,
    /// 最近一次 ready 信封的 UNIX 秒（restart loop guard 判定"健康长跑"用；
    /// 每轮 spawn 前清零，只反映当前进程）
    pub last_ready_epoch: Arc<AtomicU64>,
    /// 当前 sidecar 进程 id（app 退出时杀进程树用）
    pub pid: Mutex<Option<u32>>,
    /// sidecar 代际号：每轮 spawn 自增；旧代际的读线程不得改写 ready/发 dsh_lost
    pub epoch: Arc<AtomicU64>,
    /// app 退出标志：置位后重启循环不再 spawn 新进程
    pub shutdown: Arc<AtomicBool>,
    /// Windows Job Object 句柄（isize 存值以保持 Send/Sync）；关闭即杀掉整棵树
    #[cfg(target_os = "windows")]
    pub job: Mutex<Option<isize>>,
}

pub struct PendingPrompt {
    pub channel: tauri::ipc::Channel<Value>,
    /// 入队时刻（TTL 清理用；引擎挂死时不让表项永久滞留）
    pub created: std::time::Instant,
}

pub struct PendingRequest {
    pub sender: tokio::sync::oneshot::Sender<Result<Value, String>>,
}

#[derive(Default)]
pub struct DshAppState {
    pub sidecar: DshRelayState,
    pub pending_prompts: Arc<Mutex<HashMap<String, PendingPrompt>>>,
    pub pending_requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
    /// 内核 Remote 逻辑流 id → IPC Channel（sidecar 的 mux 帧经此回流前端；
    /// 官方 __DSH_TRANSPORT__.openStream 的宿主侧接收端）
    pub mux_channels: Arc<Mutex<HashMap<String, tauri::ipc::Channel<Value>>>>,
}

/// 便携运行时根目录：exe 同级 runtime/，或 env MIRACH_RUNTIME_DIR 指定。
/// （"便携版"语义只认这两种；应用内安装的运行时不算便携，见 installed_runtime_root）
fn portable_runtime_root() -> Option<std::path::PathBuf> {
    if let Ok(d) = std::env::var("MIRACH_RUNTIME_DIR") {
        if !d.is_empty() {
            return Some(std::path::PathBuf::from(d));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let portable = exe.parent()?.join("runtime");
    if portable.join("agent-sidecar").is_dir() {
        return Some(portable);
    }
    None
}

/// 应用内安装的运行时根（首次启动安装器写入 %LOCALAPPDATA%\MirachRuntime）。
fn installed_runtime_root() -> Option<std::path::PathBuf> {
    let installed = crate::bootstrap::install_root();
    if installed.join("agent-sidecar").is_dir() {
        return Some(installed);
    }
    None
}

/// 运行时根目录（便携 → 应用内安装 → 都没有则 None，开发期走仓库相对路径回退）。
/// 调试构建始终不认"应用内安装"：否则首次安装过运行时的开发机会一直跑
/// %LOCALAPPDATA% 里的旧副本，本地改动不生效（便携目录仍然优先，供便携调试）。
fn runtime_root() -> Option<std::path::PathBuf> {
    if let Some(p) = portable_runtime_root() {
        return Some(p);
    }
    if cfg!(debug_assertions) {
        return None;
    }
    installed_runtime_root()
}

/// 运行时是否可用（便携布局 / 应用内安装 / 开发仓库三选一）。
/// 安装门用它判断"要不要走首次安装流程"。
pub fn sidecar_available() -> bool {
    if runtime_root().is_some() {
        return true;
    }
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("agent-sidecar").join("dist").join("index.js"));
    dev.map(|p| p.is_file()).unwrap_or(false)
}

/// 便携包运行判定（exe 同级有 runtime/ 或 MIRACH_RUNTIME_DIR 指向它）。
/// 便携版与安装版共用一套代码，但"自更新"语义不同（安装器只含外壳）。
/// 注意：应用内安装（%LOCALAPPDATA%）不算便携版 —— 那种情况走正常更新器。
pub fn is_portable_runtime() -> bool {
    portable_runtime_root().is_some()
}

/// 侧边进程的 Node 可执行文件（dsh 运行时要求 Node ≥22.23.2，独立安装）。
/// 解析顺序：NODE_22_BIN env → 便携包 runtime/node/node.exe → 开发机固定路径
/// （告警提示）→ PATH 里的 node。
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
    for candidate in ["D:\\node.exe", "I:\\node-v22.23.2-win-x64\\node.exe"] {
        if std::path::Path::new(candidate).exists() {
            eprintln!(
                "[dsh_relay] WARNING: 使用开发机固定 node 路径 {candidate}；便携包请提供 runtime/node/node.exe 或设置 NODE_22_BIN"
            );
            return candidate.into();
        }
    }
    "node".into()
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

/// agent-sidecar 入口与运行方式。
/// 解析顺序：`MIRACH_SIDECAR_ENTRY` 显式指定 → 发布构建优先预编译产物
/// `dist/index.js`（不依赖 tsx）→ 开发回退 `src/index.ts` + `--import tsx`。
/// 返回 (入口文件, 是否需要 tsx 加载器)。
fn sidecar_entry() -> (std::path::PathBuf, bool) {
    if let Ok(p) = std::env::var("MIRACH_SIDECAR_ENTRY") {
        if !p.is_empty() {
            let pb = std::path::PathBuf::from(&p);
            let needs_tsx = pb.extension().and_then(|e| e.to_str()) == Some("ts");
            return (pb, needs_tsx);
        }
    }
    let dir = sidecar_dir();
    if !cfg!(debug_assertions) {
        let dist = dir.join("dist").join("index.js");
        if dist.is_file() {
            return (dist, false);
        }
        eprintln!(
            "[dsh_relay] WARNING: 发布构建未找到 agent-sidecar/dist/index.js（{}），回退 TS 源需要 tsx",
            dist.display()
        );
    }
    (dir.join("src").join("index.ts"), true)
}

// ── 远程引擎（SSH）────────────────────────────────────────────────────────
//
// 远程模式 = sidecar 进程跑在远端主机上，本地用 `ssh -T <host> <node> <sidecar>`
// 当子进程。JSONL 协议直接走 ssh 的 stdin/stdout；引擎的 stdio 与 web 面
// （/api、remote.mux）都在远端 sidecar 内部完成，无需隧道。

/// 远端参数校验：拒绝会被远端 shell 解释的字符（配置来自本机用户，仍做纵深防御）。
fn validate_remote_token(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{label} 为空"));
    }
    if value.len() > 512 {
        return Err(format!("{label} 过长"));
    }
    if value
        .chars()
        .any(|c| c.is_control() || matches!(c, '"' | '\'' | '`' | '$' | ';' | '&' | '|' | '<' | '>'))
    {
        return Err(format!("{label} 含非法字符: {value}"));
    }
    Ok(())
}

/// 远端命令里的路径引用：含空格时加双引号（cmd 与 POSIX shell 都接受）。
fn quote_remote(token: &str) -> String {
    if token.contains(' ') {
        format!("\"{token}\"")
    } else {
        token.to_string()
    }
}

/// ssh 基础参数（spawn 与连通性测试共用）。
fn ssh_base_args(host: &str, port: &str, identity: &str) -> Result<Vec<String>, String> {
    validate_remote_token("remoteHost", host.trim())?;
    if !port.trim().is_empty() && !port.trim().chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("remotePort 非法: {port}"));
    }
    if !identity.trim().is_empty() {
        validate_remote_token("remoteIdentity", identity.trim())?;
    }
    let mut args = vec!["-T".to_string()];
    if !port.trim().is_empty() && port.trim() != "22" {
        args.push("-p".into());
        args.push(port.trim().into());
    }
    if !identity.trim().is_empty() {
        args.push("-i".into());
        args.push(identity.trim().into());
    }
    for opt in ["BatchMode=yes", "ServerAliveInterval=30", "ConnectTimeout=10"] {
        args.push("-o".into());
        args.push(opt.into());
    }
    args.push(host.trim().to_string());
    Ok(args)
}

/// 远程 sidecar 的完整 ssh 参数；未启用/配置无效返回 None（回退本地）。
fn remote_ssh_args(cfg: &crate::AppConfig) -> Option<Vec<String>> {
    if !cfg.remote_enabled {
        return None;
    }
    let build = || -> Result<Vec<String>, String> {
        validate_remote_token("remoteSidecar", cfg.remote_sidecar.trim())?;
        validate_remote_token("remoteNode", cfg.remote_node.trim())?;
        let mut args = ssh_base_args(&cfg.remote_host, &cfg.remote_port, &cfg.remote_identity)?;
        args.push(format!(
            "{} {}",
            quote_remote(cfg.remote_node.trim()),
            quote_remote(cfg.remote_sidecar.trim())
        ));
        Ok(args)
    };
    match build() {
        Ok(args) => Some(args),
        Err(e) => {
            eprintln!("[dsh_relay] 远程引擎配置无效（回退本地 sidecar）：{e}");
            None
        }
    }
}

/// 连通性测试：`ssh … <node> --version`（不启动 sidecar，不占用协议通道）。
#[tauri::command]
pub async fn ssh_test(
    host: String,
    port: String,
    identity: String,
    node: String,
    sidecar: String,
) -> Result<String, String> {
    validate_remote_token("remoteSidecar", sidecar.trim())?;
    validate_remote_token("remoteNode", node.trim())?;
    let mut args = ssh_base_args(&host, &port, &identity)?;
    args.push(format!("{} --version", quote_remote(node.trim())));
    let output = tauri::async_runtime::spawn_blocking(move || StdCommand::new("ssh").args(&args).output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("无法启动 ssh（Windows 需自带 OpenSSH 客户端）: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .trim()
    .to_string();
    if output.status.success() {
        Ok(if text.is_empty() { "连接成功（node --version 无输出）".into() } else { text })
    } else if text.is_empty() {
        Err(format!("ssh 退出码 {:?}", output.status.code()))
    } else {
        Err(text)
    }
}

/// 重启 sidecar：杀掉当前进程，supervisor 会按最新配置重新拉起
/// （远程/本地模式切换、远端路径修正后调用）。
#[tauri::command]
pub fn dsh_restart_sidecar(s: State<'_, DshAppState>) -> Result<(), String> {
    let pid = *s.sidecar.pid.lock().unwrap();
    match pid {
        Some(p) => {
            kill_tree(p);
            eprintln!("[dsh_relay] sidecar pid={p} restarted by user request");
            Ok(())
        }
        None => Err("sidecar 未在运行".into()),
    }
}

/// 启动 sidecar 子进程；返回 (child, stdout, stdin)。stdout 读线程随后接管。
/// stderr 单独起线程转发到 tauri dev 终端（sidecar 日志），同时避免 pipe 积压阻塞。
/// 远程模式（配置 remoteEnabled）改为 `ssh -T <host> <node> <remoteSidecar>`。
pub fn spawn_sidecar() -> Result<(Child, ChildStdout, ChildStdin), String> {
    let cfg = crate::load_config();
    let remote_args = remote_ssh_args(&cfg);
    let is_remote = remote_args.is_some();
    let mut c = if let Some(args) = remote_args {
        eprintln!(
            "[dsh_relay] remote sidecar: ssh {} → {} {}",
            cfg.remote_host, cfg.remote_node, cfg.remote_sidecar
        );
        let mut c = StdCommand::new("ssh");
        c.args(&args);
        c
    } else {
        let (entry, needs_tsx) = sidecar_entry();
        let node = node_bin();
        eprintln!(
            "[dsh_relay] local sidecar entry={} tsx={} node={}",
            entry.display(),
            needs_tsx,
            node
        );
        let mut c = StdCommand::new(&node);
        if needs_tsx {
            c.arg("--import").arg("tsx");
        }
        c.arg(&entry);
        c
    };
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if !is_remote {
        // 本机路径/端口环境只对本地 sidecar 有意义（远端由远端环境决定）
        c.current_dir(sidecar_dir());
        c.env("SIDECAR_LOG_LEVEL", if cfg!(debug_assertions) { "debug" } else { "warn" });
        // 便携化：把 node/引擎路径显式传给 sidecar（覆盖其硬编码候选列表）
        c.env("DSH_NODE_BIN", node_bin());
        // 应用内安装的引擎入口优先（SDK 依赖里带下来的 dsh 包）
        let engine = crate::bootstrap::installed_engine_bin();
        if engine.is_file() {
            c.env("MIRACH_DSH_BIN", engine.to_string_lossy().into_owned());
        }
        // 手机接入：核心 web 面监听地址由配置驱动（webHost：127.0.0.1 / 0.0.0.0）
        c.env("MIRACH_WEB_HOST", cfg.web_host.clone());
        if let Some(root) = runtime_root() {
            let harness = root.join("deepseek-harness");
            if harness.is_dir() {
                c.env("DSH_HARNESS_ROOT", harness.to_string_lossy().into_owned());
            }
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

/// 进程内唯一 id（nanos + 单调计数器）。纯 nanos 在 Windows 时钟粒度下会同 tick 碰撞。
fn next_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// 杀掉 sidecar 进程树（Node 存活时不因 stdin EOF 退出会留下 node + dsh 孙进程）。
fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = StdCommand::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

/// stdin 写线程：独占 ChildStdin 逐条写出。命令侧只往有界队列 try_send，
/// 不因管道满/对端不读而阻塞 tokio worker；sender 全部 drop 时线程退出并关闭 stdin。
fn start_stdin_writer(mut stdin: ChildStdin) -> SyncSender<Vec<u8>> {
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(1024);
    std::thread::spawn(move || {
        while let Ok(line) = rx.recv() {
            if stdin.write_all(&line).is_err() || stdin.flush().is_err() {
                break;
            }
        }
    });
    tx
}

/// 日志脱敏：截断 + 掩掉常见密钥形态（provider 错误常回显 key）。
fn redact_secrets(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for word in s.split_inclusive(|c: char| c.is_whitespace() || c == ',' || c == '"' || c == '\'') {
        let core = word.trim_end_matches(|c: char| c.is_whitespace() || c == ',' || c == '"' || c == '\'');
        let keyish = core.starts_with("sk-")
            || core.starts_with("sk_")
            || (core.len() >= 32
                && core.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        if keyish {
            out.push_str("[redacted]");
        } else {
            out.push_str(core);
        }
        out.push_str(&word[core.len()..]);
    }
    out.chars().take(240).collect()
}

/// stdout 读循环：ready/event/done/result/error 信封分派。
/// `gen` 是本进程代际号：只有当前代际的读线程才允许改写 ready / 杀进程
/// （避免旧进程的读线程在新进程就绪后清掉 ready，造成永久"未就绪"）。
pub fn read_stdout(
    out: ChildStdout,
    pp: Arc<Mutex<HashMap<String, PendingPrompt>>>,
    pr: Arc<Mutex<HashMap<String, PendingRequest>>>,
    mc: Arc<Mutex<HashMap<String, tauri::ipc::Channel<Value>>>>,
    rd: Arc<AtomicBool>,
    er: Arc<AtomicBool>,
    lr: Arc<AtomicU64>,
    epoch: Arc<AtomicU64>,
    gen: u64,
    pid: u32,
    app: tauri::AppHandle,
) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(out);
        let mut buf: Vec<u8> = Vec::new();
        loop {
            buf.clear();
            // 按字节读行：非法 UTF-8 只影响该行（lossy 解码），不再让整条通道退出
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let line = String::from_utf8_lossy(&buf);
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
                        // 引擎对某个 prompt 产出事件 = runtime 真在服务（就绪证据）
                        if m.get("runId").is_some() {
                            er.store(true, Ordering::Release);
                        }
                        // queue_update 全局广播（前端 listen 用，与 prompt 流无关）
                        if let Some(t) = e.get("type").and_then(|v| v.as_str()) {
                            if t == "queue_update" {
                                let _ = app.emit("queue_update", e.clone());
                            }
                        }
                        // 有 runId 只发对应 prompt 的 channel（防多 prompt 混播）；
                        // 无 runId（question 桥等全局事件）广播给所有在途 channel
                        // （Channel 先克隆出锁再 send，避免持锁做 IPC）
                        match m.get("runId").and_then(|v| v.as_str()) {
                            Some(rid) => {
                                let ch = pp.lock().unwrap().get(rid).map(|p| p.channel.clone());
                                if let Some(c) = ch {
                                    let _ = c.send(e.clone());
                                }
                            }
                            None => {
                                let chans: Vec<_> =
                                    pp.lock().unwrap().values().map(|p| p.channel.clone()).collect();
                                for c in chans {
                                    let _ = c.send(e.clone());
                                }
                            }
                        }
                    }
                }
                "done" => {
                    if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                        let p = pp.lock().unwrap().remove(id);
                        if let Some(p) = p {
                            let _ = p.channel.send(serde_json::json!({"type":"done"}));
                        }
                    }
                }
                "result" => {
                    if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                        let p = pr.lock().unwrap().remove(id);
                        if let Some(p) = p {
                            let _ = p.sender.send(Ok(m.get("data").cloned().unwrap_or(Value::Null)));
                        }
                    }
                }
                "error" => {
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let t = m.get("message").and_then(|v| v.as_str()).unwrap_or("err");
                    eprintln!("[dsh_relay] sidecar error response id={id}: {}", redact_secrets(t));
                    let t = t.to_string();
                    if let Some(p) = pr.lock().unwrap().remove(id) {
                        let _ = p.sender.send(Err(t));
                    } else if let Some(p) = pp.lock().unwrap().remove(id) {
                        // remove：错误信封后该 prompt 已终结，从表移除（防泄漏）
                        let _ = p.channel.send(serde_json::json!({"type":"error","message":t}));
                    }
                }
                "mux" => {
                    // 内核 Remote 流帧：按逻辑流 id 定向投递到前端 Channel。
                    // 页面重载后旧 Channel 已失效（send 报错）→ 顺手回收表项。
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let frame = m.get("frame").cloned().unwrap_or(Value::Null);
                    let chan = mc.lock().unwrap().get(id).cloned();
                    if let Some(c) = chan {
                        if c.send(frame).is_err() {
                            mc.lock().unwrap().remove(id);
                        }
                    }
                }
                "mux_close" => {
                    // 载体断开：投递哨兵帧并回收 Channel（前端转 carrier 失败）
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let reason = m.get("reason").and_then(|v| v.as_str()).unwrap_or("mux closed");
                    let chan = mc.lock().unwrap().remove(id);
                    if let Some(c) = chan {
                        let _ = c.send(serde_json::json!({"type": "__mirach_close", "reason": reason}));
                    }
                }
                _ => {}
            }
        }
        // 读线程退出：只有当前代际能改状态；进程若仍存活则杀掉，让 supervisor 的
        // wait 返回并走重启流程（否则"进程活着但 stdout 已死"会永久卡住）。
        if epoch.load(Ordering::Acquire) == gen {
            rd.store(false, Ordering::Release);
            er.store(false, Ordering::Release);
            kill_tree(pid);
        }
    });
}

/// 向 sidecar stdin 写一条 JSON 命令（有界队列，非阻塞；实际写出由写线程负责）。
fn scmd_sync(s: &DshAppState, m: &Value) -> Result<(), String> {
    let line = format!("{}\n", serde_json::to_string(m).map_err(|e| e.to_string())?);
    let guard = s.sidecar.stdin_tx.lock().unwrap();
    let tx = guard.as_ref().ok_or_else(|| "no sidecar".to_string())?;
    tx.try_send(line.into_bytes()).map_err(|e| match e {
        TrySendError::Full(_) => "sidecar stdin backlog full".to_string(),
        TrySendError::Disconnected(_) => "no sidecar".to_string(),
    })
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
    if let Err(e) = scmd_sync(s, m) {
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

// ── Tauri 命令 ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_prompt(text: String, ch: tauri::ipc::Channel<Value>, provider: Option<String>, model: Option<String>, s: State<'_, DshAppState>) -> Result<(), String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("p-{}", next_id());
    s.pending_prompts.lock().unwrap().insert(
        id.clone(),
        PendingPrompt {
            channel: ch,
            created: std::time::Instant::now(),
        },
    );
    let mut m = serde_json::json!({"type":"prompt","id":id,"text":text});
    if let Some(p) = provider {
        m["provider"] = serde_json::Value::String(p);
    }
    if let Some(mdl) = model {
        m["model"] = serde_json::Value::String(mdl);
    }
    if let Err(e) = scmd_sync(&s, &m) {
        // 写 stdin 失败（管道已断等）：回滚 pending 条目，否则死 channel 会
        // 接住之后所有无 runId 的全局广播，且表项滞留到 sidecar 死亡才清
        s.pending_prompts.lock().unwrap().remove(&id);
        return Err(e);
    }
    // 注意：此处不置 engine_ready —— 写入管道成功 ≠ 引擎在服务。
    // 引擎就绪只由 sidecar 的 prewarm 回包 / 带 runId 的引擎事件置位。
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
    scmd_r(&s, &serde_json::json!({"type":"sync_provider_config","id":format!("spc-{}", next_id()),"configs":configs}), std::time::Duration::from_secs(10)).await
}

#[tauri::command]
pub async fn abort_prompt(s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"abort","id":format!("ab-{}", next_id())}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn steer_prompt(text: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"steer","id":format!("st-{}", next_id()),"text":text}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn follow_up_prompt(text: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"follow_up","id":format!("fu-{}", next_id()),"text":text}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn clear_queue(s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"clear_queue","id":format!("cq-{}", next_id())}), std::time::Duration::from_secs(5)).await
}

#[tauri::command]
pub async fn get_models(s: State<'_, DshAppState>) -> Result<Value, String> {
    scmd_r(&s, &serde_json::json!({"type":"get_models","id":format!("gm-{}", next_id())}), std::time::Duration::from_secs(30))
        .await
        .map(|r| r.get("models").cloned().unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
pub async fn get_active_model(s: State<'_, DshAppState>) -> Result<Value, String> {
    scmd_r(&s, &serde_json::json!({"type":"get_active_model","id":format!("gam-{}", next_id())}), std::time::Duration::from_secs(10)).await
}

#[tauri::command]
pub async fn set_active_model(provider: String, model: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    scmd_r(&s, &serde_json::json!({"type":"set_model","id":format!("sm-{}", next_id()),"provider":provider,"model":model}), std::time::Duration::from_secs(10)).await
}

/// 切换 dsh 会话（前端左栏会话 ↔ dsh sessionId 映射）。
#[tauri::command]
pub async fn load_dsh_session(session_id: String, dsh_session_id: Option<String>, s: State<'_, DshAppState>) -> Result<Value, String> {
    // dsh_session_id：「所有会话」点开磁盘历史时直接采纳该 dsh 会话 id（不新建）
    let mut m = serde_json::json!({"type":"load_session","id":format!("ls-{}", next_id()),"sessionId":session_id});
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
    scmd_r(&s, &serde_json::json!({"type":"get_history","id":format!("gh-{}", next_id()),"sessionId":session_id}), std::time::Duration::from_secs(10)).await
}

/// 设置推理强度（low/medium/high/max/off；重启运行时生效）。
#[tauri::command]
pub async fn dsh_set_effort(effort: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"set_effort","id":format!("se-{}", next_id()),"effort":effort}), std::time::Duration::from_secs(10)).await
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
        serde_json::json!({"type":"set_env","id":format!("env-{}", next_id()),"envId":env_id.trim(),"cwd":cwd,"systemPrompt":system_prompt});
    scmd_r(&s, &payload, std::time::Duration::from_secs(5)).await
}

/// 允许经 dsh_rpc 下发的方法白名单（前端实际使用的全部方法 + workflow 长任务）。
/// 防止 webview 注入脚本借引擎会话凭据调用任意 RPC（confused deputy）。
fn rpc_method_allowed(method: &str) -> bool {
    const EXACT: [&str; 18] = [
        "config.pluginEntries",
        "plugins.list",
        "plugins.install",
        "plugins.uninstall",
        "subagent.status",
        "subagent.enable",
        "subagent.disable",
        "update.check",
        "update.engine",
        "session/fork",
        "agentPresets.select",
        "session.map.get",
        "commands.execute",
        "session.modelCatalog",
        "session.selectModel",
        "settings.describe",
        "messageFeedback.put",
        "schedule.list",
    ];
    EXACT.contains(&method) || method.starts_with("workflow.")
}

/// 通用 JSON-RPC 透传（反馈上报 / 工作流 / 交付物等 runtime 服务）。
/// 外层超时须大于 sidecar 内层（workflow.* 最长 5 分钟）。
#[tauri::command]
pub async fn dsh_rpc(method: String, params: Option<Value>, s: State<'_, DshAppState>) -> Result<Value, String> {
    if !rpc_method_allowed(&method) {
        return Err(format!("rpc method not allowed: {method}"));
    }
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(
        &s,
        &serde_json::json!({"type":"rpc","id":format!("rpc-{}", next_id()),"method":method,"params":params}),
        std::time::Duration::from_secs(320),
    )
    .await
}

/// 内核（官方客户端栈）unary RPC 代发：前端给相对路径/方法/头/体，sidecar
/// 在 Node 侧带 browser-session cookie 打引擎 /api（跨源栅栏对浏览器无解，
/// 官方桌面壳同样由宿主进程代发）。返回 {status, headers, bodyBase64}。
/// request_id 由前端生成（AbortSignal 取消时用同一 id 调 dsh_http_proxy_cancel）。
/// body_chunks > 0 时请求体走 dsh_http_proxy_chunk 分块送入（大附件不产生巨型 JSON 行）。
#[tauri::command]
pub async fn dsh_http_proxy(
    path: String,
    method: String,
    headers: Vec<(String, String)>,
    body_base64: Option<String>,
    request_id: Option<String>,
    body_chunks: Option<u32>,
    s: State<'_, DshAppState>,
) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = match request_id {
        Some(rid) => {
            if rid.is_empty() || rid.len() > 128 || rid.chars().any(|c| c.is_control()) {
                return Err("invalid request_id".into());
            }
            rid
        }
        None => format!("hp-{}", next_id()),
    };
    scmd_r(
        &s,
        &serde_json::json!({
            "type": "http_proxy",
            "id": id,
            "path": path,
            "method": method,
            "headers": headers,
            "bodyBase64": body_base64,
            "bodyChunks": body_chunks.unwrap_or(0),
        }),
        std::time::Duration::from_secs(600),
    )
    .await
}

/// 一包分块请求体（即发即忘；请求体由 sidecar 侧累积，齐了才发 HTTP）。
#[tauri::command]
pub async fn dsh_http_proxy_chunk(stream_id: String, index: u32, data: String, s: State<'_, DshAppState>) -> Result<(), String> {
    if stream_id.is_empty() || stream_id.len() > 128 || stream_id.chars().any(|c| c.is_control()) {
        return Err("invalid stream_id".into());
    }
    scmd_sync(
        &s,
        &serde_json::json!({"type":"http_proxy_chunk","id":stream_id,"index":index,"data":data}),
    )
}

/// 取消一条在途的 unary 代发（前端 AbortSignal → sidecar AbortController）。
/// 即发即忘：请求可能已经完成，取消失败无需上报。
#[tauri::command]
pub async fn dsh_http_proxy_cancel(stream_id: String, s: State<'_, DshAppState>) -> Result<(), String> {
    scmd_sync(&s, &serde_json::json!({"type":"http_proxy_cancel","id":stream_id}))
}

/// 打开一条官方 Remote 逻辑流：sidecar 侧 WS 连引擎 /api/remote.mux，
/// 帧经 mux_channels[id] 的 Channel 回流前端（__DSH_TRANSPORT__.openStream）。
#[tauri::command]
pub async fn dsh_mux_open(
    id: String,
    endpoint: String,
    payload: Value,
    page_id: Option<String>,
    page_key: Option<String>,
    ch: tauri::ipc::Channel<Value>,
    s: State<'_, DshAppState>,
) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    // 先登记 Channel 再下发命令：open 回包前的 ready 帧不能丢
    s.mux_channels.lock().unwrap().insert(id.clone(), ch);
    let result = scmd_r(
        &s,
        &serde_json::json!({"type":"mux_open","id":id,"endpoint":endpoint,"payload":payload,"pageId":page_id,"pageKey":page_key}),
        std::time::Duration::from_secs(20),
    )
    .await;
    if result.is_err() {
        s.mux_channels.lock().unwrap().remove(&id);
    }
    result
}

/// 关闭一条 Remote 逻辑流（前端取消/生成器收尾；幂等）。
#[tauri::command]
pub async fn dsh_mux_close(id: String, s: State<'_, DshAppState>) -> Result<Value, String> {
    s.mux_channels.lock().unwrap().remove(&id);
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Ok(serde_json::json!({"closed": false}));
    }
    let _ = scmd_r(
        &s,
        &serde_json::json!({"type":"mux_close","id":id}),
        std::time::Duration::from_secs(5),
    )
    .await;
    Ok(serde_json::json!({"closed": true}))
}

/// 列出 dsh 持久化会话（sidecar 扫 DSH_SESSION_ROOT）。
#[tauri::command]
pub async fn dsh_list_sessions(s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    scmd_r(&s, &serde_json::json!({"type":"list_sessions","id":format!("lss-{}", next_id())}), std::time::Duration::from_secs(10)).await
}

/// sidecar 是否就绪（进程级；前端启动门轮询用）。
#[tauri::command]
pub fn dsh_sidecar_ready(s: State<'_, DshAppState>) -> bool {
    s.sidecar.ready.load(Ordering::Acquire)
}

/// 引擎 runtime 是否就绪（对齐 hermes 三层就绪门的最内层）。
/// sidecar ready ≠ 引擎 ready：runtime 由第一个 prompt / prewarm 惰性拉起
/// （冷启动 ~30s），"已连接"假阳性即源于把进程存活当引擎就绪。
/// 启动门必须探本命令；预热走 dsh_prewarm。
#[tauri::command]
pub fn dsh_engine_ready(s: State<'_, DshAppState>) -> bool {
    s.sidecar.ready.load(Ordering::Acquire) && s.sidecar.engine_ready.load(Ordering::Acquire)
}

/// 预热引擎（启动即调用，对齐 hermes "启动即拉起后端"：冷启动在启动门内完成，
/// 进主界面即可用，无"首条消息卡死"窗口）。超时按冷启动预算放宽（90s）。
#[tauri::command]
pub async fn dsh_prewarm(s: State<'_, DshAppState>) -> Result<Value, String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let result = scmd_r(
        &s,
        &serde_json::json!({"type":"prewarm","id":format!("pw-{}", next_id())}),
        std::time::Duration::from_secs(90),
    )
    .await;
    if result.is_ok() {
        s.sidecar.engine_ready.store(true, Ordering::Release);
        Ok(serde_json::json!({"engineReady": true}))
    } else {
        Err(result.err().unwrap_or_else(|| "prewarm failed".into()))
    }
}

/// 内部预热（Rust setup 自主调用，对齐 hermes"createWindow 时立即拉起后端"）：
/// 不经前端 invoke，sidecar ready 后即刻预热引擎；engine_ready 置位后
/// 前端探测自然通过。可重入：每轮 sidecar respawn 后由重启循环重新调用
/// （hermes startHermes() 可重入 + backendConnectionState 共享 promise 同语义）。
async fn prewarm_inner(h: &tauri::AppHandle) {
    let state: State<DshAppState> = h.state();
    if !state.sidecar.ready.load(Ordering::Acquire) {
        return;
    }
    let id = format!("pw-auto-{}", next_id());
    let result = scmd_r(
        &state,
        &serde_json::json!({"type":"prewarm","id":id}),
        std::time::Duration::from_secs(90),
    )
    .await;
    match result {
        Ok(_) => {
            state.sidecar.engine_ready.store(true, Ordering::Release);
            eprintln!("[dsh_relay] engine prewarmed (auto) — engine_ready=true");
        }
        Err(e) => eprintln!("[dsh_relay] auto prewarm failed: {e}"),
    }
}

/// pending_prompts 表项存活上限（引擎挂死时兜底清理，避免表项/Channel 永久滞留）。
const PROMPT_TTL_SECS: u64 = 7200;

/// 创建 Windows Job Object（KILL_ON_JOB_CLOSE）：句柄关闭即结束其中所有进程。
/// 返回裸句柄值（isize，保持 Send/Sync）；失败返回 None（降级为 taskkill 兜底）。
#[cfg(target_os = "windows")]
fn create_kill_job() -> Option<isize> {
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok.is_err() {
            let _ = windows::Win32::Foundation::CloseHandle(job);
            return None;
        }
        Some(job.0 as isize)
    }
}

/// 把 sidecar 进程加入 kill-on-close 作业对象（其子进程默认继承作业成员身份，
/// dsh runtime 孙进程同样被覆盖）。
#[cfg(target_os = "windows")]
fn assign_kill_job(child: &Child) -> Option<isize> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    let job = create_kill_job()?;
    let hjob = HANDLE(job as *mut core::ffi::c_void);
    let hproc = HANDLE(child.as_raw_handle());
    match unsafe { AssignProcessToJobObject(hjob, hproc) } {
        Ok(()) => Some(job),
        Err(e) => {
            eprintln!("[dsh_relay] assign job object failed (fallback to taskkill): {e}");
            unsafe {
                let _ = CloseHandle(hjob);
            }
            None
        }
    }
}

/// 在 setup 中启动 sidecar 并注册 stdout 读线程。
/// sidecar 退出后自动重建（崩溃自愈）：重 spawn + 换 stdin + 起新读循环；
/// ready 仅由 sidecar 的 ready 信封置位（避免"spawn 即 ready"竞态）。
/// 每轮 sidecar ready 后**自主预热引擎**（不等前端、每轮 respawn 都重新预热）：
/// 冷启动与前端渲染并行，用户进主界面时引擎已就绪（hermes startHermes()
/// 同款时序；startHermes 可重入语义由循环内的 prewarm 等待实现）。
pub fn setup_sidecar(app: &tauri::AppHandle, st: DshAppState) {
    let pp = st.pending_prompts.clone();
    let pr = st.pending_requests.clone();
    let mc = st.mux_channels.clone();
    let rd = st.sidecar.ready.clone();
    let er = st.sidecar.engine_ready.clone();
    let lr = st.sidecar.last_ready_epoch.clone();
    let epoch = st.sidecar.epoch.clone();
    let shutdown = st.sidecar.shutdown.clone();
    app.manage(st);
    let h = app.clone();
    // pending_prompts TTL 清理：引擎挂死（永不回包）时不让表项与 Channel 永久滞留
    {
        let hs = h.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                let pp = hs.state::<DshAppState>().pending_prompts.clone();
                let now = std::time::Instant::now();
                let mut guard = pp.lock().unwrap();
                let expired: Vec<String> = guard
                    .iter()
                    .filter(|(_, p)| {
                        now.duration_since(p.created) > std::time::Duration::from_secs(PROMPT_TTL_SECS)
                    })
                    .map(|(k, _)| k.clone())
                    .collect();
                for id in expired {
                    if let Some(p) = guard.remove(&id) {
                        let _ = p.channel.send(serde_json::json!({
                            "type": "error",
                            "message": "prompt timed out waiting for the engine"
                        }));
                    }
                }
            }
        });
    }
    tauri::async_runtime::spawn(async move {
        // 崩溃自愈退避：连续失败按 2^n 秒增长、封顶 30s。
        // Restart loop guard（对照 Hermes restart_loop_guard 语义）：固定窗口内
        // 崩溃达阈值 → 进入"响亮失败态"——停止快 respawn、拉长冷却并显著告警，
        // 防止确定性崩溃（坏配置/坏产物/端口占用）变成秒级无限循环。
        // 健康长跑（ready 且存活超 HEALTHY_SECS）清零窗口并恢复正常自愈节奏。
        const WINDOW_SECS: u64 = 600;
        const THRESHOLD: usize = 5;
        const SUSPEND_COOLDOWN_SECS: u64 = 300;
        const HEALTHY_SECS: u64 = 60;
        let mut backoff_secs: u64 = 1;
        let mut crash_times: Vec<u64> = Vec::new();
        let mut suspended = false;
        while !shutdown.load(Ordering::Acquire) {
            // 本轮进程的 ready 时刻从零计：上一进程的旧值不许污染健康判定
            lr.store(0, Ordering::Release);
            er.store(false, Ordering::Release); // 引擎就绪同样随 sidecar 生命周期重置
            let gen = epoch.fetch_add(1, Ordering::AcqRel) + 1;
            match spawn_sidecar() {
                Ok((mut c, o, i)) => {
                    let pid = c.id();
                    // Windows：进程树纳入 Job Object（KILL_ON_JOB_CLOSE），
                    // 应用即使被任务管理器强杀，node/dsh 也不会残留
                    #[cfg(target_os = "windows")]
                    {
                        if let Some(job) = assign_kill_job(&c) {
                            *h.state::<DshAppState>().sidecar.job.lock().unwrap() = Some(job);
                        }
                    }
                    let s: State<DshAppState> = h.state();
                    *s.sidecar.stdin_tx.lock().unwrap() = Some(start_stdin_writer(i));
                    *s.sidecar.pid.lock().unwrap() = Some(pid);
                    rd.store(false, Ordering::Release); // 等 ready 信封再置位
                    read_stdout(
                        o,
                        pp.clone(),
                        pr.clone(),
                        mc.clone(),
                        rd.clone(),
                        er.clone(),
                        lr.clone(),
                        epoch.clone(),
                        gen,
                        pid,
                        h.clone(),
                    );
                    // 自主预热引擎（hermes startHermes() 同款时序，且每轮 respawn
                    // 都重新预热——startHermes 可重入语义）：等本轮 ready 信封
                    // （sidecar node 冷起，最多 60s）→ prewarm 拉起引擎 runtime。
                    // 预热失败只记日志（重启循环的 next 迭代会再次尝试）。
                    for _ in 0..80 {
                        if rd.load(Ordering::Acquire) || shutdown.load(Ordering::Acquire) {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(750)).await;
                    }
                    if rd.load(Ordering::Acquire) && !shutdown.load(Ordering::Acquire) {
                        prewarm_inner(&h).await;
                    } else if !shutdown.load(Ordering::Acquire) {
                        eprintln!("[dsh_relay] auto prewarm skipped: sidecar not ready in 60s");
                    }
                    // 阻塞 wait 移出 async worker（sidecar 存活数小时）
                    match tauri::async_runtime::spawn_blocking(move || c.wait()).await {
                        Ok(Ok(status)) => eprintln!("[dsh_relay] sidecar pid={pid} EXITED: {status:?} — respawning"),
                        Ok(Err(e)) => eprintln!("[dsh_relay] sidecar pid={pid} wait error: {e} — respawning"),
                        Err(e) => eprintln!("[dsh_relay] sidecar pid={pid} wait join error: {e}"),
                    }
                    let s: State<DshAppState> = h.state();
                    // 只有当前代际收尾（读线程可能已抢先清过；旧代际不得再动状态）
                    if epoch.load(Ordering::Acquire) == gen {
                        rd.store(false, Ordering::Release);
                        er.store(false, Ordering::Release);
                        *s.sidecar.stdin_tx.lock().unwrap() = None;
                        let _ = h.emit("dsh_lost", ());
                    }
                    *s.sidecar.pid.lock().unwrap() = None;
                    // sidecar 死亡后无法回包：清掉所有 pending，避免前端永久等待
                    fail_pending_sidecar(&s, "sidecar exited");
                }
                Err(e) => {
                    eprintln!("[dsh_relay] sidecar spawn failed: {e}");
                }
            }
            if shutdown.load(Ordering::Acquire) {
                break;
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
        eprintln!("[dsh_relay] sidecar supervisor stopped (app shutdown)");
    });
}

/// app 退出时终止 sidecar 进程树：置 shutdown 标志（重启循环不再拉起新进程）
/// + 断开 stdin 写端 + taskkill /T 连树杀 + 关闭 Job Object。
pub fn shutdown_sidecar(app: &tauri::AppHandle) {
    let s = app.state::<DshAppState>();
    s.sidecar.shutdown.store(true, Ordering::Release);
    s.sidecar.ready.store(false, Ordering::Release);
    s.sidecar.engine_ready.store(false, Ordering::Release);
    *s.sidecar.stdin_tx.lock().unwrap() = None;
    let pid = s.sidecar.pid.lock().unwrap().take();
    if let Some(pid) = pid {
        kill_tree(pid);
        eprintln!("[dsh_relay] sidecar pid={pid} killed on app exit");
    }
    // 关闭 Job Object → KILL_ON_JOB_CLOSE 兜底（含 taskkill 来不及覆盖的孙进程）
    #[cfg(target_os = "windows")]
    {
        let job = s.sidecar.job.lock().unwrap().take();
        if let Some(job) = job {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(
                    job as *mut core::ffi::c_void,
                ));
            }
        }
    }
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
    drop(pp);
    // 内核 Remote 流：载体随 sidecar 消失，投递关闭哨兵让前端走重连而不是挂起
    let mut mc = s.mux_channels.lock().unwrap();
    for (_, c) in mc.drain() {
        let _ = c.send(serde_json::json!({"type":"__mirach_close","reason":msg}));
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

#[cfg(test)]
mod tests {
    use super::{next_id, quote_remote, redact_secrets, rpc_method_allowed, ssh_base_args, validate_remote_token};

    #[test]
    fn rpc_allowlist_accepts_known_and_workflow() {
        assert!(rpc_method_allowed("plugins.list"));
        assert!(rpc_method_allowed("session.map.get"));
        assert!(rpc_method_allowed("workflow.run"));
    }

    #[test]
    fn rpc_allowlist_rejects_unknown_and_injection() {
        assert!(!rpc_method_allowed("sessions.delete"));
        assert!(!rpc_method_allowed("commands.execute; rm -rf /"));
        assert!(!rpc_method_allowed(""));
        assert!(!rpc_method_allowed("workflowXrun"));
    }

    #[test]
    fn redact_hides_api_keys() {
        let out = redact_secrets("Incorrect API key provided: sk-abcdefghijklmnopqrstuvwxyz123456");
        assert!(!out.contains("sk-abcdefghijklmnopqrstuvwxyz123456"));
        assert!(out.contains("[redacted]"));
    }

    #[test]
    fn redact_truncates_long_text() {
        let out = redact_secrets(&"x".repeat(1000));
        assert!(out.len() <= 240);
    }

    #[test]
    fn next_id_is_unique() {
        let ids: std::collections::HashSet<String> = (0..1000).map(|_| next_id()).collect();
        assert_eq!(ids.len(), 1000);
    }

    #[test]
    fn remote_token_rejects_shell_metacharacters() {
        assert!(validate_remote_token("x", "user@host").is_ok());
        assert!(validate_remote_token("x", "/usr/local/bin/node").is_ok());
        assert!(validate_remote_token("x", "a b").is_ok()); // 空格允许（引用时加引号）
        assert!(validate_remote_token("x", "a;b").is_err());
        assert!(validate_remote_token("x", "a\"b").is_err());
        assert!(validate_remote_token("x", "a`b").is_err());
        assert!(validate_remote_token("x", "a\nb").is_err());
        assert!(validate_remote_token("x", "").is_err());
    }

    #[test]
    fn ssh_args_shape() {
        let args = ssh_base_args("u@h", "2222", "C:\\key").expect("valid");
        assert_eq!(args[0], "-T");
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"2222".to_string()));
        assert!(args.contains(&"-i".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("u@h"));
        assert!(ssh_base_args("u@h", "abc", "").is_err());
        assert!(ssh_base_args("", "", "").is_err());
    }

    #[test]
    fn remote_quoting() {
        assert_eq!(quote_remote("/usr/bin/node"), "/usr/bin/node");
        assert_eq!(quote_remote("C:\\Program Files\\node.exe"), "\"C:\\Program Files\\node.exe\"");
    }
}
