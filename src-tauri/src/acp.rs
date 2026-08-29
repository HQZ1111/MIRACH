//! acp — ACP 边车（spawn `hermes acp start`，stdio JSON-RPC 子进程）
//!
//! 引擎唯一能流式输出 thinking / tool 增量 / 逐块文本的出口是 ACP（stdin/stdout
//! 每行一个 JSON-RPC 消息）。本模块负责：
//!   - 探测并 spawn `hermes acp start`（hermesBin 配置 > PATH；initialize 握手自检）
//!   - 请求/响应关联（id → 通道），`session/update` 通知 → 前端 MirachEvent
//!   - 流式提交 acp_submit、会话操作（list/new/load/title/steer/cancel）
//!
//! 实现用 std::process + 读线程（与终端 portable-pty 同风格），避免 tokio 子进程
//! 跨 await 持有锁的 Send 问题；命令侧用 spawn_blocking 包阻塞 IO。
//!
//! 通知映射（引擎 AcpEvent → 前端 MirachEvent，见 src/lib/api/types.ts）：
//!   message_delta / agent_message_chunk → message.delta(text)
//!   thinking / agent_thought_chunk      → message.delta(thinking)
//!   message_complete                    → message.complete(text)
//!   tool_call_start                     → tool.start
//!   tool_call_complete                  → tool.complete（含 result/status）
//!   step_complete / plan_update / usage_update → status.update
//!   error                               → message.error
//!
//! 未安装 hermes / 未配置 provider 时 acp_status 给出原因，前端降级到 8787 整段。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command as StdCommand, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 前端流式订阅（一个活跃 Channel）
struct AcpChannel {
    /// 解析后的 ACP 会话 id（通知按它路由）
    acp_sid: String,
    ch: tauri::ipc::Channel<Value>,
}

struct AcpChild {
    child: Child,
    stdin: Mutex<ChildStdin>,
    next_id: u64,
    pending: HashMap<u64, Sender<Value>>,
    /// 活跃流式订阅
    subs: Vec<AcpChannel>,
    /// ACP 会话 id ↔ 前端会话 id（acp_submit 时建立）
    acp_to_frontend: HashMap<String, String>,
}

/// 全局 ACP 状态（tauri manage；Arc 便于读线程/命令共享）
#[derive(Clone)]
pub struct AcpState(Arc<Mutex<Option<AcpChild>>>);

impl Default for AcpState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

/// 解析 hermes 可执行文件路径（config hermesBin > PATH）
fn resolve_binary() -> Result<String, String> {
    let cfg = crate::load_config();
    if !cfg.hermes_bin.trim().is_empty() {
        return Ok(cfg.hermes_bin.trim().to_string());
    }
    // PATH 探测：Windows 下 where hermes
    let probe = StdCommand::new("where")
        .arg("hermes")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    if probe.is_empty() {
        return Err("hermes 未安装或不在 PATH（可在 设置→连接 配置 hermesBin）".to_string());
    }
    Ok(probe.lines().next().unwrap_or(&probe).to_string())
}

/// 停止并清空当前子进程
pub fn acp_stop(state: &AcpState) {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.child.kill();
        let _ = child.child.wait();
        child.pending.clear();
        child.subs.clear();
    }
}

fn is_running(state: &AcpState) -> bool {
    state.0.lock().unwrap().is_some()
}

/// 当前 ACP 会话 id（有则返回）
fn current_acp_sid(state: &AcpState) -> Option<String> {
    state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|c| c.acp_to_frontend.keys().next().cloned())
}

