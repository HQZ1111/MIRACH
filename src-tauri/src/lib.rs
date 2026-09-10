// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

mod bootstrap;
mod dsh_relay;
mod events;
mod powershell;
mod relay;
mod sessions;

/// 非交互子进程统一入口：Windows 下带 CREATE_NO_WINDOW，避免每次 spawn 闪控制台。
fn console_command(program: &str) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

// ================================================================
// 应用配置（工作目录 / Hermes 文件夹 / 浏览器首页）
// 解析顺序：环境变量 → %APPDATA%\my-hermes-rs\config.json → 内置默认值
// ================================================================

#[derive(serde::Serialize, Clone)]
struct AppConfig {
    /// 项目工作目录（终端 cwd + Git 审查范围）
    workspace: String,
    /// Hermes 文件夹（顶栏"打开 Mirach 文件夹"）
    hermes_home: String,
    /// 浏览器默认首页
    browser_home: String,
    /// 应用数据目录（%APPDATA%\my-hermes-rs，日志/配置存放处）
    data_dir: String,
    /// 核心 web 面监听地址（127.0.0.1 = 仅本机；0.0.0.0 = 局域网手机可访问）
    web_host: String,
    /// 应用更新源（静态 JSON 端点；空 = 未配置，更新检查返回明确提示）
    update_endpoint: String,
    /// 远程引擎（SSH）：sidecar 在远端主机上运行（本地只做壳）
    remote_enabled: bool,
    /// SSH 目标（user@host 或 host）
    remote_host: String,
    /// SSH 端口（空/22 = 默认）
    remote_port: String,
    /// 远端 Node 可执行文件（默认 node，走远端 PATH）
    remote_node: String,
    /// 远端 agent-sidecar 入口绝对路径（dist/index.js）
    remote_sidecar: String,
    /// 可选 SSH 私钥（ssh -i）
    remote_identity: String,
}

fn app_config_dir() -> std::path::PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        std::path::PathBuf::from(appdata).join("my-hermes-rs")
    } else {
        std::path::PathBuf::from(".")
    }
}

fn load_config() -> AppConfig {
    let file = app_config_dir().join("config.json");
    let from_file: Option<serde_json::Value> = std::fs::read_to_string(&file)
        .ok()
        // 去 UTF-8 BOM：PowerShell 的 Set-Content -Encoding UTF8 等工具会写入 BOM，
        // serde_json 遇 BOM 直接解析失败 → 所有设置静默回落默认值（曾导致远程模式不生效）
        .map(|s| s.trim_start_matches('\u{feff}').to_string())
        .and_then(|s| serde_json::from_str(&s).ok());

    let get = |key: &str, env: &str, default: &str| -> String {
        std::env::var(env)
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                from_file
                    .as_ref()
                    .and_then(|v| v.get(key).and_then(|x| x.as_str()).map(String::from))
            })
            .unwrap_or_else(|| default.to_string())
    };
    let get_bool = |key: &str, env: &str, default: bool| -> bool {
        std::env::var(env)
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                from_file.as_ref().and_then(|v| {
                    v.get(key).map(|x| match x {
                        serde_json::Value::Bool(b) => b.to_string(),
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                })
            })
            .map(|s| matches!(s.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(default)
    };

    AppConfig {
        workspace: get("workspace", "MIRACH_WORKSPACE", "D:\\hermes-agent-main"),
        hermes_home: get("mirachHome", "MIRACH_HOME", "C:\\Users\\Administrator\\Hermes"),
        browser_home: get("browserHome", "HERMES_BROWSER_HOME", "https://www.bing.com"),
        data_dir: app_config_dir().to_string_lossy().to_string(),
        web_host: get("webHost", "MIRACH_WEB_HOST", "127.0.0.1"),
        // 默认更新源 = 仓库 docs/latest.json（Gitee raw；发布脚本写入并在 push 后生效）。
        // 签名公钥在 tauri.conf.json，端点被替换也无法通过 minisign 校验。
        update_endpoint: get(
            "updateEndpoint",
            "MIRACH_UPDATE_ENDPOINT",
            "https://gitee.com/HANQINGZHOU/mirach/raw/master/docs/latest.json",
        ),
        remote_enabled: get_bool("remoteEnabled", "MIRACH_REMOTE", false),
        remote_host: get("remoteHost", "MIRACH_REMOTE_HOST", ""),
        remote_port: get("remotePort", "MIRACH_REMOTE_PORT", ""),
        remote_node: get("remoteNode", "MIRACH_REMOTE_NODE", "node"),
        remote_sidecar: get("remoteSidecar", "MIRACH_REMOTE_SIDECAR", ""),
        remote_identity: get("remoteIdentity", "MIRACH_REMOTE_IDENTITY", ""),
    }
}

#[tauri::command]
fn get_config() -> AppConfig {
    load_config()
}

// ================================================================
// 路径白名单
// webview 侧命令只能访问：项目工作区 / Mirach 目录 / 用户目录下的固定子目录。
// 所有路径先 canonicalize（不存在的写入目标从最近的已存在祖先推导并词法规整
// . / ..），再与白名单根做前缀匹配，阻断 .. 穿越与盘符逃逸。
// ================================================================

fn user_home() -> Option<std::path::PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
}

/// 宽松规范化：从最近的已存在祖先 canonicalize，再对剩余片段词法解析 . / ..
/// （不允许越出祖先根）。用于校验尚不存在的写入目标。
fn canonical_lenient(path: &str) -> Result<std::path::PathBuf, String> {
    use std::ffi::OsStr;
    let p = std::path::PathBuf::from(path);
    if p.as_os_str().is_empty() {
        return Err("空路径".to_string());
    }
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = p;
    loop {
        if cur.exists() {
            let mut base = cur.canonicalize().map_err(|e| format!("无法解析路径 {path}: {e}"))?;
            for part in missing.iter().rev() {
                if part == OsStr::new("..") {
                    if !base.pop() {
                        return Err(format!("路径越界: {path}"));
                    }
                } else if part != OsStr::new(".") {
                    base.push(part);
                }
            }
            return Ok(base);
        }
        let name = cur
            .file_name()
            .ok_or_else(|| format!("非法路径: {path}"))?
            .to_os_string();
        missing.push(name);
        if !cur.pop() {
            return Err(format!("非法路径: {path}"));
        }
    }
}

/// 允许访问的根目录。write=true 时不放开整个用户主目录（导出/记忆走显式子目录）。
fn allowed_roots(write: bool) -> Vec<std::path::PathBuf> {
    let cfg = load_config();
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    for s in [cfg.workspace, cfg.hermes_home, cfg.data_dir] {
        if !s.trim().is_empty() {
            roots.push(std::path::PathBuf::from(s));
        }
    }
    if let Some(home) = user_home() {
        for sub in [".mirach", ".dsh", "Desktop", "Downloads", "Documents"] {
            roots.push(home.join(sub));
        }
        if !write {
            roots.push(home);
        }
    }
    roots
}

