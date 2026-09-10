# WebView2 on Windows — 运行期建窗的硬约束（2026-09 实测）

> 2026-09-10 定位：**内置浏览器 / HUD 悬浮窗 / 会话小窗"打不开"**（窗口在 Tauri 注册表里、
> 没有系统句柄、页面永远不加载）——根因不是窗口标志、不是透明、不是 URL、不是
> `set_ignore_cursor_events`，是 **WebView2 环境（ICoreWebView2Environment）的选项必须全进程一致**。

## 症状（可复现）

- 只有**第一个** webview（`main`，config 建的）活着；之后任何 `WebviewWindowBuilder` /
  `add_child` 建的 webview 全灭：内置浏览器空白、HUD 打不开、`open_session_window` 白窗。
- 前端/命令侧看到的错误是**间接的**：
  - `get_webview_window("hud")` 返回 `Some`（Tauri 自己的注册表里有）
  - `win.hwnd()` → `Err(RawHandleError(Unavailable))`
  - `win.inner_size()` → `Err(Runtime(FailedToReceiveMessage))`
- 根因那条错误被吞掉了：`tauri-runtime-wry` 处理 `Message::CreateWindow` 时
  `Err(e) => log::error!("{e}")`（`tauri-runtime-wry-2.11.4/src/lib.rs:4077-4084`），
  **窗口不会插入运行时 windows 表**；接上 logger 才能看到：

```
[log ERROR] tauri_runtime_wry: failed to create webview:
  WebView2 error: WindowsError(Error { code: HRESULT(0x8007139F),
  message: "组或资源的状态不是执行请求操作的正确状态" })
```

`0x8007139F` = `ERROR_INVALID_STATE`。

## 根因链

1. WebView2 环境在**同一用户数据目录**下是**进程级单例**，且只认**第一次**建环境时的
   `ICoreWebView2EnvironmentOptions`（`AdditionalBrowserArguments`、语言、滚动条样式…）。
2. `wry` 每次建 webview 都调 `CreateCoreWebView2EnvironmentWithOptions`
   （`wry-0.55.1/src/webview2/mod.rs:283 create_environment`）；选项一致时 WebView2 返回同一个
   环境，**不一致时直接 0x8007139F**。
3. 参数从哪来：config 窗口走 `WebviewAttributes::from(&WindowConfig)`
   （`tauri-runtime-2.11.3/src/webview.rs:483`），**只有 config 里写了 `additionalBrowserArgs`
   才用那串**；运行期 `WebviewWindowBuilder` 不写就是 wry 默认
   （`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`）。
   dev 配置（`src-tauri/tauri.dev.conf.json`）给 `main` 加了 `--remote-debugging-port=9222`
   → 主窗与运行期窗口**选项不一致** → 从第二个 webview 起全灭。
4. Tauri 的 `WebviewWindowBuilder::build()`（走 `AppHandle` → `RuntimeHandle` →
   `Context::create_window`）是**发完即返回**（`tauri-runtime-wry-2.11.4/src/lib.rs:300-363`，
   注释原文："must be called from a separate thread, otherwise the channel will introduce a
   deadlock"），所以 `build()` 返回 `Ok` **完全不等于**窗口建成。

## 修复（`src-tauri/src/lib.rs`）

- `main_browser_args(app)`：从 config 里取 `main` 的 `additionalBrowserArgs`。
- `inherit_browser_args(app, builder)` / `inherit_browser_args_wv(app, builder)`：
  运行期建的 **WebviewWindow** / **child webview** 一律继承它。
  已在用：`hud_open`、`open_session_window`、`open_quick_entry_window`、`browser_open`、
  `overlay_show`。**新增运行期窗口必须走这两个函数**。
- 打包态两边都是 `None`（wry 默认）天然一致；继承是为了 dev 与打包行为一致、
  以及用户自定义参数时不让运行期窗口静默死掉。
- `install_diag_logger()`：把 `log` 门面的 warn/error 接到 stderr（被吞掉的这一类错误以后能看见）。
- HUD 额外加固：`hud_window()` 用 **hwnd 验真**、`pick_hud_label()` 在注册表出现幻影条目时
  换 `hud-2/hud-3…`（否则"注册表里有条目"会让 `hud_open` 误判已打开而永久打不开）。

## 验证配方（不依赖 UI 点击）

```cmd
rem 1) A/B 自检：plain 继承参数应成功；plainnoargs 故意不继承应复现 0x8007139F
set MIRACH_HUD_SELFTEST=1 && call scripts\_dev_with_runtime_engine.cmd
rem 日志看 [hud-selftest] kind=… hwnd=… 与 [log ERROR] failed to create webview
```

- `scripts/_verify_webviews.mjs`：主窗页面里真调 `browser_open` / `browser_navigate` /
  `overlay_show` / `hud_open`，并核 CDP target 列表里出现 `https://example.org/`
  （child webview 真的加载了页面）。
- `scripts/_hud_inspect.mjs` / `_hud_console.mjs` / `_hud_poll.mjs`：只看 HUD 那个 target 的
  DOM/样式/异常（dev 冷缓存下 HUD 的模块图很慢，`_hud_poll.mjs` 用来确认它在动）。
- OS 级证据：`GetWindowRect/IsWindowVisible` 扫 `mirach.exe` 的顶层窗（应有
  `title="Mirach HUD" vis=True ex=…TOPMOST`）。

## 推论 / 注意

- 这类失败的**唯一可信判据是 `hwnd()`**；`build()` 的 `Ok`、Tauri 注册表里的存在都不算。
- 任何"窗口建了但没反应"的报障，先开 `install_diag_logger` 看有没有 `failed to create webview`。
- dev 下 HUD/第二窗口首屏慢是 vite 冷缓存（整棵模块图），不是这个 bug。
