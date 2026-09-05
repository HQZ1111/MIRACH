# AGENTS.md — mirach（原 my-hermes-rs） 工作规则（永远生效）

> 本文件为 ZCode agent 在本项目工作时的**永久规则**，每次会话自动加载，优先于临时上下文。

## ⚠️ 最高优先级：本软件是dsh的桌面客户端，改动只在G:\deepseek-harness-master\apps\mirach文件夹下，不能改动任何dsh官方代码。核心理念是接入官方组件，跟随官方文件升级一起更新软件。官方软件已有的组件和代码直接用，不自己做，不修改。只有官方没有的，mirach自有的组件和功能才自己做。
窗口 / 软件尺寸（用户明确要求，永远遵守）

- **tauri 窗口 = 最底层容器**：无边框（decorations:false）+ **透明**（transparent:true），**悬浮窗口**——窗口默认 1660×980（= 软件面板 1580×900 + 各 40px 透明阴影边距）；**软件面板 = 白色圆角 1580×900（设计默认勿改）居中**，**阴影用面板背后同尺寸同圆角 div + box-shadow（CSDN ::after 法等价，阴影跟 40px 圆角走）**；**Rust setup 里 `win.set_background_color(Some(tauri::webview::Color(0,0,0,0)))` 把 WebView 背景设全透明**（修圆角背后直角/背景，只设配置 backgroundColor 不够）；**DWM DWMWCP_DONOTROUND（=1）关 Win11 ~8px 系统圆角**；**`shadow: false`（OS 阴影在透明窗口下显示成矩形线框）**。**顶栏 85px 在软件面板顶部，拖动窗口用 data-tauri-drag-region（TopBar header），交互按钮簇 data-no-drag 排除**。登录页/过渡页 = 壳内全屏状态（zosma/原型方式）：盖住整个软件面板（含顶栏），不碰阴影，主界面背后渲染，状态翻转+淡入切换。窗口状态持久化在 `windowState.ts`（物理像素 + 离屏校验 + 尺寸钳制到 1660×980）。
- **登录页/过渡页 = 壳内全屏状态（zosma/原型方式）：盖住整个界面（含顶栏），主界面背后渲染，状态翻转+淡入切换**。
- 默认窗口 **1580×900 = 软件本体大小**（tauri.conf.json，用户明确：1580×900 就是软件大小），**永远不要改**；界面铺满窗口（界面尺寸 = 窗口尺寸）。
- 窗口状态持久化在 `windowState.ts`（物理像素 + 离屏校验 + 尺寸钳制）。

## 本项目常用操作要点

- **tauri dev 前必须先清 1420 端口**（vite strictPort 冲突 → 白屏）：`netstat -ano | findstr :1420` 找 PID → `taskkill /PID <pid> /F`；TaskStop 停不掉 vite 子进程。
- **findstr 搜中文匹配不可靠**（ANSI 码页）：用 PowerShell `Select-String` 或 Read 工具。
- **cargo build 报 exe 被占用（os error 5）**：旧进程在跑 → `taskkill /PID <pid> /F`。
- **ACP 边车别用 tokio::process**：std::process + 线程 + mpsc（见 acp.rs，避免 MutexGuard 跨 await 的 Send 问题）。
- **AppConfig 双端同步**：Rust `lib.rs` 与前端 `useAppConfig.ts` 字段必须一致。
- **用户改动的文件可能被用户自行恢复覆盖**：编辑前先 Read 最新状态。

## 架构速览（详见 HANDOVER.md），G:\deepseek-harness-master\apps\mirach\docs里是已调研过的文档。

- UI → Tauri Relay → 引擎四路：hermes-http(8787) / api_server(8090) / sessions.db(FTS5) / `hermes acp start`(stdio)。
- 前端 `HermesClient`（Mock/Real），VITE_MOCK 切换；mock 合成日期/图片/文件供演示。
- 启动门：`StartupGate`（登录页 LoginPage / 连接动画 SplashGate）；provider 引导 `OnboardingOverlay` + `ProviderConnectPanel`（配置存 providerConfig.ts）。
