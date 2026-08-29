//! Relay — 轻量通信中继（UI ⇄ Agent 引擎）
//!
//! 职责：把前端提交的消息转发给 Agent 引擎，把引擎的回复推回前端。
//! 本模块**不含任何 AI 逻辑**，只做 HTTP 转发，保持这层轻量高效。
//!
//! 默认对接 hermes-agent-ultra 的 hermes-http 服务（127.0.0.1:8787，
//! 即前端 API_BASE 预留端口），引擎地址可由 HERMES_ENGINE / config.json
//! 的 engineBase 覆盖（见 lib.rs 的 load_config）。
//!
//! 对前端暴露的 Tauri 命令：
//! - relay_ping    → GET  {engine}/health          （网关状态探活）
//! - relay_submit  → POST {engine}/v1/sessions/{id}/messages（提交提示词）
//! - relay_models  → GET  {engine}/v1/models        （模型列表）
//! - relay_rpc     → POST {engine}/v1/rpc           （通用 JSON-RPC）
//!
//! 引擎回复经 `relay:reply` 事件推送给前端（事件契约见 docs/api-contract.md）。

use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 引擎基址（与 lib.rs 的配置同源）
fn engine_base() -> String {
    crate::load_config().engine_base
}

/// 引擎健康状态（relay_ping 返回值）
#[derive(serde::Serialize)]
pub struct RelayStatus {
    ok: bool,
    url: String,
    error: Option<String>,
}

/// 引擎回复（relay_submit 返回值，同时以 relay:reply 事件推送）
#[derive(serde::Serialize, serde::Deserialize)]
pub struct RelayReply {
    session_id: String,
    reply: String,
    #[serde(default)]
    message_count: u64,
}

/// GET {engine}/health — 引擎是否可达
#[tauri::command]
pub async fn relay_ping() -> RelayStatus {
    let base = engine_base();
    let url = format!("{base}/health");
    let result = tauri::async_runtime::spawn_blocking(move || {
        ureq::get(&url).timeout(Duration::from_secs(3)).call()
    })
    .await;
    match result {
        Ok(Ok(_)) => RelayStatus { ok: true, url: base, error: None },
        Ok(Err(e)) => RelayStatus { ok: false, url: base, error: Some(e.to_string()) },
        Err(e) => RelayStatus { ok: false, url: base, error: Some(e.to_string()) },
    }
}

