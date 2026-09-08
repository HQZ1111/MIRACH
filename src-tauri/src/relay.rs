//! Relay — 供应商端点探测（登录页/设置页「测试连接」「获取模型」共用）。
//!
//! 旧版本模块曾承担 UI ⇄ hermes-agent-ultra 引擎的 HTTP 转发
//! （/health /v1/sessions /v1/rpc /v1/commands /auth/*）；mirach 收敛为
//! dsh 单核心后，引擎通道全部走 agent-sidecar（dsh_relay.rs），这里只保留
//! 与引擎无关的供应商探测命令。
//!
//! 对前端暴露的 Tauri 命令：
//! - relay_probe → 探测 AI 供应商端点连通性 + 拉模型目录

use serde_json::{json, Value};

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
        let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(8));
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
