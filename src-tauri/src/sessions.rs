//! sessions — 会话本地持久化层访问（hermes 引擎的 sessions.db / sessions/*.json）
//!
//! 引擎把会话持久化到 {mirachHome}/sessions.db（SQLite：sessions + messages 表，
//! 附 messages_fts 全文索引）。左侧会话列表/深搜/打开历史真实数据都从这里读。
//! 引擎运行中可能持有写锁 → 所有连接设 busy_timeout，失败返回错误给 UI（不崩溃）。
//!
//! 降级链：sessions.db 不存在时回退扫 {mirachHome}/sessions/*.json 快照
//! （格式 { "session_info": { "session_id": … }, "messages": [ … ] }）。

use rusqlite::{params, Connection};
use serde_json::Value;
use std::path::Path;

/// 会话摘要（createdAt/updatedAt 为 RFC3339 字符串，前端 Date.parse 转毫秒）
#[derive(serde::Serialize)]
pub struct SessionSummary {
    id: String,
    title: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "messageCount")]
    message_count: i64,
}

/// 全文搜索命中（FTS5 snippet 带 <mark> 高亮）
#[derive(serde::Serialize)]
pub struct SessionHit {
    #[serde(rename = "sessionId")]
    session_id: String,
    title: String,
    role: String,
    snippet: String,
    #[serde(rename = "messageId")]
    message_id: i64,
}

/// 会话历史消息（打开会话渲染）
#[derive(serde::Serialize)]
pub struct SessionMessage {
    id: i64,
    role: String,
    content: String,
}

fn hermes_home() -> String {
    crate::load_config().hermes_home
}

fn db_path() -> std::path::PathBuf {
    Path::new(&hermes_home()).join("sessions.db")
}

fn open_db() -> Result<Connection, String> {
    let p = db_path();
    if !p.exists() {
        return Err(format!("sessions.db 不存在：{}", p.display()));
    }
    let conn = Connection::open(&p).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// FTS5 查询串：用户输入拆词、去引号、逐词加双引号（防止语法错误）
fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

// ================================================================
// 会话列表
// ================================================================

/// 会话列表（sessions.db 优先，快照降级），按更新时间倒序
#[tauri::command]
pub fn sessions_list() -> Vec<SessionSummary> {
    if let Ok(conn) = open_db() {
        let mut stmt = match conn.prepare(
            "SELECT id, COALESCE(title,''), COALESCE(created_at,''), COALESCE(updated_at,''), message_count
             FROM sessions ORDER BY updated_at DESC",
        ) {
            Ok(s) => s,
            Err(_) => return snapshot_list(),
        };
        let rows = stmt
            .query_map([], |r| {
                Ok(SessionSummary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    created_at: r.get(2)?,
                    updated_at: r.get(3)?,
                    message_count: r.get(4)?,
                })
            })
            .and_then(|it| it.collect::<Result<Vec<_>, _>>());
        return rows.unwrap_or_default();
    }
    snapshot_list()
}

/// 降级：扫 {mirachHome}/sessions/*.json 快照（session_info + messages）
fn snapshot_list() -> Vec<SessionSummary> {
    let dir = Path::new(&hermes_home()).join("sessions");
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else { continue };
        let info = v.get("session_info").cloned().unwrap_or_default();
        let id = str_field(&info, "session_id")
            .map(String::from)
            .or_else(|| path.file_stem().map(|s| s.to_string_lossy().to_string()))
            .unwrap_or_default();
        let messages = v
            .get("messages")
            .and_then(|m| m.as_array())
            .map(|a| a.len() as i64)
            .unwrap_or(0);
        out.push(SessionSummary {
            id,
            title: str_field(&info, "title")
                .unwrap_or("未命名会话")
                .to_string(),
            created_at: str_field(&info, "created_at")
                .unwrap_or("")
                .to_string(),
            updated_at: str_field(&info, "updated_at")
                .unwrap_or("")
                .to_string(),
            message_count: messages,
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

// ================================================================
// 全文搜索
// ================================================================

/// 会话全文搜索（messages_fts FTS5；不可用时降级 LIKE）
#[tauri::command]
pub fn sessions_search(query: String, limit: Option<u32>) -> Result<Vec<SessionHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("搜索词为空".to_string());
    }
    let lim = limit.unwrap_or(20).min(50) as i64;
    let conn = open_db()?;
    let fts = fts_query(q);

    // FTS5 主路径（snippet 高亮）
    let fts_sql = "SELECT m.id, m.session_id, m.role,
                          snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16),
                          COALESCE(s.title, m.session_id)
                   FROM messages_fts
                   JOIN messages m ON m.id = messages_fts.rowid
                   LEFT JOIN sessions s ON s.id = m.session_id
                   WHERE messages_fts MATCH ?1
                   ORDER BY m.id DESC LIMIT ?2";
    if let Ok(mut stmt) = conn.prepare(fts_sql) {
        if let Ok(hits) = stmt
            .query_map(params![fts, lim], |r| {
                Ok(SessionHit {
                    message_id: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    snippet: r.get(3)?,
                    title: r.get(4)?,
                })
            })
            .and_then(|it| it.collect::<Result<Vec<_>, _>>())
        {
            if !hits.is_empty() {
                return Ok(hits);
            }
        }
    }

    // 降级：LIKE 模糊扫 messages
    let like_sql = "SELECT m.id, m.session_id, m.role, m.content, COALESCE(s.title, m.session_id)
                    FROM messages m LEFT JOIN sessions s ON s.id = m.session_id
                    WHERE m.content LIKE ?1
                    ORDER BY m.id DESC LIMIT ?2";
    let pattern = format!("%{q}%");
    let mut stmt = conn.prepare(like_sql).map_err(|e| e.to_string())?;
    let hits = stmt
        .query_map(params![pattern, lim], |r| {
            Ok(SessionHit {
                message_id: r.get(0)?,
                session_id: r.get(1)?,
                role: r.get(2)?,
                snippet: r.get(3)?,
                title: r.get(4)?,
            })
        })
        .and_then(|it| it.collect::<Result<Vec<_>, _>>())
        .map_err(|e| e.to_string())?;
    Ok(hits)
}

// ================================================================
// 打开 / 重命名 / 删除
// ================================================================

/// 打开会话：取该会话全部消息（按写入序）
#[tauri::command]
pub fn sessions_load(session_id: String) -> Result<Vec<SessionMessage>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, role, content FROM messages WHERE session_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id], |r| {
            Ok(SessionMessage {
                id: r.get(0)?,
                role: r.get(1)?,
                content: r.get(2)?,
            })
        })
        .and_then(|it| it.collect::<Result<Vec<_>, _>>())
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 重命名会话（best-effort：引擎运行中可能锁库）
#[tauri::command]
pub fn sessions_rename(session_id: String, title: String) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("标题不能为空".to_string());
    }
    let conn = open_db()?;
    conn.execute(
        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now_rfc3339(), session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除会话（sessions + messages + FTS 索引）
#[tauri::command]
pub fn sessions_delete(session_id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM messages_fts WHERE session_id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;
    // 快照文件一并清理
    let snap = Path::new(&hermes_home())
        .join("sessions")
        .join(format!("{session_id}.json"));
    if snap.exists() {
        let _ = std::fs::remove_file(&snap);
    }
    Ok(())
}

/// 当前时间（RFC3339 UTC，引擎 sessions.updated_at 同格式）
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