fn ensure_path_allowed(path: &str, write: bool) -> Result<std::path::PathBuf, String> {
    let target = canonical_lenient(path)?;
    for root in allowed_roots(write) {
        let Ok(root) = canonical_lenient(&root.to_string_lossy()) else {
            continue;
        };
        if target == root || target.starts_with(&root) {
            return Ok(target);
        }
    }
    Err(format!(
        "路径不在允许范围内（仅工作区 / Mirach 目录 / 用户目录）: {path}"
    ))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ================================================================
// PowerShell 终端（portable-pty → powershell.exe，多实例）
// 每个 id（如 "Powershell01" / "Powershell02"）对应一个独立 pty 会话
// ================================================================

struct Terminal {
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
}

struct TerminalState(Mutex<HashMap<String, Terminal>>);

fn close_terminal_inner(state: &State<TerminalState>, id: &str) {
    let mut guard = state.0.lock().unwrap();
    if let Some(t) = guard.remove(id) {
        if let Some(mut child) = t.child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn open_terminal(id: String, state: State<TerminalState>, app: tauri::AppHandle) -> Result<(), String> {
    close_terminal_inner(&state, &id);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.args(["-NoLogo"]);
    // 工作目录定位到配置的项目工作目录（MIRACH_WORKSPACE / config.json）
    cmd.cwd(load_config().workspace);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // 后台线程：读 PowerShell 输出 → 推送到前端（带终端 id）
    let app2 = app.clone();
    let id2 = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit(
                        "terminal-output",
                        serde_json::json!({ "id": id2, "data": text }),
                    );
                }
            }
        }
        let _ = app2.emit("terminal-exit", serde_json::json!({ "id": id2 }));
    });

    let mut guard = state.0.lock().unwrap();
    guard.insert(
        id,
        Terminal {
            master: Some(pair.master),
            writer: Some(writer),
            child: Some(child),
        },
    );
    Ok(())
}

