# AGENTS.md — mirach 工作规则（永远生效）

> 本文件为 ZCode agent 在本项目工作时的**永久规则**，每次会话自动加载，优先于临时上下文。

## ⚠️ 最高优先级：本软件是dsh的桌面客户端，改动只在G:\deepseek-harness-master\apps\mirach文件夹下，不能改动任何dsh官方代码。核心理念是接入官方组件，跟随官方文件升级一起更新软件。官方软件已有的组件和代码直接用，不自己做，不修改。只有官方没有的，mirach自有的组件和功能才自己做。
窗口 / 软件尺寸（用户明确要求，永远遵守）

- **tauri 窗口 = 最底层容器**：无边框（decorations:false）+ **透明**（transparent:true），**悬浮窗口**——窗口默认 1660×980（= 软件面板 1580×900 + 各 40px 透明阴影边距）；**软件面板 = 白色圆角 1580×900（设计默认勿改）居中**，**阴影用面板背后同尺寸同圆角 div + box-shadow（CSDN ::after 法等价，阴影跟 40px 圆角走）**；**Rust setup 里 `win.set_background_color(Some(tauri::webview::Color(0,0,0,0)))` 把 WebView 背景设全透明**（修圆角背后直角/背景，只设配置 backgroundColor 不够）；**DWM DWMWCP_DONOTROUND（=1）关 Win11 ~8px 系统圆角**；**`shadow: false`（OS 阴影在透明窗口下显示成矩形线框）**。**顶栏 85px 在软件面板顶部，拖动窗口用 data-tauri-drag-region（TopBar header），交互按钮簇 data-no-drag 排除**。登录页/过渡页 = 壳内全屏状态（zosma/原型方式）：盖住整个软件面板（含顶栏），不碰阴影，主界面背后渲染，状态翻转+淡入切换。窗口状态持久化在 `windowState.ts`（物理像素 + 离屏校验 + 尺寸钳制到 1660×980）。
- **登录页/过渡页 = 壳内全屏状态（zosma/原型方式）：盖住整个界面（含顶栏），主界面背后渲染，状态翻转+淡入切换**。
- 默认窗口 **1580×900 = 软件本体大小**（tauri.conf.json，用户明确：1580×900 就是软件大小），**永远不要改**；界面铺满窗口（界面尺寸 = 窗口尺寸）。
- 窗口状态持久化在 `windowState.ts`（物理像素 + 离屏校验 + 尺寸钳制）。

## 本项目常用操作要点

- **分发形态 = NSIS 安装包（首选）+ 便携包（离线/免安装）**：
  - **安装包**：`pnpm tauri build`（`bundle.targets=["nsis"]`）。安装包**只含外壳**（exe + 前端 + `resources` 里的 `scripts/mirach-install.ps1`、`agent-sidecar/{dist,config,package.json}`），首次启动由**应用内安装器**把 Node + 引擎 + 桥接装到 `%LOCALAPPDATA%\MirachRuntime`（照搬 hermes bootstrap-installer：选择页 → 分阶段进度页 → 成功页，见 `docs/first-run-install.md`）。
  - **便携包**：`scripts/build_portable.ps1`（exe + 便携 Node + 引擎 + 依赖，解压即用，不写 %LOCALAPPDATA%）。便携版自更新要去发布页换整包，应用内安装版走正常更新器。
  - 发布态 sidecar 入口是 `dist/index.js`（不再依赖 devDependency tsx）；开发态回退 `src/index.ts` + tsx，可用 `MIRACH_SIDECAR_ENTRY` 强制指定。