/// 提交提示词到引擎（POST /v1/sessions/{id}/messages）。
/// 引擎返回整段回复；成功后以 relay:reply 事件推送给前端。
#[tauri::command]
pub async fn relay_submit(
    app: AppHandle,
    session_id: String,
    text: String,
    model: Option<String>,
) -> Result<RelayReply, String> {
    let base = engine_base();
    let url = format!("{base}/v1/sessions/{session_id}/messages");
    let body = json!({ "text": text, "model": model });

    let reply: RelayReply = tauri::async_runtime::spawn_blocking(move || {
        ureq::post(&url)
            .timeout(Duration::from_secs(120))
            .send_json(body)
            .map_err(|e| e.to_string())?
            .into_json::<RelayReply>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    // 推回前端（Composer / 聊天区渲染）
    let _ = app.emit("relay:reply", &reply);
    Ok(reply)
}

/// 流式提交：POST 引擎拿整段回复，经 Tauri Channel 逐事件推给前端。
///
/// 事件流（对齐 api/types.ts 的 MirachEvent）：
///   {"type":"message.delta","partType":"text","delta":...}
///   {"type":"message.complete","text":...}
/// 引擎以后支持逐块/thinking/tool 增量时，把块转成对应事件即可，前端零改动
/// （参考 zosma-cowork 的 Channel 流式模式）。
#[tauri::command]
pub async fn relay_stream_submit(
    session_id: String,
    text: String,
    ch: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    let base = engine_base();
    let url = format!("{base}/v1/sessions/{session_id}/messages");
    let body = json!({ "text": text, "model": null });

    let reply: String = tauri::async_runtime::spawn_blocking(move || {
        let r = ureq::post(&url)
            .timeout(Duration::from_secs(120))
            .send_json(body)
            .map_err(|e| e.to_string())?;
        let v: serde_json::Value = r.into_json().map_err(|e| e.to_string())?;
        Ok::<String, String>(
            v.get("reply")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    // 整段回复 = 一条 text delta + complete（引擎支持逐块后在此切块）
    let _ = ch.send(json!({
        "type": "message.delta",
        "sessionId": session_id,
        "messageId": "m1",
        "partType": "text",
        "delta": reply,
    }));
    let _ = ch.send(json!({
        "type": "message.complete",
        "sessionId": session_id,
        "messageId": "m1",
        "text": reply,
    }));
    Ok(())
}

/// 拉取模型列表（GET /v1/models）。引擎未提供该端点时返回空数组。
#[tauri::command]
pub async fn relay_models() -> Value {
    let base = engine_base();
    let url = format!("{base}/v1/models");
    tauri::async_runtime::spawn_blocking(move || {
        ureq::get(&url)
            .timeout(Duration::from_secs(5))
            .call()
            .ok()?
            .into_json::<Value>()
            .ok()
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| json!([]))
}

/// 通用 JSON-RPC（POST /v1/rpc）：project.tree / llm.oneshot 等
#[tauri::command]
pub async fn relay_rpc(method: String, params: Option<Value>) -> Result<Value, String> {
    let base = engine_base();
    let url = format!("{base}/v1/rpc");
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params.unwrap_or(Value::Null),
    });

    tauri::async_runtime::spawn_blocking(move || {
        ureq::post(&url)
            .timeout(Duration::from_secs(30))
            .send_json(body)
            .map_err(|e| e.to_string())?
            .into_json::<Value>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ================================================================
// 引擎斜杠命令面 + 认证（hermes-http /v1/commands、/auth/*）
// ================================================================

/// 引擎斜杠命令响应（POST /v1/commands）
#[derive(serde::Serialize, serde::Deserialize)]
pub struct CommandResult {
    accepted: bool,
    output: String,
}

/// 执行引擎斜杠命令（POST /v1/commands）。
/// command 无 "/" 前缀时引擎会自动补；输出回给前端追加到聊天区。
#[tauri::command]
pub async fn relay_command(
    session_id: String,
    command: String,
) -> Result<CommandResult, String> {
    let base = engine_base();
    let url = format!("{base}/v1/commands");
    let body = json!({ "command": command, "session_id": session_id });
    tauri::async_runtime::spawn_blocking(move || {
        ureq::post(&url)
            .timeout(Duration::from_secs(30))
            .send_json(body)
            .map_err(|e| e.to_string())?
            .into_json::<CommandResult>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 引擎认证状态（GET /auth/status 原样透传；引擎不可达时给 reachable:false）
#[tauri::command]
pub async fn relay_auth_status() -> Value {
    let base = engine_base();
    let url = format!("{base}/auth/status");
    tauri::async_runtime::spawn_blocking(move || {
        ureq::get(&url)
            .timeout(Duration::from_secs(5))
            .call()
            .ok()?
            .into_json::<Value>()
            .ok()
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| json!({ "reachable": false }))
}

/// 探测 AI 供应商端点连通性 + 拉模型目录（登录页/设置页「测试连接」「获取模型」共用）。
/// URL：base 已含 /v1 → {base}/models，否则 {base}/v1/models（anthropic 例外见下）。
/// 认证：openai 系 Bearer；anthropic 系 x-api-key + anthropic-version（协议头错了
/// 服务端会拒，用户侧表现就是"key 没了"）。
/// 返回 { ok, count, models: [{id,name}] }（OpenAI 兼容 data[].id；anthropic data[].id 同形）。
#[tauri::command]
pub async fn relay_probe(
    base_url: String,
    api_key: String,
    protocol: String,
) -> Result<Value, String> {
    let is_anthropic = protocol.to_lowercase().contains("anthropic");
    let base = base_url.trim_end_matches('/').to_string();
    let url = if is_anthropic {
        // anthropic 官方 models 列表是 /v1/models（base 常填到 /v1 也兼容）
        if base.ends_with("/v1") {
            format!("{base}/models")
        } else {
            format!("{base}/v1/models")
        }
    } else if base.ends_with("/v1") {
        format!("{base}/models")
    } else {
        format!("{base}/v1/models")
    };
    let key = api_key.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let mut req = ureq::get(&url).timeout(Duration::from_secs(8));
        if !key.is_empty() {
            req = if is_anthropic {
                req.set("x-api-key", &key)
                    .set("anthropic-version", "2023-06-01")
            } else {
                req.set("Authorization", &format!("Bearer {key}"))
            };
        }
        let resp = req.call().map_err(|e| e.to_string())?;
        let v: Value = resp.into_json().map_err(|e| e.to_string())?;
        let list = v.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
        let models: Vec<Value> = list
            .iter()
            .filter_map(|m| {
                let id = m.get("id").and_then(Value::as_str)?;
                Some(json!({ "id": id, "name": m.get("display_name").and_then(Value::as_str).unwrap_or(id) }))
            })
            .collect();
        let count = models.len();
        Ok(json!({ "ok": true, "count": count, "models": models }))
    })
    .await
    .map_err(|e| e.to_string())?
}
