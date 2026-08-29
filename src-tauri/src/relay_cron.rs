//! relay_cron — 定时任务真实化（api_server 8090 /api/jobs CRUD）
//!
//! 引擎的 api_server 平台提供完整 cron 任务管理：
//!   GET    /api/jobs                    → { "jobs": [ … ] }
//!   POST   /api/jobs                    → { "job": { … } }（name/schedule/prompt/repeat/…）
//!   PATCH  /api/jobs/{id}               → { "job": { … } }
//!   DELETE /api/jobs/{id}
//!   POST   /api/jobs/{id}/pause|resume|run
//! 认证：apiBase/apiToken（config.json 或 HERMES_API_BASE / HERMES_API_TOKEN），
//! 有 token 时带 Authorization: Bearer。
//!
//! 引擎不可达/未配置时调用方降级到本地 mock（前端处理）。

use serde_json::{json, Value};
use std::time::Duration;
use tauri::async_runtime::spawn_blocking;

fn api_base() -> String {
    crate::load_config().api_base
}

fn api_token() -> Option<String> {
    let t = crate::load_config().api_token;
    if t.trim().is_empty() {
        None
    } else {
        Some(t)
    }
}

/// 带 Bearer 的 GET（探测用）
fn get_json(url: &str, timeout: Duration) -> Result<Value, String> {
    let mut req = ureq::get(url).timeout(timeout);
    if let Some(t) = api_token() {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    req.call()
        .map_err(|e| e.to_string())?
        .into_json::<Value>()
        .map_err(|e| e.to_string())
}

fn send_json(url: &str, method: &str, body: Value) -> Result<Value, String> {
    let mut req = match method {
        "POST" => ureq::post(url).timeout(Duration::from_secs(30)),
        "PATCH" => ureq::patch(url).timeout(Duration::from_secs(30)),
        "DELETE" => ureq::delete(url).timeout(Duration::from_secs(30)),
        _ => return Err("unsupported method".to_string()),
    };
    if let Some(t) = api_token() {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    let resp = if method == "DELETE" {
        req.call().map_err(|e| e.to_string())?
    } else {
        req.send_json(body).map_err(|e| e.to_string())?
    };
    resp.into_json::<Value>().map_err(|e| e.to_string())
}

/// 探测 api_server 是否可达（cron 面板决定真实/降级）
#[tauri::command]
pub async fn relay_cron_ping() -> bool {
    let base = api_base();
    let url = format!("{base}/api/jobs");
    spawn_blocking(move || get_json(&url, Duration::from_secs(3)).is_ok())
        .await
        .unwrap_or(false)
}

/// 任务列表（GET /api/jobs → { jobs: [...] }，原样透传）
#[tauri::command]
pub async fn relay_cron_list() -> Result<Value, String> {
    let base = api_base();
    let url = format!("{base}/api/jobs?include_disabled=true");
    spawn_blocking(move || get_json(&url, Duration::from_secs(10)))
        .await
        .map_err(|e| e.to_string())?
}

/// 创建任务（POST /api/jobs；payload 对齐引擎 ApiCronJobCreateRequest）
#[tauri::command]
pub async fn relay_cron_create(payload: Value) -> Result<Value, String> {
    let base = api_base();
    let url = format!("{base}/api/jobs");
    spawn_blocking(move || send_json(&url, "POST", payload))
        .await
        .map_err(|e| e.to_string())?
}

/// 更新任务（PATCH /api/jobs/{id}；name/schedule/prompt/deliver/enabled/repeat/skills/…）
#[tauri::command]
pub async fn relay_cron_update(job_id: String, payload: Value) -> Result<Value, String> {
    let base = api_base();
    let url = format!("{base}/api/jobs/{job_id}");
    spawn_blocking(move || send_json(&url, "PATCH", payload))
        .await
        .map_err(|e| e.to_string())?
}

/// 删除任务
#[tauri::command]
pub async fn relay_cron_delete(job_id: String) -> Result<(), String> {
    let base = api_base();
    let url = format!("{base}/api/jobs/{job_id}");
    spawn_blocking(move || {
        send_json(&url, "DELETE", json!({})).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 暂停 / 恢复 / 立即运行
async fn job_action(job_id: String, action: &str) -> Result<(), String> {
    let base = api_base();
    let url = format!("{base}/api/jobs/{job_id}/{action}");
    let act = action.to_string();
    spawn_blocking(move || send_json(&url, "POST", json!({})).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{act} 失败: {e}"))
}

#[tauri::command]
pub async fn relay_cron_pause(job_id: String) -> Result<(), String> {
    job_action(job_id, "pause").await
}

#[tauri::command]
pub async fn relay_cron_resume(job_id: String) -> Result<(), String> {
    job_action(job_id, "resume").await
}

#[tauri::command]
pub async fn relay_cron_run(job_id: String) -> Result<(), String> {
    job_action(job_id, "run").await
}