#[tauri::command]
fn terminal_write(id: String, data: String, state: State<TerminalState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(t) = guard.get_mut(&id) {
        if let Some(w) = t.writer.as_mut() {
            w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
            w.flush().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn terminal_resize(id: String, rows: u16, cols: u16, state: State<TerminalState>) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    if let Some(t) = guard.get(&id) {
        if let Some(m) = t.master.as_ref() {
            m.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn close_terminal(id: String, state: State<TerminalState>) {
    close_terminal_inner(&state, &id);
}

#[derive(serde::Serialize)]
struct TerminalInfo {
    id: String,
    running: bool,
}

// 列出所有终端实例及其真实进程运行状态
// （try_wait: Ok(None) = 仍在运行；Ok(Some(_)) = 已退出；Err = 按运行中处理）
#[tauri::command]
fn list_terminals(state: State<TerminalState>) -> Vec<TerminalInfo> {
    let mut guard = state.0.lock().unwrap();
    guard
        .iter_mut()
        .map(|(id, t)| TerminalInfo {
            id: id.clone(),
            running: t
                .child
                .as_mut()
                .map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(true))
                .unwrap_or(false),
        })
        .collect()
}

// ================================================================
// 审查：检查当前 workspace 是否在 Git 仓库中，返回作用域内改动
// ================================================================

#[derive(serde::Serialize)]
struct GitChange {
    path: String,
    status: String,
    /// 是否已暂存（porcelain 第一列非空格/非 ?）
    staged: bool,
}

#[derive(serde::Serialize)]
struct GitStatus {
    in_repo: bool,
    changes: Vec<GitChange>,
    /// 非 git 场景的说明（工作区不存在 / 目录不可读等）
    error: Option<String>,
    /// 当前分支（非仓库/无分支时为 None）
    branch: Option<String>,
    /// 相对 HEAD 的新增/删除行数（含暂存+未暂存）
    added: u32,
    removed: u32,
    /// 相对 upstream 的前进/落后提交数
    ahead: u32,
    behind: u32,
}

/// 运行 git 返回 stdout（失败返回 None）
fn git_out(workspace: &str, args: &[&str]) -> Option<String> {
    let out = console_command("git")
        .args(args)
        .current_dir(workspace)
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

/// 检查工作区 git 状态（最多 5 次 git 子进程）：async + spawn_blocking，
/// 不阻塞 UI 线程。
#[tauri::command]
async fn check_git_workspace() -> GitStatus {
    tauri::async_runtime::spawn_blocking(check_git_workspace_blocking)
        .await
        .unwrap_or_else(|e| GitStatus {
            in_repo: false,
            changes: Vec::new(),
            error: Some(format!("git 检查任务失败：{e}")),
            branch: None,
            added: 0,
            removed: 0,
            ahead: 0,
            behind: 0,
        })
}

fn check_git_workspace_blocking() -> GitStatus {
    // 当前工作区目录（与终端一致，取自已配置）
    let workspace = load_config().workspace;

    if !std::path::Path::new(&workspace).exists() {
        return GitStatus {
            in_repo: false,
            changes: Vec::new(),
            error: Some(format!("工作区目录不存在：{workspace}（可用 set_config / MIRACH_WORKSPACE 配置）")),
            branch: None,
            added: 0,
            removed: 0,
            ahead: 0,
            behind: 0,
        };
    }

    let is_repo = std::path::Path::new(&workspace)
        .join(".git")
        .is_dir();

    if !is_repo {
        return GitStatus {
            in_repo: false,
            changes: Vec::new(),
            error: Some(format!("{workspace} 不是 Git 仓库（没有 .git 目录）")),
            branch: None,
            added: 0,
            removed: 0,
            ahead: 0,
            behind: 0,
        };
    }

    // git status --porcelain：每行 "XY path"
    let output = console_command("git")
        .args(["status", "--porcelain"])
        .current_dir(&workspace)
        .output();

    let mut changes = Vec::new();
    if let Ok(out) = output {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.len() < 4 {
                    continue;
                }
                let bytes = line.as_bytes();
                let staged = bytes[0] != b' ' && bytes[0] != b'?';
                let status = line[..2].trim().to_string();
                let path = line[3..].trim().to_string();
                let status_label = match status.as_str() {
                    "M" | "MM" => "修改",
                    "A" | "AM" => "新增",
                    "D" | "AD" => "删除",
                    "R" | "RM" => "重命名",
                    "U" | "UU" => "冲突",
                    "??" => "未跟踪",
                    _ => status.as_str(),
                };
                changes.push(GitChange {
                    path,
                    status: status_label.to_string(),
                    staged,
                });
            }
        }
    }

    // 分支
    let branch = git_out(&workspace, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|b| !b.is_empty() && b != "HEAD");

    // 相对 HEAD 的增删行数（git diff HEAD --numstat 覆盖暂存+未暂存）
    let (mut added, mut removed) = (0u32, 0u32);
    if let Some(numstat) = git_out(&workspace, &["diff", "HEAD", "--numstat"]) {
        for line in numstat.lines() {
            let mut it = line.split_whitespace();
            if let (Some(a), Some(r)) = (it.next(), it.next()) {
                added += a.parse::<u32>().unwrap_or(0);
                removed += r.parse::<u32>().unwrap_or(0);
            }
        }
    }

    // 相对 upstream 的前进/落后（无 upstream 时按 0）
    let (mut ahead, mut behind) = (0u32, 0u32);
    if let Some(count) = git_out(&workspace, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) {
        let mut it = count.split_whitespace();
        ahead = it.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        behind = it.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    }

    GitStatus {
        in_repo: true,
        changes,
        error: None,
        branch,
        added,
        removed,
        ahead,
        behind,
    }
}

/// 运行时更新配置（写入 %APPDATA%\my-hermes-rs\config.json，局部合并）
/// 用于 UI 里切换工作区等；环境变量优先级更高，会覆盖文件值。
#[tauri::command]
fn set_config(
    workspace: Option<String>,
    hermes_home: Option<String>,
    browser_home: Option<String>,
    web_host: Option<String>,
    update_endpoint: Option<String>,
    remote_enabled: Option<bool>,
    remote_host: Option<String>,
    remote_port: Option<String>,
    remote_node: Option<String>,
    remote_sidecar: Option<String>,
    remote_identity: Option<String>,
) -> Result<(), String> {
    let dir = app_config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("config.json");

    let mut cur: serde_json::Value = std::fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let obj = cur
        .as_object_mut()
        .ok_or_else(|| "config.json 格式错误".to_string())?;

    if let Some(v) = workspace {
        obj.insert("workspace".into(), serde_json::Value::String(v));
    }
    if let Some(v) = hermes_home {
        obj.insert("mirachHome".into(), serde_json::Value::String(v));
    }
    if let Some(v) = browser_home {
        obj.insert("browserHome".into(), serde_json::Value::String(v));
    }
    if let Some(v) = web_host {
        obj.insert("webHost".into(), serde_json::Value::String(v));
    }
    if let Some(v) = update_endpoint {
        obj.insert("updateEndpoint".into(), serde_json::Value::String(v));
    }
    if let Some(v) = remote_enabled {
        obj.insert("remoteEnabled".into(), serde_json::Value::Bool(v));
    }
    for (key, value) in [
        ("remoteHost", remote_host),
        ("remotePort", remote_port),
        ("remoteNode", remote_node),
        ("remoteSidecar", remote_sidecar),
        ("remoteIdentity", remote_identity),
    ] {
        if let Some(v) = value {
            obj.insert(key.into(), serde_json::Value::String(v));
        }
    }

    std::fs::write(&file, serde_json::to_string_pretty(&cur).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 恢复配置为默认：删除 config.json（load_config 回退到内置默认）
#[tauri::command]
fn reset_config() -> Result<(), String> {
    let file = app_config_dir().join("config.json");
    if file.exists() {
        std::fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ================================================================
// Git 审查操作（diff / stage / unstage / revert / commit / push / PR）
// ================================================================

/// 在工作区执行 git 命令，返回 stdout；失败返回 stderr
fn run_git(workspace: &str, args: &[&str]) -> Result<String, String> {
    let out = console_command("git")
        .args(args)
        .current_dir(workspace)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 读取 diff：path 省略时返回全量；staged=true 看暂存区（--cached）
#[tauri::command]
fn git_diff(path: Option<String>, staged: bool) -> Result<String, String> {
    let ws = load_config().workspace;
    let mut args = vec!["diff", "--color=never"];
    if staged {
        args.push("--cached");
    }
    if let Some(p) = path.as_deref() {
        args.push("--");
        args.push(p);
    }
    run_git(&ws, &args)
}

#[tauri::command]
fn git_stage(paths: Vec<String>) -> Result<(), String> {
    let ws = load_config().workspace;
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(|s| s.as_str()));
    run_git(&ws, &args).map(|_| ())
}

#[tauri::command]
fn git_stage_all() -> Result<(), String> {
    run_git(&load_config().workspace, &["add", "-A"]).map(|_| ())
}

#[tauri::command]
fn git_unstage(paths: Vec<String>) -> Result<(), String> {
    let ws = load_config().workspace;
    let mut args = vec!["restore", "--staged", "--"];
    args.extend(paths.iter().map(|s| s.as_str()));
    run_git(&ws, &args).map(|_| ())
}

#[tauri::command]
fn git_unstage_all() -> Result<(), String> {
    run_git(&load_config().workspace, &["reset"]).map(|_| ())
}

/// 还原工作区改动（未暂存部分）；危险操作，前端调用前需确认。
/// 未跟踪文件（??）git restore 不生效，直接删除文件/目录。
#[tauri::command]
fn git_revert(paths: Vec<String>) -> Result<(), String> {
    let ws = load_config().workspace;
    let ws_root = canonical_lenient(&ws)?;
    let mut tracked: Vec<String> = Vec::new();
    for p in &paths {
        // 工作区相对路径 → 绝对路径并做越界校验（删除操作不接受工作区外路径）
        let full = canonical_lenient(&ws_root.join(p).to_string_lossy())?;
        if full != ws_root && !full.starts_with(&ws_root) {
            return Err(format!("路径不在工作区内: {p}"));
        }
        // ls-files --error-unmatch：已跟踪返回 Ok，未跟踪返回 Err
        if run_git(&ws, &["ls-files", "--error-unmatch", "--", p]).is_ok() {
            tracked.push(p.clone());
        } else {
            let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
            if meta.is_dir() {
                std::fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
            } else {
                std::fs::remove_file(&full).map_err(|e| e.to_string())?;
            }
        }
    }
    if !tracked.is_empty() {
        let mut args = vec!["restore", "--"];
        args.extend(tracked.iter().map(|s| s.as_str()));
        run_git(&ws, &args)?;
    }
    Ok(())
}

#[tauri::command]
async fn git_commit(message: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&load_config().workspace, &["commit", "-m", &message]).map(|_| ())
    })
    .await
    .map_err(|e| format!("git_commit task failed: {e}"))?
}

#[tauri::command]
async fn git_push() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| run_git(&load_config().workspace, &["push"]).map(|_| ()))
        .await
        .map_err(|e| format!("git_push task failed: {e}"))?
}

/// 创建 PR：先推送当前分支到 origin，再调 gh pr create（依赖 gh CLI）
#[tauri::command]
async fn git_create_pr(title: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_create_pr_blocking(title))
        .await
        .map_err(|e| format!("git_create_pr task failed: {e}"))?
}

fn git_create_pr_blocking(title: String) -> Result<String, String> {
    let ws = load_config().workspace;
    run_git(&ws, &["push", "-u", "origin", "HEAD"]).map_err(|e| format!("推送分支失败: {e}"))?;
    let out = console_command("gh")
        .args(["pr", "create", "--title", &title, "--fill"])
        .current_dir(&ws)
        .output()
        .map_err(|e| format!("无法启动 gh CLI（未安装?）: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Git 提交身份（--global；未设置时对应字段为 null）
#[derive(serde::Serialize)]
struct GitUser {
    name: Option<String>,
    email: Option<String>,
}

/// 读取全局 Git 提交身份（git config --global --get user.name / user.email）
/// 命令不带 current_dir：--global 不依赖工作区，且工作区目录可能不存在。
#[tauri::command]
fn git_get_user() -> GitUser {
    let read = |key: &str| -> Option<String> {
        let out = console_command("git")
            .args(["config", "--global", "--get", key])
            .output()
            .ok()?;
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        } else {
            None
        }
    };
    GitUser {
        name: read("user.name"),
        email: read("user.email"),
    }
}

/// 写入全局 Git 提交身份；仅更新非空字段
#[tauri::command]
fn git_set_user(name: Option<String>, email: Option<String>) -> Result<(), String> {
    let set = |key: &str, value: &str| -> Result<(), String> {
        let out = console_command("git")
            .args(["config", "--global", key, value])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    };
    if let Some(n) = name.as_deref() {
        if !n.trim().is_empty() {
            set("user.name", n.trim())?;
        }
    }
    if let Some(e) = email.as_deref() {
        if !e.trim().is_empty() {
            set("user.email", e.trim())?;
        }
    }
    Ok(())
}

/// 清除凭据管理器中保存的远程登录信息（git credential reject，凭据经 stdin 协议传入）。
/// 清除后下次 push 会重新弹出登录框输入新密码——即"改密码/切换账户"的落地方式。
#[tauri::command]
fn git_clear_credential(host: String) -> Result<(), String> {
    // 凭据协议按行解析：host 含换行会注入额外字段（可改到别的站点）
    let host = host.trim().to_string();
    if host.is_empty()
        || host.len() > 255
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
    {
        return Err(format!("非法主机名: {host}"));
    }
    let mut child = console_command("git")
        .args(["credential", "reject"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("protocol=https\nhost={host}\n\n").as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// ================================================================
// 内嵌浏览器（child webview，tauri unstable feature）
// 在 main 窗口内嵌入一个 WebView2 子视图，渲染任意网页
// ================================================================

const BROWSER_WEBVIEW: &str = "hermes-browser";

/// 打开/创建内嵌浏览器（已存在则显示并导航；位置尺寸由前端传入）
/// 注意：必须在 async command 中创建（Windows 上同步 command 会死锁）
#[tauri::command]
async fn browser_open(
    app: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let target = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    // 已存在：显示、导航、定位
    if let Some(wv) = app.get_webview(BROWSER_WEBVIEW) {
        let _ = wv.show();
        let _ = wv.navigate(target);
        let _ = wv.set_position(tauri::LogicalPosition::new(x, y));
        let _ = wv.set_size(tauri::LogicalSize::new(w, h));
        return Ok(());
    }

    let window = app.get_window("main").ok_or("main window not found")?;

    let app2 = app.clone();
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 HermesBrowser/1.0";
    let builder = tauri::webview::WebviewBuilder::new(BROWSER_WEBVIEW, tauri::WebviewUrl::External(target))
        .user_agent(ua)
        // 导航变化 → 前端地址栏同步
        .on_navigation(move |u| {
            let _ = app2.emit("browser-nav", u.to_string());
            true
        })
        // 页面加载完成 → 前端地址栏确认
        .on_page_load(move |_wv, payload| {
            let _ = app.emit("browser-load", payload.url().to_string());
        });

    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(w, h),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn browser_navigate(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    let target = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    wv.navigate(target).map_err(|e| e.to_string())
}

#[tauri::command]
async fn browser_back(app: tauri::AppHandle) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    wv.eval("window.history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
async fn browser_forward(app: tauri::AppHandle) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    wv.eval("window.history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
async fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    wv.reload().map_err(|e| e.to_string())
}

/// 窗口缩放/移动时同步 child webview 位置尺寸
#[tauri::command]
async fn browser_set_bounds(app: tauri::AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    wv.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    wv.set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())
}

/// 切换回浏览器标签时：显示并定位（保留页面状态，不重新导航）
/// 参数可空：全部省略时仅显示（保留上次位置），用于弹窗遮挡场景
#[tauri::command]
async fn browser_show(
    app: tauri::AppHandle,
    x: Option<f64>,
    y: Option<f64>,
    w: Option<f64>,
    h: Option<f64>,
) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    if let (Some(x), Some(y), Some(w), Some(h)) = (x, y, w, h) {
        let _ = wv.set_position(tauri::LogicalPosition::new(x, y));
        let _ = wv.set_size(tauri::LogicalSize::new(w, h));
    }
    wv.show().map_err(|e| e.to_string())
}

/// 切换到其他标签时隐藏浏览器（保留页面状态）
#[tauri::command]
async fn browser_hide(app: tauri::AppHandle) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    wv.hide().map_err(|e| e.to_string())
}

/// 打开 child webview 的调试工具（DevTools）；devtools feature 仅 debug 构建启用
#[tauri::command]
async fn browser_devtools(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
        wv.open_devtools();
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app; // release 构建未启用 devtools feature：静默忽略
    }
    Ok(())
}

/// 在默认浏览器中打开当前地址（由前端调 opener 或直接 openUrl）
/// 注入"选择网页元素"脚本：hover 高亮 + 点击选中（结果存入 window.__hermesPicked）
#[tauri::command]
async fn browser_pick_start(app: tauri::AppHandle) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    let script = r#"
(() => {
  if (window.__hermesPicker) { window.__hermesPicker(); delete window.__hermesPicker; return; }
  const style = document.createElement('style');
  style.id = '__hermes-pick-style';
  style.textContent = '.__hermes-pick-outline{outline:2px solid #6366F1 !important;outline-offset:-2px;background:rgba(99,102,241,0.08) !important;}';
  document.head.appendChild(style);
  let cur = null;
  const onMove = (e) => { if (cur) cur.classList.remove('__hermes-pick-outline'); cur = e.target; if (cur) cur.classList.add('__hermes-pick-outline'); };
  const onClick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.target;
    if (el) { el.classList.remove('__hermes-pick-outline'); window.__hermesPicked = el.outerHTML.slice(0, 8000); }
    cleanup();
  };
  const cleanup = () => {
    document.removeEventListener('mouseover', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.getElementById('__hermes-pick-style')?.remove();
    if (cur) cur.classList.remove('__hermes-pick-outline');
    delete window.__hermesPicker;
  };
  document.addEventListener('mouseover', onMove, true);
  document.addEventListener('click', onClick, true);
  window.__hermesPicker = cleanup;
})();
"#;
    wv.eval(script).map_err(|e| e.to_string())
}

/// 读取元素选择结果（脚本点击后存入 window.__hermesPicked，读取即清除）
#[tauri::command]
async fn browser_pick_result(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    // tokio oneshot + timeout：不占住 async worker（原 std mpsc recv_timeout 会阻塞 800ms）
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Mutex::new(Some(tx));
    wv.eval_with_callback(
        "(() => { const v = window.__hermesPicked; if (v) { delete window.__hermesPicked; return v; } return null; })()",
        move |res| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(res);
            }
        },
    )
    .map_err(|e| e.to_string())?;
    match tokio::time::timeout(std::time::Duration::from_millis(800), rx).await {
        Ok(Ok(s)) if !s.is_empty() && s != "null" => {
            // 结果是 JSON 序列化字符串，尝试解包
            match serde_json::from_str::<String>(&s) {
                Ok(v) if !v.is_empty() => Ok(Some(v)),
                _ => Ok(Some(s)),
            }
        }
        _ => Ok(None),
    }
}

/// 设置网页缩放（CSS zoom，无 WebView2 原生 0.2~2.0 范围限制）
/// scale = 1.0 表示原始大小；<1 缩小、>1 放大
#[tauri::command]
async fn browser_set_zoom(app: tauri::AppHandle, scale: f64) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_WEBVIEW).ok_or("browser not open")?;
    let clamped = scale.clamp(0.05, 5.0);
    let js = format!("document.documentElement.style.zoom = '{}';", clamped);
    wv.eval(js).map_err(|e| e.to_string())
}