- **远程引擎（SSH）**：设置 → 通用 → 远程引擎；实现 = `spawn_sidecar` 在 `remoteEnabled` 时改跑 `ssh -T <host> <node> <remoteSidecar>`（JSONL 走 ssh stdin/stdout，引擎 web 面在远端 sidecar 内完成，无需隧道）。改配置后用"重启引擎连接"（`dsh_restart_sidecar`）生效。远端准备与排错见 `docs/remote-engine.md`。
- **语言定位 = 简体中文单语**：i18n 机制保留（`lib/i18n.tsx`，设置/命令面板/消息中心等 6 个面板使用 `t()`），其余界面直接写中文——不再要求全量迁移，也不要新增英文-only 文案。
- **测试工装（`scripts/` 下划线前缀，非产品代码）**：
  - `_test_remote_engine.ps1` + `_fake-ssh.cs`：远程引擎（SSH）集成测试——假 ssh 替身接管远程分支，真实走通 配置→ssh 参数→子进程→JSONL→远端 sidecar→引擎 ready（临时改写并恢复 config.json）。
  - `_prep_fresh_install_test.ps1` / `_cleanup_install_test.ps1`：首装门真机验证——卸载旧版 + 清运行时 + 隐藏仓库 `agent-sidecar\dist`（逼出安装门）→ 静默装新版；收尾恢复 dist、卸载测试安装、保留 `MirachRuntime`。
  - `_run_bootstrap_stages.ps1`：直接按 Rust 驱动的方式跑四个安装阶段（不开 UI，看 JSON 帧）。
  - `_grab_window.ps1` / `_send_keys.ps1`：窗口截图（绕开截图缓存）与按键驱动（无 CDP 时点 UI）。
  - `_cdp_invoke.mjs`：CDP 触发任意 Tauri 命令并打印结果（需 `npm run tauri:debug`；用于无 UI 的端到端验证）；`_cdp_eval.mjs` 是通用版（text/click/eval）。
  - `_serve_update.mjs`：本地静态服务器（自更新检查路径测试用；正式发布必须 HTTPS，`tauri.conf.json` 不得打开 `dangerousInsecureTransportProtocol`）。