/// 同步发送 JSON-RPC 请求并等待响应（30s 超时）
fn request_blocking(state: &AcpState, method: &str, params: Option<Value>) -> Result<Value, String> {
    let (id, rx) = {
        let mut guard = state.0.lock().unwrap();
        let child = guard.as_mut().ok_or("ACP 子进程未启动")?;
        child.next_id += 1;
        let id = child.next_id;
        let (tx, rx) = channel::<Value>();
        child.pending.insert(id, tx);
        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params.unwrap_or(Value::Null),
        });
        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        let mut stdin = child.stdin.lock().unwrap();
        let write_result = stdin
            .write_all(format!("{line}\n").as_bytes())
            .and_then(|_| stdin.flush());
        drop(stdin);
        if let Err(e) = write_result {
            acp_stop(state);
            return Err(format!("ACP 写入失败: {e}"));
        }
        (id, rx)
    };

    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(resp) => match resp.get("error").cloned() {
            Some(e) => Err(e
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("ACP 请求失败")
                .to_string()),
            None => Ok(resp),
        },
        Err(_) => {
            state
                .0
                .lock()
                .unwrap()
                .as_mut()
                .and_then(|c| c.pending.remove(&id));
            Err(format!("ACP 请求超时（{method}）"))
        }
    }
}

/// spawn + initialize 握手自检；成功则保持子进程常驻（同步，供 spawn_blocking 内调用）
fn ensure_spawned(app: AppHandle, state: AcpState) -> Result<(), String> {
    if is_running(&state) {
        return Ok(());
    }
    let bin = resolve_binary()?;

    let mut child = StdCommand::new(&bin)
        .arg("acp")
        .arg("start")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 {bin} acp start: {e}"))?;
    let stdin = child.stdin.take().ok_or("ACP 子进程无 stdin")?;
    let stdout = child.stdout.take().ok_or("ACP 子进程无 stdout")?;

    let inner = AcpChild {
        child,
        stdin: Mutex::new(stdin),
        next_id: 0,
        pending: HashMap::new(),
        subs: Vec::new(),
        acp_to_frontend: HashMap::new(),
    };
    *state.0.lock().unwrap() = Some(inner);

    // initialize 自检（失败 → 清理并报错）
    match request_blocking(&state, "initialize", None) {
        Ok(_) => {
            spawn_reader(app, state.clone(), stdout);
            Ok(())
        }
        Err(e) => {
            acp_stop(&state);
            Err(e)
        }
    }
}

/// stdout 读线程：JSON-RPC 响应 → pending 队列；session/update 通知 → 前端
fn spawn_reader(app: AppHandle, state: AcpState, stdout: ChildStdout) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if v.get("method").is_some() {
                handle_notification(&app, &state, &v);
            } else if let Some(id) = v.get("id").and_then(Value::as_u64) {
                let sender = state
                    .0
                    .lock()
                    .unwrap()
                    .as_mut()
                    .and_then(|c| c.pending.remove(&id));
                if let Some(tx) = sender {
                    let _ = tx.send(v);
                }
            }
        }
        // 子进程退出 → 清理状态
        acp_stop(&state);
    });
}

