//! bootstrap — 首次启动的依赖安装（阶段式安装器）
//!
//! 设计照搬 hermes `apps/bootstrap-installer`：Rust 侧只做编排，真正的依赖命令
//! 在 `scripts/mirach-install.ps1` 里，双方共用同一套 stdout 行协议：
//!   -Manifest                            → 一行 JSON：{protocol_version, stages:[{name,title,category}]}
//!   -Stage <name> -NonInteractive -Json  → 阶段末尾一行 JSON：{stage,ok,skipped,reason,duration_ms}
//!   -Check                               → 一行 JSON：{ready,installRoot,missing[]}
//! 驱动逐行透传 stdout/stderr 给前端（`bootstrap` 事件通道），并解析最后一行 JSON 作为阶段结果。

use crate::events::{BootstrapEvent, LogStream, StageState};
use crate::powershell::{self, CancelRx, StreamSink};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

/// 前端 listen 的事件通道名（与 hermes 的 "bootstrap" 同名同形）。
pub const CHANNEL: &str = BootstrapEvent::CHANNEL;
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
    /// 当前阶段进程的取消信号（每次 run_script 重新注册；None = 没有在跑的阶段）
    cancel_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<()>>>>,
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

/// 跑一次脚本调用：逐行透传日志到 `bootstrap` 事件通道，返回完整输出。
/// `stage` 为 None 时表示 manifest/check 这类非阶段调用。
///
/// IO 层用 hermes 的 `crate::powershell`（整份搬）：代码页回退解码 + 以进程退出为
/// 权威终态 + 排水宽限 + 取消信号，避免"非 UTF-8 丢整行"和"孙进程握管道永不 EOF"。
async fn run_script(
    app: &tauri::AppHandle,
    state: &BootstrapState,
    args: &[String],
    stage: Option<&str>,
) -> Result<powershell::ScriptResult, String> {
    let script = strip_extended_prefix(script_path(app)?);
    let mut full_args: Vec<String> = args.to_vec();
    full_args.extend([
        "-Root".to_string(),
        install_root().to_string_lossy().to_string(),
        "-SidecarSrc".to_string(),
        strip_extended_prefix(sidecar_src(app).unwrap_or_default())
            .to_string_lossy()
            .to_string(),
        "-SdkVersion".to_string(),
        SDK_VERSION.to_string(),
        "-AppVersion".to_string(),
        APP_VERSION.to_string(),
        // 随安装包分发的运行时（dsh + Node + 桥接）：首装直接解压，不联网跑 npm
        "-Bundle".to_string(),
        resource_file(app, "mirach-runtime.7z")
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        "-SevenZip".to_string(),
        resource_file(app, "7z.exe")
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    ]);

    let sink_for = |stream: LogStream| {
        let app = app.clone();
        let stage = stage.map(|s| s.to_string());
        move |line: &str| {
            let _ = app.emit(
                CHANNEL,
                BootstrapEvent::Log {
                    stage: stage.clone(),
                    line: line.to_string(),
                    stream,
                },
            );
        }
    };
    let sink = StreamSink {
        on_stdout_line: Box::new(sink_for(LogStream::Stdout)),
        on_stderr_line: Box::new(sink_for(LogStream::Stderr)),
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<()>(1);
    *state.cancel_tx.lock().unwrap() = Some(tx);
    let mut cancel: Option<CancelRx> = Some(rx);
    let result = powershell::run_script(&script, &full_args, sink, &mut cancel).await;
    *state.cancel_tx.lock().unwrap() = None;
    result.map_err(|e| format!("安装器执行失败: {e}"))
}

/// 输出尾部（错误信息里带上，方便定位"没有结果帧"的失败）
fn tail_of(result: &powershell::ScriptResult, n: usize) -> String {
    let mut lines: Vec<&str> = result
        .stdout
        .lines()
        .chain(result.stderr.lines())
        .map(str::trim_end)
        .filter(|l| !l.trim().is_empty())
        .collect();
    let start = lines.len().saturating_sub(n);
    lines.drain(..start);
    lines.join(" | ")
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

/// 资源目录里的一个文件（NSIS 装完在 <安装目录>\resources\，带 ../ 的会落到 _up_\）。
fn resource_file(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?;
    for candidate in [
        dir.join("resources").join(name),
        dir.join(name),
        dir.join("_up_").join("resources").join(name),
    ] {
        if candidate.is_file() {
            return Some(strip_extended_prefix(candidate));
        }
    }
    None
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
    let result = run_bootstrap(&app, &state).await;
    state.running.store(false, Ordering::Release);
    result
}

fn emit(app: &tauri::AppHandle, event: BootstrapEvent) {
    let _ = app.emit(CHANNEL, event);
}

fn emit_failed(app: &tauri::AppHandle, stage: &str, error: &str) {
    emit(
        app,
        BootstrapEvent::Stage {
            name: stage.to_string(),
            state: StageState::Failed,
            duration_ms: None,
            result: None,
            error: Some(error.to_string()),
        },
    );
    emit(
        app,
        BootstrapEvent::Failed {
            stage: Some(stage.to_string()),
            error: error.to_string(),
        },
    );
}

/// 清单 → 逐阶段（每个阶段单独一个 PowerShell 进程）→ 完成事件。
async fn run_bootstrap(app: &tauri::AppHandle, state: &BootstrapState) -> Result<Value, String> {
    let manifest_out = run_script(
        app,
        state,
        &["-Manifest".into(), "-NonInteractive".into(), "-Json".into()],
        None,
    )
    .await?;
    let manifest = powershell::parse_manifest(&manifest_out.stdout).ok_or_else(|| {
        format!(
            "安装清单解析失败（退出码 {:?}）；输出尾部：{}",
            manifest_out.exit_code,
            tail_of(&manifest_out, 5)
        )
    })?;
    emit(
        app,
        BootstrapEvent::Manifest {
            stages: manifest.stages.clone(),
            protocol_version: manifest.protocol_version,
        },
    );

    for stage in &manifest.stages {
        emit(
            app,
            BootstrapEvent::Stage {
                name: stage.name.clone(),
                state: StageState::Running,
                duration_ms: None,
                result: None,
                error: None,
            },
        );
        let started = Instant::now();
        let result = match run_script(
            app,
            state,
            &[
                "-Stage".into(),
                stage.name.clone(),
                "-NonInteractive".into(),
                "-Json".into(),
            ],
            Some(&stage.name),
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                emit_failed(app, &stage.name, &e);
                return Err(e);
            }
        };
        let duration_ms = Some(started.elapsed().as_millis() as u64);
        if result.killed {
            emit_failed(app, &stage.name, "已取消");
            return Err("已取消".to_string());
        }
        match powershell::parse_stage_result(&result.stdout) {
            Some(frame) if frame.ok => {
                let skipped = frame.skipped;
                emit(
                    app,
                    BootstrapEvent::Stage {
                        name: stage.name.clone(),
                        state: if skipped {
                            StageState::Skipped
                        } else {
                            StageState::Succeeded
                        },
                        duration_ms,
                        result: Some(frame),
                        error: None,
                    },
                );
            }
            Some(frame) => {
                let reason = frame
                    .reason
                    .clone()
                    .unwrap_or_else(|| format!("阶段 {} 失败", stage.name));
                emit_failed(app, &stage.name, &reason);
                return Err(format!("阶段 {} 失败：{}", stage.name, reason));
            }
            None => {
                let reason = format!(
                    "阶段 {} 没有结果帧（退出码 {:?}）；输出尾部：{}",
                    stage.name,
                    result.exit_code,
                    tail_of(&result, 5)
                );
                emit_failed(app, &stage.name, &reason);
                return Err(reason);
            }
        }
    }

    let root = install_root();
    let marker = root.join(".mirach-bootstrap-complete");
    emit(
        app,
        BootstrapEvent::Complete {
            install_root: root.to_string_lossy().to_string(),
            marker: serde_json::from_str::<Value>(
                &std::fs::read_to_string(&marker).unwrap_or_else(|_| "null".into()),
            )
            .ok(),
        },
    );
    Ok(json!({ "installRoot": root.to_string_lossy(), "ready": runtime_ready() }))
}

/// 取消安装：给当前阶段进程发取消信号（IO 层会 kill 子进程并立刻返回）。
#[tauri::command]
pub fn bootstrap_cancel(state: tauri::State<'_, BootstrapState>) {
    if let Some(tx) = state.cancel_tx.lock().unwrap().as_mut() {
        let _ = tx.try_send(());
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
