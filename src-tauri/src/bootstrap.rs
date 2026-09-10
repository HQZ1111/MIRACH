//! bootstrap — 首次启动的依赖安装（阶段式安装器）
//!
//! 设计照搬 hermes `apps/bootstrap-installer`：Rust 侧只做编排，真正的依赖命令
//! 在 `scripts/mirach-install.ps1` 里，双方共用同一套 stdout 行协议：
//!   -Manifest                            → 一行 JSON：{protocol_version, stages:[{name,title,category}]}
//!   -Stage <name> -NonInteractive -Json  → 阶段末尾一行 JSON：{stage,ok,skipped,reason,duration_ms}
//!   -Check                               → 一行 JSON：{ready,installRoot,missing[]}
//! 驱动逐行透传 stdout/stderr 给前端（`bootstrap` 事件通道），并解析最后一行 JSON 作为阶段结果。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// 前端 listen 的事件通道名（与 hermes 的 "bootstrap" 同名同形）。
pub const CHANNEL: &str = "bootstrap";
const SCRIPT_NAME: &str = "mirach-install.ps1";
/// 随应用安装的引擎 SDK 版本（= 引擎版本；profile 迁移由引擎自理）。
const SDK_VERSION: &str = "0.1.5-alpha.1";
/// 应用版本：写进完成标记，用于判断"应用升级后运行时是否需要重装一遍"（各阶段自带跳过）。
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// 安装脚本远端回退（本地副本缺失时下载并缓存）。
const SCRIPT_URL: &str = "https://gitee.com/HANQINGZHOU/mirach/raw/master/scripts/mirach-install.ps1";

#[derive(Default)]
pub struct BootstrapState {
    running: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

/// 应用内安装的运行时根（便携包用 exe 旁 runtime\，安装版用这里）。
///
/// 注意**不要**放在 `%LOCALAPPDATA%\mirach` 下面：安装版的 exe 目录是
/// `%LOCALAPPDATA%\Mirach`（NSIS currentUser 默认），若运行时根是它的子目录
/// `Mirach\runtime`，`portable_runtime_root()` 会把安装版误判成便携版
/// （自更新提示换整包、安装门不触发）。所以另起一个平级目录。
pub fn install_root() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("MirachRuntime")
}

fn marker_path() -> PathBuf {
    install_root().join(".mirach-bootstrap-complete")
}

/// 引擎入口（SDK 依赖里带下来的 dsh 包）。
pub fn installed_engine_bin() -> PathBuf {
    install_root()
        .join("agent-sidecar")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js")
}

/// 运行时是否已就绪（node + sidecar 代码 + SDK/引擎）。
pub fn runtime_ready() -> bool {
    let root = install_root();
    root.join("node").join("node.exe").is_file()
        && root.join("agent-sidecar").join("dist").join("index.js").is_file()
        && installed_engine_bin().is_file()
}

fn powershell_exe() -> PathBuf {
    let windir = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    PathBuf::from(windir)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

/// 安装脚本位置：应用资源目录 → 仓库 scripts\ → 缓存 → 远端下载并缓存。
fn script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1) 应用资源目录（打包态随应用分发；Tauri 会把 ../scripts 放进 _up_\scripts）
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [
            dir.join("scripts").join(SCRIPT_NAME),
            dir.join("_up_").join("scripts").join(SCRIPT_NAME),
            dir.join(SCRIPT_NAME),
        ] {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    // 2) 仓库布局（开发态）
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("scripts").join(SCRIPT_NAME));
    if let Some(p) = repo {
        if p.is_file() {
            return Ok(p);
        }
    }
    // 3) 缓存 → 远端（跟随 302 到 giteeusercontent）
    let cache = install_root().join("bootstrap-cache").join(SCRIPT_NAME);
    if cache.is_file() {
        return Ok(cache);
    }
    let resp = ureq::get(SCRIPT_URL)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| format!("安装脚本下载失败: {e}"))?;
    let mut text = String::new();
    use std::io::Read;
    resp.into_reader()
        .take(2 * 1024 * 1024)
        .read_to_string(&mut text)
        .map_err(|e| format!("安装脚本读取失败: {e}"))?;
    if !text.contains("mirach-install") {
        return Err("安装脚本内容异常（未命中预期标记）".into());
    }
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&cache, text.as_bytes()).map_err(|e| format!("安装脚本缓存失败: {e}"))?;
    Ok(cache)
}