#[tauri::command]
async fn browser_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(BROWSER_WEBVIEW) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ================================================================
// 覆盖层（overlay）— 透明 child webview，承载浏览器区域弹窗
// 在浏览器 webview 之后创建（z 序更高），弹窗渲染在其中真正盖住浏览器。
// 弹窗内容由主应用通过 "overlay:show" / "overlay:hide" 事件同步（见
// src/components/overlay/events.ts），本侧只负责 webview 的创建/定位/显隐。
// ================================================================

const OVERLAY_WEBVIEW: &str = "hermes-overlay";

/// 显示覆盖层（浏览器区域弹窗）：已存在则定位/缩放后显示；
/// 不存在则创建透明 child webview，注入 __OVERLAY_WEBVIEW__ 标记，
/// 同一前端 bundle 按标记分流渲染 OverlayApp（main.tsx）。
/// 位置/尺寸由前端传入（卡片外扩 OVERLAY_PAD 的留白，阴影不裁剪）。
#[tauri::command]
async fn overlay_show(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(OVERLAY_WEBVIEW) {
        let _ = wv.set_position(tauri::LogicalPosition::new(x, y));
        let _ = wv.set_size(tauri::LogicalSize::new(w, h));
        wv.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app.get_window("main").ok_or("main window not found")?;
    let builder = tauri::webview::WebviewBuilder::new(
        OVERLAY_WEBVIEW,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .transparent(true)
    // 标记覆盖层页面 + 立即置透明背景（body 默认 #f0f0f0，防白/灰闪）
    .initialization_script(
        "window.__OVERLAY_WEBVIEW__ = true; \
         const _hs = document.createElement('style'); \
         _hs.textContent = 'html, body { background: transparent !important; }'; \
         (document.head || document.documentElement).appendChild(_hs);",
    );

    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(w, h),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 隐藏覆盖层（保留页面状态，弹窗内容由 overlay:hide 事件清空）
#[tauri::command]
async fn overlay_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(OVERLAY_WEBVIEW) {
        wv.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 覆盖层尺寸校准：弹窗卡片实际尺寸（含留白）由 OverlayApp 测量后回传
#[tauri::command]
async fn overlay_resize(app: tauri::AppHandle, w: f64, h: f64) -> Result<(), String> {
    if let Some(wv) = app.get_webview(OVERLAY_WEBVIEW) {
        wv.set_size(tauri::LogicalSize::new(w, h))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ================================================================
// 文件浏览器（read_dir / read_file / rename / delete / reveal）
// ================================================================

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// 扫描目录（跳过常见噪音目录：node_modules/.git/target/dist/.venv/__pycache__）
#[tauri::command]
async fn read_dir(path: String) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || read_dir_blocking(path))
        .await
        .map_err(|e| format!("read_dir task failed: {e}"))?
}

fn read_dir_blocking(path: String) -> Result<Vec<FileEntry>, String> {
    let path = ensure_path_allowed(&path, false)?;
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if ["node_modules", ".git", "target", "dist", ".venv", "__pycache__"].contains(&name.as_str()) {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    // 目录在前，按名称排序
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// 以文本读取文件（>2MB 跳过，防整读超大二进制）
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let path = ensure_path_allowed(&path, false)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err("文件超过 2MB，跳过预览".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("无法以文本读取（可能是二进制）: {e}"))
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let from = ensure_path_allowed(&from, true)?;
    let to = ensure_path_allowed(&to, true)?;
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_path_blocking(path))
        .await
        .map_err(|e| format!("delete_path task failed: {e}"))?
}

fn delete_path_blocking(path: String) -> Result<(), String> {
    let path = ensure_path_allowed(&path, true)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

/// 在文件管理器中显示该文件/目录（Windows: explorer /select,<path> 必须单参数）
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let path = ensure_path_allowed(&path, false)?;
    #[cfg(target_os = "windows")]
    let child = console_command("explorer").arg(format!("/select,{}", path.display())).spawn();
    #[cfg(target_os = "macos")]
    let child = std::process::Command::new("open").args(["-R"]).arg(&path).spawn();
    #[cfg(target_os = "linux")]
    let child = std::process::Command::new("xdg-open")
        .arg(path.parent().unwrap_or(&path))
        .spawn();
    child.map_err(|e| e.to_string())?;
    Ok(())
}

// ================================================================
// 简约对话引擎（zosma 移植）辅助命令
// ================================================================

/// 用系统默认程序打开 URL / file:// 路径（zosma AttachmentCard 等使用）。
/// 只接受显式白名单 scheme，且不经 shell（open 插件走 ShellExecuteW）——
/// 避免 URL 内容被 cmd.exe 解析成命令，也避免任意本地程序被执行。
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    let scheme = url.split(':').next().unwrap_or("").to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https" | "mailto" | "file") {
        return Err(format!("不支持的链接协议: {scheme}"));
    }
    if url.chars().any(|c| c.is_control()) {
        return Err("链接包含控制字符".to_string());
    }
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("open: {e}"))
}

/// 写用户文件（zosma 导出等；路径由前端决定）。父目录不存在时自动创建
/// （环境记忆 .mirach/MEMORY.md 首次保存、团队导出等依赖）。
#[tauri::command]
async fn write_user_file(path: String, content: String) -> Result<(), String> {
    let p = ensure_path_allowed(&path, true)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir: {e}"))?;
    }
    std::fs::write(&p, &content).map_err(|e| format!("write_file: {e}"))
}