fn mid(sid: &str) -> String {
    format!(
        "acp-{sid}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    )
}

/// 通知 → MirachEvent JSON，路由到匹配的 Channel（保留订阅）+ 全局 acp:event
fn handle_notification(app: &AppHandle, state: &AcpState, notif: &Value) {
    let Some(params) = notif.get("params") else { return };
    let kind = params.get("kind").and_then(Value::as_str).unwrap_or("");
    let acp_sid = params.get("session_id").and_then(Value::as_str).unwrap_or("");
    if acp_sid.is_empty() {
        return;
    }

    let ev = match kind {
        "message_delta" | "agent_message_chunk" => Some(json!({
            "type": "message.delta", "sessionId": acp_sid, "messageId": mid(acp_sid),
            "partType": "text", "delta": params.get("text").and_then(Value::as_str).unwrap_or(""),
        })),
        "thinking" | "agent_thought_chunk" => Some(json!({
            "type": "message.delta", "sessionId": acp_sid, "messageId": mid(acp_sid),
            "partType": "thinking", "delta": params.get("text").and_then(Value::as_str).unwrap_or(""),
        })),
        "message_complete" => Some(json!({
            "type": "message.complete", "sessionId": acp_sid, "messageId": mid(acp_sid),
            "text": params.get("text").and_then(Value::as_str).unwrap_or(""),
        })),
        "tool_call_start" => Some(json!({
            "type": "tool.start", "sessionId": acp_sid,
            "tool": {
                "id": params.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                "name": params.get("tool_name").and_then(Value::as_str).unwrap_or("tool"),
                "status": "running",
                "detail": params.get("title").and_then(Value::as_str).unwrap_or(""),
            },
        })),
        "tool_call_complete" => {
            let status = params.get("status").and_then(Value::as_str).unwrap_or("completed");
            Some(json!({
                "type": "tool.complete", "sessionId": acp_sid,
                "tool": {
                    "id": params.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                    "name": params.get("tool_name").and_then(Value::as_str).unwrap_or("tool"),
                    "status": if status == "failed" { "error" } else { "completed" },
                    "detail": params.get("result").and_then(Value::as_str).map(|s| s.chars().take(600).collect::<String>()).unwrap_or_default(),
                },
            }))
        }
        "step_complete" => Some(json!({
            "type": "status.update", "sessionId": acp_sid,
            "status": format!("步骤完成（API 调用 {} 次）", params.get("api_call_count").and_then(Value::as_u64).unwrap_or(0)),
        })),
        "plan_update" => {
            let entries = params.get("entries").and_then(Value::as_array);
            let total = entries.map(|a| a.len()).unwrap_or(0);
            let done = entries
                .map(|a| {
                    a.iter()
                        .filter(|e| e.get("status").and_then(Value::as_str) == Some("completed"))
                        .count()
                })
                .unwrap_or(0);
            Some(json!({
                "type": "status.update", "sessionId": acp_sid,
                "status": format!("计划进度：{done}/{total} 项完成"),
            }))
        }
        "usage_update" => Some(json!({
            "type": "status.update", "sessionId": acp_sid,
            "status": format!(
                "上下文用量：{} / {}",
                params.get("used").and_then(Value::as_u64).unwrap_or(0),
                params.get("size").and_then(Value::as_u64).unwrap_or(0),
            ),
        })),
        "session_info_update" => {
            let title = params.get("title").and_then(Value::as_str).unwrap_or("");
            Some(json!({
                "type": "status.update", "sessionId": acp_sid,
                "status": if title.is_empty() { "会话已更新".to_string() } else { format!("会话标题：{title}") },
            }))
        }
        "error" => Some(json!({
            "type": "message.error", "sessionId": acp_sid,
            "message": params.get("error").and_then(Value::as_str).unwrap_or("ACP 错误"),
        })),
        _ => None,
    };
    let Some(ev) = ev else { return };

    // 路由：匹配的 Channel 推送（订阅保留）+ 全局事件广播
    let mut matched: Vec<(String, tauri::ipc::Channel<Value>)> = Vec::new();
    {
        let guard = state.0.lock().unwrap();
        if let Some(child) = guard.as_ref() {
            let frontend_sid = child
                .acp_to_frontend
                .get(acp_sid)
                .cloned()
                .unwrap_or_else(|| acp_sid.to_string());
            for s in &child.subs {
                if s.acp_sid == acp_sid {
                    matched.push((frontend_sid.clone(), s.ch.clone()));
                }
            }
        }
    }
    for (fsid, ch) in matched {
        let mut e = ev.clone();
        e["sessionId"] = json!(fsid);
        let _ = ch.send(e);
    }
    let _ = app.emit("acp:event", &ev);
}

/// 确保存在一个 ACP 会话（返回 acp 会话 id）
fn ensure_session(state: &AcpState) -> Result<String, String> {
    if let Some(sid) = current_acp_sid(state) {
        return Ok(sid);
    }
    let resp = request_blocking(state, "session/list", None)?;
    let sessions = resp
        .get("result")
        .and_then(|r| r.get("sessions"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // 优先恢复最近会话；没有则新建
    if let Some(first) = sessions.first() {
        let sid = first
            .get("sessionId")
            .or_else(|| first.get("session_id"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if !sid.is_empty() {
            let _ = request_blocking(state, "session/load", Some(json!({ "session_id": sid })));
            return Ok(sid);
        }
    }
    let created = request_blocking(state, "session/new", Some(json!({ "cwd": crate::load_config().workspace })))?;
    let sid = created
        .get("result")
        .and_then(|r| r.get("session_id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(sid)
}

// ================================================================
// Tauri 命令（阻塞 IO 用 spawn_blocking 包）
// ================================================================

/// ACP 可用性（探测 + 启动）。available=false 时 reason 给出原因。
#[tauri::command]
pub async fn acp_status(app: AppHandle, state: tauri::State<'_, AcpState>) -> Result<Value, String> {
    let inner = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || match ensure_spawned(app2, inner) {
        Ok(()) => Ok(json!({ "available": true, "reason": null, "version": null })),
        Err(e) => Ok(json!({ "available": false, "reason": e, "version": null })),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 通用 ACP 请求（initialize / session/list / session/new / session/title …）
#[tauri::command]
pub async fn acp_request(
    app: AppHandle,
    state: tauri::State<'_, AcpState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let inner = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_spawned(app2, inner.clone())?;
        let resp = request_blocking(&inner, &method, params)?;
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 流式提交（ACP 通道）：事件经 Channel 推给前端
#[tauri::command]
pub async fn acp_submit(
    app: AppHandle,
    state: tauri::State<'_, AcpState>,
    session_id: String,
    text: String,
    ch: tauri::ipc::Channel<Value>,
) -> Result<(), String> {
    let inner = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_spawned(app2, inner.clone())?;
        let acp_sid = ensure_session(&inner)?;
        {
            let mut guard = inner.0.lock().unwrap();
            if let Some(child) = guard.as_mut() {
                child
                    .acp_to_frontend
                    .insert(acp_sid.clone(), session_id.clone());
                child.subs.push(AcpChannel {
                    acp_sid: acp_sid.clone(),
                    ch,
                });
            }
        }
        let _ = request_blocking(&inner, "prompt", Some(json!({ "session_id": acp_sid, "prompt": text })))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ACP 会话列表（供左侧会话列表优先使用）
#[tauri::command]
pub async fn acp_sessions_list(app: AppHandle, state: tauri::State<'_, AcpState>) -> Result<Value, String> {
    let inner = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_spawned(app2, inner.clone())?;
        let resp = request_blocking(&inner, "session/list", None)?;
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 转向（/steer）：运行中注入纠偏（ACP 真打断；未运行退化为排队由引擎处理）
#[tauri::command]
pub async fn acp_steer(
    app: AppHandle,
    state: tauri::State<'_, AcpState>,
    guidance: String,
) -> Result<(), String> {
    let inner = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_spawned(app2, inner.clone())?;
        let acp_sid = ensure_session(&inner)?;
        let _ = request_blocking(
            &inner,
            "prompt",
            Some(json!({ "session_id": acp_sid, "prompt": format!("/steer {guidance}") })),
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 取消当前运行（session/cancel）
#[tauri::command]
pub async fn acp_cancel(_app: AppHandle, state: tauri::State<'_, AcpState>) -> Result<(), String> {
    let inner = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !is_running(&inner) {
            return Ok(());
        }
        if let Some(sid) = current_acp_sid(&inner) {
            let _ = request_blocking(&inner, "session/cancel", Some(json!({ "session_id": sid })))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 停止 ACP 子进程（退出/切换时）
#[tauri::command]
pub fn acp_stop_cmd(state: tauri::State<'_, AcpState>) {
    acp_stop(state.inner());
}