/// 跑一次脚本调用：逐行透传日志给前端，返回全部输出行。
/// `stage` 为 None 时表示 manifest/check 这类非阶段调用。
fn run_script(
    app: &tauri::AppHandle,
    state: &BootstrapState,
    args: &[&str],
    stage: Option<&str>,
) -> Result<Vec<String>, String> {
    let script = strip_extended_prefix(script_path(app)?);
    let mut cmd = Command::new(powershell_exe());
    cmd.arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script)
        .args(args)
        .arg("-Root")
        .arg(install_root().to_string_lossy().to_string())
        .arg("-SidecarSrc")
        .arg(
            strip_extended_prefix(sidecar_src(app).unwrap_or_default())
                .to_string_lossy()
                .to_string(),
        )
        .arg("-SdkVersion")
        .arg(SDK_VERSION)
        .arg("-AppVersion")
        .arg(APP_VERSION)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("无法启动安装器: {e}"))?;
    let stdout = child.stdout.take().ok_or("no installer stdout")?;
    let stderr = child.stderr.take().ok_or("no installer stderr")?;
    *state.child.lock().unwrap() = Some(child);

    let collect = |reader: Box<dyn BufRead + Send>, stream: &'static str| {
        let app = app.clone();
        let stage = stage.map(|s| s.to_string());
        std::thread::spawn(move || {
            let mut lines = Vec::new();
            let mut reader = reader;
            let mut buf: Vec<u8> = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    // 逐字节读 + lossy 解码：安装器输出里混有系统 OEM 码页的错误文本
                    // （中文 Windows 上是 GBK），严格 UTF-8 解码会失败——一旦失败就
                    // 停止读取会丢掉末尾的 JSON 结果帧（阶段原因变"退出码 Some(1)"）。
                    Ok(_) => {
                        let raw = String::from_utf8_lossy(&buf);
                        let trimmed = raw.trim_end_matches(['\r', '\n']).trim_end();
                        if trimmed.is_empty() {
                            continue;
                        }
                        let _ = app.emit(
                            CHANNEL,
                            json!({ "type": "log", "stage": stage, "line": trimmed, "stream": stream }),
                        );
                        lines.push(trimmed.to_string());
                    }
                    Err(e) => {
                        let _ = app.emit(
                            CHANNEL,
                            json!({ "type": "log", "stage": stage, "line": format!("[reader] {e}"), "stream": stream }),
                        );
                        break;
                    }
                }
            }
            lines
        })
    };
    let out_handle = collect(Box::new(BufReader::new(stdout)), "stdout");
    let err_handle = collect(Box::new(BufReader::new(stderr)), "stderr");

    let status = {
        let mut guard = state.child.lock().unwrap();
        let child = guard.as_mut().ok_or("安装进程句柄丢失")?;
        child.wait().map_err(|e| format!("等待安装器失败: {e}"))?
    };
    *state.child.lock().unwrap() = None;
    let mut lines = out_handle.join().unwrap_or_default();
    lines.extend(err_handle.join().unwrap_or_default());
    if state.cancel.load(Ordering::Acquire) {
        return Err("已取消".into());
    }
    if !status.success() {
        // 阶段脚本失败时最后一行 JSON 里带 reason，交给调用方解析
        if let Some(frame) = last_json(&lines) {
            if frame.get("ok").and_then(Value::as_bool) == Some(false) {
                return Ok(lines);
            }
        }
        // 没有结果帧（脚本没跑起来/死在解析期）：把输出尾部带上，否则前端只能看到"退出码"
        let tail: Vec<&str> = lines.iter().rev().take(5).rev().map(|s| s.as_str()).collect();
        return Err(format!(
            "安装器退出码 {:?}；输出尾部：{}",
            status.code(),
            tail.join(" | ")
        ));
    }
    Ok(lines)
}