/// 读二进制文件（SillyTavern PNG 角色卡解析用）；>10MB 拒绝。
/// 返回字节数组（JSON 序列化为 number[]，典型 PNG 卡几百 KB 可接受）。
#[tauri::command]
async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let path = ensure_path_allowed(&path, false)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 10 * 1024 * 1024 {
        return Err("文件超过 10MB".to_string());
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// 拉取远程文本（在线角色市场等）：ureq GET，10s 超时，>5MB 拒绝。
/// 走 Rust 侧请求避开 WebView CORS 限制。
#[tauri::command]
async fn fetch_text(url: String) -> Result<String, String> {
    use std::time::Duration;
    tauri::async_runtime::spawn_blocking(move || {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("仅支持 http(s) 地址".to_string());
        }
        let resp = ureq::get(&url)
            .timeout(Duration::from_secs(10))
            .call()
            .map_err(|e| format!("fetch: {e}"))?;
        let len = resp
            .header("Content-Length")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        if len > 5 * 1024 * 1024 {
            return Err("文件过大（>5MB）".to_string());
        }
        let text = resp.into_string().map_err(|e| format!("read: {e}"))?;
        if text.len() > 5 * 1024 * 1024 {
            return Err("文件过大（>5MB）".to_string());
        }
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 返回当前工作区路径（简约对话 UI 显示"在哪工作"）。
#[tauri::command]
fn get_workspace() -> Result<String, String> {
    Ok(load_config().workspace)
}

// ================================================================
// 应用自更新（Tauri updater：静态 JSON 端点 + minisign 签名校验）
// 端点来自配置 updateEndpoint（空 = 未配置）；公钥在 tauri.conf.json plugins.updater。
// ================================================================

async fn build_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let endpoint = load_config().update_endpoint;
    if endpoint.trim().is_empty() {
        return Err("未配置应用更新源（config.json 的 updateEndpoint 或 MIRACH_UPDATE_ENDPOINT）".to_string());
    }
    let url = tauri::Url::parse(endpoint.trim()).map_err(|e| format!("更新源地址非法: {e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| format!("更新源被拒绝: {e}"))?
        .build()
        .map_err(|e| format!("更新器构建失败: {e}"))
}

/// 便携包运行（exe 旁有 runtime/）= 更新必须换整包：安装器只装外壳，会把
/// 便携版用户带到一份没有运行时的新安装里。检查更新照常，安装要指到发布页。
fn portable_install_note() -> Option<String> {
    if dsh_relay::is_portable_runtime() {
        Some(
            "便携版请手动更新：到发布页下载新版便携包并解压覆盖（安装器只含外壳，不含 Node/引擎/桥接）"
                .to_string(),
        )
    } else {
        None
    }
}

/// 检查应用更新：返回 {available, version, currentVersion, notes, date}。
#[tauri::command]
async fn app_update_check(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let updater = build_updater(&app).await?;
    let portable = portable_install_note();
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "currentVersion": update.current_version,
            "notes": update.body,
            "date": update.date.map(|d| d.to_string()),
            // 便携版：前端据此把"下载并安装"替换成"去发布页下载"
            "portable": portable.is_some(),
            "installHint": portable,
        })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Err(format!("检查更新失败: {e}")),
    }
}

/// 下载并安装应用更新（Windows NSIS 安装器接管后应用退出，重启即为新版本）。
/// 便携版直接拒绝：安装器不含运行时，会把用户带进坏安装。
#[tauri::command]
async fn app_update_install(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(hint) = portable_install_note() {
        return Err(hint);
    }
    let updater = build_updater(&app).await?;
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .map_err(|e| format!("下载/安装失败: {e}"))?;
            Ok(version)
        }
        Ok(None) => Err("没有可用更新".to_string()),
        Err(e) => Err(format!("检查更新失败: {e}")),
    }
}