- **config.json 必须无 BOM**：`load_config` 会剥 BOM（PowerShell `Set-Content -Encoding UTF8` 会写 BOM，曾导致所有设置静默失效）；用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` 或 Rust 侧 `set_config` 写。
- **`scripts/mirach-install.ps1` 是产品代码**（首次启动安装器载荷）：**必须纯 ASCII**（PS 5.1 按 ANSI 读无 BOM 文件，中文注释即解析失败）；读 JSON 一律用 `Read-JsonFile`（显式 UTF-8，`Get-Content -Raw | ConvertFrom-Json` 遇到非 ASCII 会炸）；**禁止按 `Get-Command node` 的父目录递归复制**（开发机 `D:\node.exe` 的父目录是盘根 → 会复制整个 D 盘，必须先过 `Test-NodeInstallDir`）；Node 版本走 `dist/index.json`（`latest-vNN.x/` 是 HTML）。踩坑清单见 `docs/first-run-install.md` 末节。
- **打包运行时的裁剪白名单是硬约束**（`scripts/_pack_runtime.ps1` + `_prune_apply.mjs`）：只能删
  `*.map` / `*.pdb` / `*.tsbuildinfo` / `*.md` / `test|tests|__tests__|spec|docs|examples` 目录。
  **绝不能删 `@img` 下非 win32-x64 的平台目录**（`sharp-wasm32`、`sharp-libvips-dev-*`）：引擎启动会
  报 `cannot create effect on inactive context`（插件装配期 sharp 解析平台包失败 → cordis 上下文失活），
  实测 100% 复现、逐类 bisect 定位。裁剪完必须跑 `scripts/_verify_archive.ps1`（解压归档 + 起引擎
  看 `runtime ready`），不能只看"包变小了"。
- **PowerShell 的 `Get-ChildItem -Include` 在某些路径下静默匹配 0 个文件**（`-Recurse` 也一样）：
  删文件的脚本一律用 node（`_prune_apply.mjs` 是范本），别用 PS 过滤；写完必须打印删了多少 MB 自证。
- **安装器 IO 层是 hermes 的代码，别"简化"**：`src-tauri/src/powershell.rs` + `src-tauri/src/events.rs` 整份照搬 `D:\hermes-agent-main\apps\bootstrap-installer\src-tauri\src\{powershell,events}.rs`（只改了：`tracing` → `eprintln!`、`which` → PATH 探测、去掉 hermes_home 参数）。**不要退回 `BufReader::lines()`**（严格 UTF-8，中文 Windows 上 GBK 错误文本会让整行/后续行连同结果 JSON 帧一起丢）、**不要以管道 EOF 作为终态**（孙进程握着写端时永不 EOF → 调用方被吊死；以进程退出为准 + `DRAIN_GRACE` 排水宽限）。这两点都有 hermes 自带的单测兜底（28 个 Rust 测试中包含它们）。
- **质量门（每次改完先跑）**：`npm run typecheck`（tsc）+ `npm run lint`（oxlint，配置在 `.oxlintrc.json`，只查 src）+ `npm test`（vitest，`src/**/*.test.ts`）；sidecar：`cd agent-sidecar && npm run typecheck && npm test`；Rust：`cd src-tauri && cargo check && cargo test --lib`。**当前全绿：lint 0 warning / 0 error，前端 9 测试，sidecar 15 测试，Rust 14 测试**——不要新增断言/依赖抑制让它们变红。
- **内核装配 = 官方 client 模块系统**：`dsh-kernel/module-loader-shim.ts` 安装官方 queue 门面（对齐 `packages/client/modules/src/index.ts` 的内联脚本），`boot.ts` 经 `moduleSystem.import(id)` 实例化 bundle；**新增官方 client 包 = 在 KERNEL_PLUGINS 加一行**（bundle 仍需静态 import 以便 Vite 打包）。解析语义（strip /client、重复注册、require 环）归官方，不要自实现。
- **引擎装配 = 官方 profile API**：bundles 读写走 `@deepseek-ai/dsh-app-boot` 的 `readProfileManifest`/`writeProfileManifest`，装配清单走 `loadProfileDirectory`+`composeEntries`；mirach 自有 overlay 在 `agent-sidecar/config/mirach.cordis.patch.yml`（经 SDK `patches` 注入）。
- **Harness home 统一走 `mirachHome()`**（sidecar `runtime.ts`，官方 `resolveDshHome` 语义），不要再写 `process.env.DSH_HOME ?? ~/.mirach`。
- **调试端口默认关闭**：release 的 `tauri.conf.json` 不含 `--remote-debugging-port`（曾有 P0：任意本地进程可接管 webview 调用全部 IPC）。需要 CDP 时用 `npm run tauri:debug`（合并 `src-tauri/tauri.dev.conf.json`）。
- **CSP 已启用**（`tauri.conf.json` security.csp / devCsp）：新增外部资源（字体/图片/iframe/接口域名）必须在 CSP 里放行，否则线上被静默拦截。
- **文件命令有白名单**（lib.rs `ensure_path_allowed`）：`read_file/read_dir/rename_path/delete_path/write_user_file/read_file_bytes/reveal_path` 只能访问 工作区 / hermes_home / 数据目录 / 用户主目录下的 .mirach、.dsh、Desktop、Downloads、Documents；新增越权路径会被拒绝（这是有意的）。
- **`dsh_rpc` 有方法白名单**（dsh_relay.rs `rpc_method_allowed` + sidecar `RPC_PASSTHROUGH`）：新增引擎 RPC 方法必须两处同步登记，否则被拒。
- **sidecar 命令循环是并发分发**：长命令（npm 安装/更新）不再阻塞 abort/clear_queue；在飞消息由 `activeCmdId` 保护，abort 不会重复终结它。
- **单实例锁 + 自更新**：`tauri-plugin-single-instance`（第二次启动聚焦主窗）；`tauri-plugin-updater` 端点 = 配置 `updateEndpoint`，签名私钥在 `src-tauri/.tauri-keys/`（已 gitignore，**不要入库**）。
- **tauri dev 前必须先清 1420 端口**（vite strictPort 冲突 → 白屏）：`netstat -ano | findstr :1420` 找 PID → `taskkill /PID <pid> /F`；TaskStop 停不掉 vite 子进程。
- **findstr 搜中文匹配不可靠**（ANSI 码页）：用 PowerShell `Select-String` 或 Read 工具。
- **cargo build 报 exe 被占用（os error 5）**：旧进程在跑 → `taskkill /PID <pid> /F`。
- **引擎边车进程别用 tokio::process**：std::process + 线程 + mpsc（见 dsh_relay.rs，避免 MutexGuard 跨 await 的 Send 问题）；sidecar 加入 Windows Job Object（KILL_ON_JOB_CLOSE），强杀应用也不残留 node/dsh。
- **AppConfig 双端同步**：Rust `lib.rs` 与前端 `useAppConfig.ts` 字段必须一致。
- **用户改动的文件可能被用户自行恢复覆盖**：编辑前先 Read 最新状态；若 Edit 报 Permission denied，先 `attrib -R <file>`（仓库里存在只读文件）。

## 架构速览（详见 HANDOVER.md），G:\deepseek-harness-master\apps\mirach\docs里是已调研过的文档。

- UI → Tauri（dsh_relay.rs）→ agent-sidecar（Node，stdio JSONL）→ npm 全局 dsh 引擎（`dsh --profile mirach`，sidecar 注入 `DSH_HOME=~/.mirach`）。单核心，无第二引擎通道。
- `relay.rs` 仅剩 `relay_probe`（供应商端点探测，与引擎无关）；会话检索走 sessions.rs（FTS5）；定时任务走 dsh schedule 插件（send_prompt 语义）。
- 前端 `src/lib/api/client.ts`（MirachClient：Mock/Real），VITE_MOCK 演示开关；mock 合成日期/图片/文件供演示。
- 启动门：`StartupGate`（登录页 LoginPage / 连接动画 SplashGate）；provider 引导 `OnboardingOverlay` + `ProviderConnectPanel`（配置存 providerConfig.ts）。