/// Windows 扩展长度前缀（`\\?\`）会让 PowerShell 5.1 的 `Join-Path`/`Split-Path`
/// 报"参数 drive 的值为空"（Tauri 的 `resource_dir()` 在 Windows 上就是带前缀的）。
/// 交给 PowerShell 之前一律剥掉：`\\?\UNC\srv\share` → `\\srv\share`，`\\?\C:\x` → `C:\x`。
fn strip_extended_prefix(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    p
}

fn last_json(lines: &[String]) -> Option<Value> {
    lines.iter().rev().find_map(|l| serde_json::from_str::<Value>(l).ok())
}

/// 应用自带的 agent-sidecar 目录（dist + config + package.json）。
fn sidecar_src(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [dir.join("agent-sidecar"), dir.join("_up_").join("agent-sidecar")] {
            if candidate.join("dist").join("index.js").is_file() {
                return Some(candidate);
            }
        }
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent()?.join("agent-sidecar");
    if repo.join("dist").join("index.js").is_file() {
        return Some(repo);
    }
    None
}

// ── Tauri 命令 ─────────────────────────────────────────────────────────────

/// 安装状态（启动门用）：是否就绪、根目录、缺什么、是否在装、标记内容。
/// 便携包 / 开发仓库已有运行时 → 直接视为就绪（不弹首次安装）。
/// `stale` = 标记里的应用版本与当前版本不一致（应用升级过 → 需要重跑一遍
/// 轻量阶段把 sidecar 代码刷新到新版；node/deps 阶段自会跳过）。
#[tauri::command]
pub fn bootstrap_status() -> Value {
    let root = install_root();
    let marker = std::fs::read_to_string(marker_path())
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let installed_app = marker
        .as_ref()
        .and_then(|m| m.get("appVersion"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let stale = !installed_app.is_empty() && installed_app != APP_VERSION;
    if crate::dsh_relay::sidecar_available() {
        return json!({
            "ready": true,
            "installRoot": root.to_string_lossy(),
            "missing": [],
            "marker": marker,
            "appVersion": APP_VERSION,
            "stale": stale,
        });
    }
    let mut missing: Vec<&str> = Vec::new();
    if !root.join("node").join("node.exe").is_file() {
        missing.push("node");
    }
    if !root
        .join("agent-sidecar")
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-sdk-client")
        .join("package.json")
        .is_file()
    {
        missing.push("deps");
    }
    if !root.join("agent-sidecar").join("dist").join("index.js").is_file() {
        missing.push("sidecar");
    }
    json!({
        "ready": missing.is_empty(),
        "installRoot": root.to_string_lossy(),
        "missing": missing,
        "marker": marker,
        "appVersion": APP_VERSION,
        "stale": stale,
    })
}

/// 启动安装：拉清单 → 逐阶段执行（日志/进度经 `bootstrap` 事件推送）→ 完成。
#[tauri::command]
pub async fn bootstrap_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, BootstrapState>,
) -> Result<Value, String> {
    if state.running.swap(true, Ordering::AcqRel) {
        return Err("安装已在进行中".into());
    }
    state.cancel.store(false, Ordering::Release);
    let running = state.running.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BootstrapState>();
        let manifest_lines = run_script(
            &app,
            &state,
            &["-Manifest", "-NonInteractive", "-Json"],
            None,
        )?;
        let manifest = last_json(&manifest_lines).ok_or("安装清单解析失败")?;
        let stages = manifest
            .get("stages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let _ = app.emit(
            CHANNEL,
            json!({
                "type": "manifest",
                "stages": stages,
                "protocolVersion": manifest.get("protocol_version").cloned().unwrap_or(json!(1)),
            }),
        );
        for stage in &stages {
            let name = stage.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            if state.cancel.load(Ordering::Acquire) {
                let _ = app.emit(CHANNEL, json!({ "type": "failed", "stage": name, "error": "已取消" }));
                return Err("已取消".to_string());
            }
            let _ = app.emit(CHANNEL, json!({ "type": "stage", "name": name, "state": "running" }));
            let lines = match run_script(
                &app,
                &state,
                &["-Stage", &name, "-NonInteractive", "-Json"],
                Some(&name),
            ) {
                Ok(l) => l,
                Err(e) => {
                    let _ = app.emit(CHANNEL, json!({ "type": "stage", "name": name, "state": "failed", "error": e }));
                    let _ = app.emit(CHANNEL, json!({ "type": "failed", "stage": name, "error": e }));
                    return Err(e);
                }
            };
            let frame = last_json(&lines).unwrap_or(json!({ "ok": false, "reason": "no stage result" }));
            let ok = frame.get("ok").and_then(Value::as_bool).unwrap_or(false);
            let skipped = frame.get("skipped").and_then(Value::as_bool).unwrap_or(false);
            let reason = frame.get("reason").and_then(Value::as_str).unwrap_or("").to_string();
            let duration = frame.get("duration_ms").cloned().unwrap_or(json!(0));
            if !ok {
                let _ = app.emit(CHANNEL, json!({
                    "type": "stage", "name": name, "state": "failed", "error": reason,
                }));
                let _ = app.emit(CHANNEL, json!({ "type": "failed", "stage": name, "error": reason }));
                return Err(format!("阶段 {name} 失败：{reason}"));
            }
            let _ = app.emit(CHANNEL, json!({
                "type": "stage",
                "name": name,
                "state": if skipped { "skipped" } else { "succeeded" },
                "durationMs": duration,
                "result": { "stage": name, "ok": true, "skipped": skipped, "reason": reason },
            }));
        }
        let root = install_root();
        let marker = root.join(".mirach-bootstrap-complete");
        let _ = app.emit(CHANNEL, json!({
            "type": "complete",
            "installRoot": root.to_string_lossy(),
            "marker": marker.to_string_lossy(),
        }));
        Ok(serde_json::json!({ "installRoot": root.to_string_lossy(), "ready": runtime_ready() }))
    })
    .await
    .map_err(|e| format!("安装任务失败: {e}"))?;
    running.store(false, Ordering::Release);
    result
}