/// 遥测开关（本应用不采集遥测，兼容 zosma 前端调用）。
#[tauri::command]
fn set_analytics_enabled(_enabled: bool) -> Result<(), String> {
    Ok(())
}

/// 遥测事件（no-op，兼容 zosma 前端调用）。
#[tauri::command]
fn track_analytics_event(_name: String, _params: Option<serde_json::Value>) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// 递归目录拷贝（std::fs::copy_dir_all 在本工具链尚不可用）。
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            let _ = copy_dir_recursive(&entry.path(), &target);
        } else {
            let _ = std::fs::copy(entry.path(), &target);
        }
    }
    Ok(())
}

pub fn run() {
    // Mirach 更名一次性迁移：旧标识数据目录（WebView2/本地存储）整体搬入新标识，
    // 密码/会话/配置无缝继承。新目录已存在（二次启动）则跳过。
    {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
        if !base.is_empty() {
            let old_dir = std::path::PathBuf::from(&base).join("com.hanqingzhou.my-hermes-rs");
            let new_dir = std::path::PathBuf::from(&base).join("com.hanqingzhou.mirach");
            if old_dir.exists() {
                // 选择性容错迁移：只搬数据目录（Local Storage/IndexedDB/Session
                // Storage），跳过缓存类子目录；单文件失败不阻断（EBWebView 缓存
                // 有数万小文件，整目录强一致拷贝会因个别锁定文件整体失败——
                // 此前"密码/配置全丢"就是整目录版本半途而废所致）。
                let src_default = old_dir.join("EBWebView").join("Default");
                if src_default.exists() {
                    let dst_root = new_dir.join("EBWebView");
                    let dst_default = dst_root.join("Default");
                    let data_dirs = ["Local Storage", "IndexedDB", "Session Storage"];
                    let mut moved_any = false;
                    for sub in data_dirs {
                        let from = src_default.join(sub);
                        if from.exists() && copy_dir_recursive(&from, &dst_default.join(sub)).is_ok() {
                            moved_any = true;
                        }
                    }
                    // 根级首选项文件（Local State 等）尽力拷贝
                    for f in ["Local State"] {
                        let from = old_dir.join("EBWebView").join(f);
                        if from.exists() {
                            let _ = std::fs::create_dir_all(&dst_root);
                            let _ = std::fs::copy(&from, dst_root.join(f));
                        }
                    }
                    if moved_any {
                        eprintln!("[mirach] migrated app data (selective): {} -> {}", old_dir.display(), new_dir.display());
                    }
                }
            }
        }
    }
    tauri::Builder::default()
        // 单实例锁必须最先注册：第二次启动只聚焦已有主窗口（官方桌面壳同款
        // 语义；也避免两个进程同时写同一份 sidecar/引擎数据）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            eprintln!("[mirach] second instance blocked — focused existing window");
        }))
        .plugin(tauri_plugin_opener::init())
        // 原生文件夹/文件选择对话框（环境插件工作区"选择文件夹"）
        .plugin(tauri_plugin_dialog::init())
        // 全局快捷键：Alt+Space 唤起 quick entry 迷你窗口
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let app2 = app.clone();
                        let app3 = app2.clone();
                        let _ = app2.run_on_main_thread(move || {
                            let _ = open_quick_entry_window(app3);
                        });
                    }
                })
                .build(),
        )
        // deep link（hermes:// 协议；Windows 需安装/注册 scheme）
        .plugin(tauri_plugin_deep_link::init())
        // 应用自更新（端点/公钥见 AppConfig.update_endpoint 与 tauri.conf.json）
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            // 单实例竞态兜底：插件靠"找到首实例事件窗口"才退出，若第二次启动
            // 早于首实例建窗（双击图标/开机自启），插件会放行 → 两个引擎同写
            // 同一份数据。这里用独立命名互斥量兜底：拿不到就立即退出。
            #[cfg(target_os = "windows")]
            {
                use windows::core::PCWSTR;
                use windows::Win32::Foundation::{CloseHandle, ERROR_ALREADY_EXISTS};
                use windows::Win32::System::Threading::CreateMutexW;
                let name: Vec<u16> = "com.hanqingzhou.mirach-primary\0".encode_utf16().collect();
                match unsafe { CreateMutexW(None, true, PCWSTR(name.as_ptr())) } {
                    Ok(handle) => {
                        if unsafe { windows::Win32::Foundation::GetLastError() } == ERROR_ALREADY_EXISTS {
                            eprintln!("[mirach] secondary instance — exiting (primary mutex held)");
                            unsafe {
                                let _ = CloseHandle(handle);
                            }
                            std::process::exit(0);
                        }
                        // 持有到进程结束：句柄不关闭即持续占有该名字
                        let _ = handle;
                    }
                    Err(e) => eprintln!("[mirach] single-instance mutex unavailable: {e}"),
                }
            }
            let _ = app.global_shortcut().register("Alt+Space");
            // 简约对话引擎 sidecar（dsh 中继）——异步 spawn，不阻塞启动
            dsh_relay::setup_sidecar(app.handle(), dsh_relay::DshAppState::default());
            // 40px 圆角 + 圆角阴影：透明窗口 + 内容 rounded-40 + 面板背后同圆角阴影层（见 AppLayout）。
            // 这里把 WebView 背景设为 RGBA 全透明（tauri::webview::Color），修"圆角背后直角/背景"——
            // 只设配置 backgroundColor 不够，需在 Rust 侧真正设 WebView 背景（CSDN 文章关键点）。
            #[cfg(target_os = "windows")]
            {
                if let Some(win) = app.get_webview_window("main") {
                    // 1) WebView 背景全透明
                    let _ = win.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
                    // 2) DWM 关掉 Win11 系统 ~8px 圆角（只留内容 40px 圆角）
                    if let Ok(hwnd) = win.hwnd() {
                        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};
                        let pref: i32 = 1; // DWMWCP_DONOTROUND
                        unsafe {
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWINDOWATTRIBUTE(33), // DWMWA_WINDOW_CORNER_PREFERENCE
                                &pref as *const i32 as *const _,
                                std::mem::size_of::<i32>() as u32,
                            );
                        }
                    }
                    // 3) 麦克风权限（全双工语音：没有这个钩子 getUserMedia 会被直接拒绝）
                    attach_mic_permission(&win);
                }
            }
            Ok(())
        })
        .manage(TerminalState(Mutex::new(HashMap::new())))
        .manage(bootstrap::BootstrapState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_config,
            set_config,
            reset_config,
            relay::relay_probe,
            open_terminal,
            terminal_write,
            terminal_resize,
            close_terminal,
            list_terminals,
            check_git_workspace,
            browser_open,
            browser_navigate,
            browser_back,
            browser_forward,
            browser_reload,
            browser_set_bounds,
            browser_show,
            browser_hide,
            browser_devtools,
            browser_pick_start,
            browser_pick_result,
            browser_set_zoom,
            browser_close,
            overlay_show,
            overlay_hide,
            overlay_resize,
            read_dir,
            read_file,
            rename_path,
            delete_path,
            reveal_path,
            git_diff,
            git_stage,
            git_stage_all,
            git_unstage,
            git_unstage_all,
            git_revert,
            git_commit,
            git_push,
            git_create_pr,
            git_get_user,
            git_set_user,
            git_clear_credential,
            sessions::sessions_list,
            sessions::sessions_search,
            sessions::sessions_load,
            sessions::sessions_rename,
            sessions::sessions_delete,
            dsh_relay::send_prompt,
            dsh_relay::abort_prompt,
            dsh_relay::steer_prompt,
            dsh_relay::follow_up_prompt,
            dsh_relay::clear_queue,
            dsh_relay::sync_provider_config,
            dsh_relay::get_models,
            dsh_relay::get_active_model,
            dsh_relay::set_active_model,
            dsh_relay::load_dsh_session,
            dsh_relay::dsh_get_history,
            dsh_relay::dsh_set_effort,
            dsh_relay::dsh_set_env,
            dsh_relay::dsh_rpc,
            dsh_relay::dsh_http_proxy,
            dsh_relay::dsh_http_proxy_chunk,
            dsh_relay::dsh_http_proxy_cancel,
            dsh_relay::ssh_test,
            dsh_relay::dsh_restart_sidecar,
            dsh_relay::dsh_mux_open,
            dsh_relay::dsh_mux_close,
            dsh_relay::dsh_list_sessions,
            dsh_relay::dsh_sidecar_ready,
            dsh_relay::dsh_engine_ready,
            dsh_relay::dsh_prewarm,
            dsh_relay::toggle_main_maximize,
            open_url,
            write_user_file,
            fetch_text,
            read_file_bytes,
            get_workspace,
            bootstrap::bootstrap_status,
            bootstrap::bootstrap_start,
            bootstrap::bootstrap_cancel,
            bootstrap::bootstrap_reset,
            app_update_check,
            app_update_install,
            set_analytics_enabled,
            track_analytics_event,
            open_session_window,
            hud_open,
            hud_close,
            hud_set_bounds,
            hud_begin_move,
            hud_set_ignore_mouse
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // 退出时清理 dsh sidecar 进程树（node/dsh runtime 会残留）
            if let tauri::RunEvent::Exit = event {
                if app.try_state::<dsh_relay::DshAppState>().is_some() {
                    dsh_relay::shutdown_sidecar(app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{canonical_lenient, ensure_path_allowed, load_config};

    /// 发布产物签名自检：`target/release/bundle/nsis/Mirach_*.exe` + `.sig` 必须能用
    /// tauri.conf.json 里的公钥验签（与 tauri-plugin-updater 同一条校验链路）。
    /// 未构建发布产物时跳过——它守护的是"签名与内置公钥一致"，不是常规单测。
    #[test]
    fn release_artifact_signature_matches_embedded_pubkey() {
        use base64::Engine as _;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let nsis = root.join("target").join("release").join("bundle").join("nsis");
        let Some(exe) = std::fs::read_dir(&nsis).ok().and_then(|dir| {
            dir.flatten()
                .map(|e| e.path())
                .find(|p| {
                    p.extension().map(|e| e == "exe").unwrap_or(false)
                        && p.file_name()
                            .map(|n| n.to_string_lossy().starts_with("Mirach_"))
                            .unwrap_or(false)
                })
        }) else {
            return;
        };
        let Ok(sig_b64) = std::fs::read_to_string(exe.with_extension("exe.sig")) else {
            return;
        };
        let conf: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(root.join("tauri.conf.json")).expect("tauri.conf.json readable"),
        )
        .expect("tauri.conf.json is valid JSON");
        let pubkey_b64 = conf["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("updater pubkey present")
            .trim()
            .to_string();

        let engine = base64::engine::general_purpose::STANDARD;
        let pubkey_text = String::from_utf8(engine.decode(pubkey_b64).expect("pubkey base64")).expect("pubkey utf8");
        let sig_text = String::from_utf8(engine.decode(sig_b64.trim()).expect("signature base64")).expect("signature utf8");
        let public_key = minisign_verify::PublicKey::decode(&pubkey_text).expect("minisign public key");
        let signature = minisign_verify::Signature::decode(&sig_text).expect("minisign signature");
        let data = std::fs::read(&exe).expect("installer bytes");
        public_key
            .verify(&data, &signature, true)
            .expect("发布产物签名必须与内置公钥匹配");
    }

    #[test]
    fn path_allowlist_blocks_outside_roots() {
        // 系统目录不在白名单内（工作区/Mirach 目录/用户目录之外）
        let target = if cfg!(windows) {
            "C:\\Windows\\System32\\drivers\\etc\\hosts"
        } else {
            "/etc/hosts"
        };
        assert!(ensure_path_allowed(target, false).is_err());
    }

    #[test]
    fn canonical_lenient_removes_dotdot() {
        let Some(home) = super::user_home() else { return };
        let probe = format!("{}\\probe\\..\\..\\x", home.display());
        let resolved = canonical_lenient(&probe).expect("resolvable");
        // 词法规整后不应残留 ..（否则 OS 解析时可能越出白名单根）
        assert!(!resolved.to_string_lossy().contains(".."));
    }

    #[test]
    fn data_dir_is_writable() {
        // 应用数据目录始终在白名单内（配置/记忆写入依赖）
        let dir = load_config().data_dir;
        if !dir.is_empty() {
            assert!(ensure_path_allowed(&dir, true).is_ok());
        }
    }
}

// ================================================================
// 多窗口 / quick entry 迷你窗
// ================================================================

/// 打开会话 / 新实例窗口（同一 bundle，?win=label 参数区分；避免重复）
#[tauri::command]
async fn open_session_window(
    app: tauri::AppHandle,
    session_id: Option<String>,
) -> Result<(), String> {
    let label = match session_id.as_deref() {
        Some(id) if !id.is_empty() => format!("session-{id}"),
        _ => {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            format!("session-new-{ts}")
        }
    };
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    let url = tauri::WebviewUrl::App(format!("index.html?win={label}").into());
    tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title("Mirach 会话")
        .inner_size(1180.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 打开 quick entry 迷你窗口（无边框置顶；已存在则聚焦）
fn open_quick_entry_window(app: tauri::AppHandle) -> Result<(), String> {
    const LABEL: &str = "quick-entry";
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html?win=quick-entry".into());
    tauri::WebviewWindowBuilder::new(&app, LABEL, url)
        .title("Quick Entry")
        .inner_size(520.0, 110.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .center()
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ================================================================
// WebView2 权限钩子（麦克风）——全双工语音的前置条件
// ================================================================

/// HUD 悬浮窗 label（与前端 main.tsx 的 `?win=hud` 分流对应）
const HUD_LABEL: &str = "hud";
/// hermes spawnHudWindow 同款最小尺寸（与 resize-handle 的钳制值一致）
const HUD_MIN_WIDTH: f64 = 380.0;
const HUD_MIN_HEIGHT: f64 = 160.0;

/// 给窗口的 WebView2 注册权限处理：**只放行麦克风**，其余（摄像头/位置/通知…）一律拒绝。
///
/// 为什么必须自己注册：wry 只在其 clipboard 属性开启时注册 PermissionRequested，而 Tauri 默认
/// clipboard=false、我们也没开 → WebView2 收不到任何处理，`getUserMedia({audio:true})` 直接
/// 返回 `NotAllowedError: Permission denied by system`（2026-09 实测，AudioWorklet 正常）。
/// Windows 侧的"桌面应用访问麦克风"是允许的，所以只差这一个钩子。
#[cfg(target_os = "windows")]
fn attach_mic_permission(win: &tauri::WebviewWindow) {
    let _ = win.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        };
        use webview2_com::PermissionRequestedEventHandler;

        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(e) => {
                eprintln!("[mirach] CoreWebView2 unavailable, mic permission not wired: {e}");
                return;
            }
        };
        // WebView2 自己 AddRef 处理器，token 只是给 remove_ 用；不存也算保持存活
        let mut token: i64 = 0;
        let registered = unsafe {
            core.add_PermissionRequested(
                &PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
                    if let Some(args) = args {
                        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                        args.PermissionKind(&mut kind)?;
                        let state = if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                            COREWEBVIEW2_PERMISSION_STATE_ALLOW
                        } else {
                            COREWEBVIEW2_PERMISSION_STATE_DENY
                        };
                        // 诊断用：确认钩子真的被调用（kind=1 即 MICROPHONE）
                        eprintln!("[mirach] permission request kind={} -> state={}", kind.0, state.0);
                        args.SetState(state)?;
                    }
                    Ok(())
                })),
                &mut token,
            )
        };
        if let Err(e) = registered {
            eprintln!("[mirach] add_PermissionRequested failed: {e}");
        }
        let _ = token;
    });
}

