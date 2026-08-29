// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

mod acp;
mod dsh_relay;
mod relay;
mod relay_cron;
mod sessions;

// ================================================================
// 应用配置（工作目录 / Hermes 文件夹 / 浏览器首页 / 引擎地址）
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
    /// Agent 引擎地址（Relay 转发目标，见 relay.rs）
    engine_base: String,
    /// 平台 api_server 基址（8090，cron /api/jobs 等）
    api_base: String,
    /// api_server Bearer token（API_SERVER_KEY；可选）
    api_token: String,
    /// hermes CLI 可执行文件路径（ACP 边车用；留空 = 走 PATH）
    hermes_bin: String,
    /// 应用数据目录（%APPDATA%\my-hermes-rs，日志/配置存放处）
    data_dir: String,
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

    AppConfig {
        workspace: get("workspace", "MIRACH_WORKSPACE", "D:\\hermes-agent-main"),
        hermes_home: get("mirachHome", "MIRACH_HOME", "C:\\Users\\Administrator\\Hermes"),
        browser_home: get("browserHome", "HERMES_BROWSER_HOME", "https://www.bing.com"),
        engine_base: get("engineBase", "HERMES_ENGINE", "http://127.0.0.1:8787"),
        api_base: get("apiBase", "HERMES_API_BASE", "http://127.0.0.1:8090"),
        api_token: get("apiToken", "HERMES_API_TOKEN", ""),
        hermes_bin: get("hermesBin", "HERMES_BIN", ""),
        data_dir: app_config_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn get_config() -> AppConfig {
    load_config()
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
    let out = std::process::Command::new("git")
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

#[tauri::command]
fn check_git_workspace() -> GitStatus {
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
    let output = std::process::Command::new("git")
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
/// 用于 UI 里切换工作区 / 引擎地址等；环境变量优先级更高，会覆盖文件值。
#[tauri::command]
fn set_config(
    workspace: Option<String>,
    hermes_home: Option<String>,
    browser_home: Option<String>,
    engine_base: Option<String>,
    api_base: Option<String>,
    api_token: Option<String>,
    hermes_bin: Option<String>,
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
    if let Some(v) = engine_base {
        obj.insert("engineBase".into(), serde_json::Value::String(v));
    }
    if let Some(v) = api_base {
        obj.insert("apiBase".into(), serde_json::Value::String(v));
    }
    if let Some(v) = api_token {
        obj.insert("apiToken".into(), serde_json::Value::String(v));
    }
    if let Some(v) = hermes_bin {
        obj.insert("hermesBin".into(), serde_json::Value::String(v));
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
    let out = std::process::Command::new("git")
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
    let mut tracked: Vec<&str> = Vec::new();
    for p in &paths {
        // ls-files --error-unmatch：已跟踪返回 Ok，未跟踪返回 Err
        if run_git(&ws, &["ls-files", "--error-unmatch", "--", p]).is_ok() {
            tracked.push(p.as_str());
        } else {
            let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
            if meta.is_dir() {
                std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
            } else {
                std::fs::remove_file(p).map_err(|e| e.to_string())?;
            }
        }
    }
    if !tracked.is_empty() {
        let mut args = vec!["restore", "--"];
        args.extend(tracked.iter().copied());
        run_git(&ws, &args)?;
    }
    Ok(())
}

#[tauri::command]
fn git_commit(message: String) -> Result<(), String> {
    run_git(&load_config().workspace, &["commit", "-m", &message]).map(|_| ())
}

#[tauri::command]
fn git_push() -> Result<(), String> {
    run_git(&load_config().workspace, &["push"]).map(|_| ())
}

/// 创建 PR：先推送当前分支到 origin，再调 gh pr create（依赖 gh CLI）
#[tauri::command]
fn git_create_pr(title: String) -> Result<String, String> {
    let ws = load_config().workspace;
    run_git(&ws, &["push", "-u", "origin", "HEAD"]).map_err(|e| format!("推送分支失败: {e}"))?;
    let out = std::process::Command::new("gh")
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
        let out = std::process::Command::new("git")
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
        let out = std::process::Command::new("git")
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
    let mut child = std::process::Command::new("git")
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
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    wv.eval_with_callback(
        "(() => { const v = window.__hermesPicked; if (v) { delete window.__hermesPicked; return v; } return null; })()",
        move |res| {
            let _ = tx.send(res);
        },
    )
    .map_err(|e| e.to_string())?;
    match rx.recv_timeout(std::time::Duration::from_millis(800)) {
        Ok(s) if !s.is_empty() && s != "null" => {
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
fn read_dir(path: String) -> Result<Vec<FileEntry>, String> {
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
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err("文件超过 2MB，跳过预览".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("无法以文本读取（可能是二进制）: {e}"))
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

/// 在文件管理器中显示该文件/目录（Windows: explorer /select,path）
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .args(["/select,", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ================================================================
// 简约对话引擎（zosma 移植）辅助命令
// ================================================================

/// 用系统默认程序打开 URL / file:// 路径（zosma AttachmentCard 等使用）。
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    // Windows：cmd /c start "" "<url>"。空标题参数 + raw_arg 引号是必须的：
    // 不引号时 cmd 会把 & 当命令分隔符截断 URL；CREATE_NO_WINDOW 防控制台闪窗。
    #[cfg(target_os = "windows")]
    let result = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/c", "start", ""])
            .raw_arg(format!("\"{url}\""))
            .creation_flags(0x0800_0000)
            .status()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();

    let st = result.map_err(|e| format!("open: {e}"))?;
    if !st.success() {
        return Err(format!("exit: {}", st));
    }
    Ok(())
}

/// 写用户文件（zosma 导出等；路径由前端决定）。
#[tauri::command]
async fn write_user_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("write_file: {e}"))
}

/// 返回当前工作区路径（简约对话 UI 显示"在哪工作"）。
#[tauri::command]
fn get_workspace() -> Result<String, String> {
    Ok(load_config().workspace)
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
        .plugin(tauri_plugin_opener::init())
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
        .setup(|app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
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
                }
            }
            Ok(())
        })
        .manage(TerminalState(Mutex::new(HashMap::new())))
        .manage(acp::AcpState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_config,
            set_config,
            reset_config,
            relay::relay_ping,
            relay::relay_submit,
            relay::relay_stream_submit,
            relay::relay_models,
            relay::relay_rpc,
            relay::relay_command,
            relay::relay_auth_status,
            relay::relay_probe,
            relay_cron::relay_cron_ping,
            relay_cron::relay_cron_list,
            relay_cron::relay_cron_create,
            relay_cron::relay_cron_update,
            relay_cron::relay_cron_delete,
            relay_cron::relay_cron_pause,
            relay_cron::relay_cron_resume,
            relay_cron::relay_cron_run,
            acp::acp_status,
            acp::acp_request,
            acp::acp_submit,
            acp::acp_sessions_list,
            acp::acp_steer,
            acp::acp_cancel,
            acp::acp_stop_cmd,
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
            dsh_relay::dsh_list_sessions,
            dsh_relay::dsh_sidecar_ready,
            dsh_relay::toggle_main_maximize,
            open_url,
            write_user_file,
            get_workspace,
            set_analytics_enabled,
            track_analytics_event,
            open_session_window
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // 退出时清理 ACP 子进程 + dsh sidecar 进程树（node/dsh runtime 会残留）
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<acp::AcpState>() {
                    acp::acp_stop(state.inner());
                }
                if app.try_state::<dsh_relay::DshAppState>().is_some() {
                    dsh_relay::shutdown_sidecar(app);
                }
            }
        });
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