/// 取消安装：结束当前阶段进程，循环会在下一次检查时退出。
#[tauri::command]
pub fn bootstrap_cancel(state: tauri::State<'_, BootstrapState>) {
    state.cancel.store(true, Ordering::Release);
    if let Some(child) = state.child.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
}

/// 重试前清掉完成标记（失败后重新安装用）。
#[tauri::command]
pub fn bootstrap_reset() -> Result<(), String> {
    let marker = marker_path();
    if marker.exists() {
        std::fs::remove_file(&marker).map_err(|e| e.to_string())?;
    }
    let pending = install_root().join("bootstrap-cache");
    let _ = std::fs::remove_dir_all(pending);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_windows_extended_prefix() {
        // Tauri 的 resource_dir() 在 Windows 上带 \\?\ 前缀，PowerShell 5.1 的
        // Join-Path 会因此报 "参数 drive 的值为空"（真机上踩过）
        assert_eq!(
            strip_extended_prefix(PathBuf::from(r"\\?\C:\Users\x\Mirach\_up_\agent-sidecar")),
            PathBuf::from(r"C:\Users\x\Mirach\_up_\agent-sidecar")
        );
        assert_eq!(
            strip_extended_prefix(PathBuf::from(r"\\?\UNC\srv\share\app")),
            PathBuf::from(r"\\srv\share\app")
        );
        // 普通路径原样返回
        assert_eq!(
            strip_extended_prefix(PathBuf::from(r"C:\x\y")),
            PathBuf::from(r"C:\x\y")
        );
    }

    #[test]
    fn install_root_is_outside_the_app_dir() {
        // 运行时根不能是安装目录的子目录，否则便携版判定会把安装版认成便携版
        let root = install_root();
        assert!(root.ends_with("MirachRuntime"), "{root:?}");
        assert!(!root.to_string_lossy().contains(r"\Mirach\runtime"), "{root:?}");
    }
}