#[cfg(not(target_os = "windows"))]
fn attach_mic_permission(_win: &tauri::WebviewWindow) {}

#[tauri::command]
async fn hud_open(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html?win=hud".into());
    // hermes 的做法（Electron main.ts createHudWindow + wireWindowReveal）：
    // **show:false 建窗，等页面就绪再 show**。mirach 实测：webview 就绪前就 show 时，
    // Windows 上的透明无边框窗会变成“查得到、没句柄”的僵尸窗（build() 返回 Ok 但
    // hwnd=Unavailable、EnumWindows 看不到、前端永远起不来）。
    // 照搬 hermes：visible(false) 建 → 页面加载完 show + focus；再加 1.5s 兜底
    //（hermes 也有 did-finish-load 兜底定时器，防就绪事件丢失）。
    let hud = tauri::WebviewWindowBuilder::new(&app, HUD_LABEL, url)
        .title("Mirach HUD")
        .inner_size(520.0, 420.0)
        .min_inner_size(HUD_MIN_WIDTH, HUD_MIN_HEIGHT)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false) // hermes 同款：程序化 setBounds，防系统缩放热区
        .visible(false)
        .on_page_load(|win, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = win.show();
                let _ = win.set_focus();
                let _ = win.set_always_on_top(true);
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    // 透明窗口必须显式把 WebView 背景设透明（主窗同样处理，否则透明处发黑）
    let _ = hud.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
    // 兜底：页面就绪事件没来也要显示（hermes 的 did-finish-load 兜底同责）
    {
        let win = hud.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let _ = win.show();
        });
    }
    // HUD 是语音条宿主，麦克风权限钩子同样要挂（语音面板可能只在 HUD 里开）
    attach_mic_permission(&hud);
    Ok(())
}

/// 关闭 HUD（主窗口或 HUD 自身都可调用）
#[tauri::command]
async fn hud_close(app: tauri::AppHandle) -> Result<(), String> {
    eprintln!("[hud] close requested");
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.close();
    }
    Ok(())
}

/// HUD 程序化改位置/尺寸（resize-handle 的 setBounds 面；Windows 透明无边框
/// 窗禁用 resizable 后 set_bounds 是唯一缩放路径，与 hermes main 进程同责）
#[tauri::command]
async fn hud_set_bounds(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.set_resizable(true);
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        let _ = win.set_size(tauri::LogicalSize::new(
            width.max(HUD_MIN_WIDTH),
            height.max(HUD_MIN_HEIGHT),
        ));
        let _ = win.set_resizable(false);
    }
    Ok(())
}

/// 拖动移动窗口（composer-drag 的 beginMove 面 → Tauri 原生拖拽）
#[tauri::command]
async fn hud_begin_move(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.start_dragging();
    }
    Ok(())
}

/// 指针穿透开关（click-through：透明区忽略鼠标）
#[tauri::command]
async fn hud_set_ignore_mouse(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
    Ok(())
}
