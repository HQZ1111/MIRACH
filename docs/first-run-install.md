# 首次启动依赖安装（in-app bootstrap）

首次打开 Mirach 时，如果本机既没有便携运行时（exe 旁 `runtime/`）、也没有应用内安装过的运行时，
应用会全屏接管，先让用户二选一，然后（本地安装分支）分阶段下载并安装运行环境，全程有进度。

实现**照搬 hermes**（`D:\hermes-agent-main`）的 bootstrap-installer，不另起炉灶：

| hermes | mirach | 说明 |
| --- | --- | --- |
| `apps/bootstrap-installer/src-tauri/src/bootstrap.rs` | `src-tauri/src/bootstrap.rs` | Rust 侧只做编排：跑 PowerShell、逐行透传日志、发 `bootstrap` 事件 |
| `apps/bootstrap-installer/src-tauri/src/powershell.rs` | `src-tauri/src/powershell.rs` | **整份照搬**的 IO 层：代码页回退解码、以进程退出为终态、排水宽限、取消信号、阶段/清单帧解析（含她的单测）|
| `apps/bootstrap-installer/src-tauri/src/events.rs` | `src-tauri/src/events.rs` | **整份照搬**的类型化事件（前端 payload 形状逐字段一致）|
| `scripts/install.ps1`（5064 行：uv/Python/playwright/仓库/桌面构建，7+ 阶段） | `scripts/mirach-install.ps1`（275 行，4 阶段 node/deps/sidecar/marker） | 阶段脚本按 mirach 载荷重写，协议不变 |
| `apps/bootstrap-installer/src/store.ts` | `src/store/bootstrap.ts` | nanostores 状态机（route/stages/logs/progress），同样的 atom/computed/switch 结构 |
| `apps/bootstrap-installer/src/routes/*.tsx`（独立安装器窗口） | `src/components/setup/SetupFlow.tsx` | 同样的四屏流程，并入主应用、用 mirach 设计语言 |

搬运 `powershell.rs` 时只做了这些适配：`tracing::warn!` → `eprintln!`、`which` crate → 手写 PATH 探测、
去掉 hermes 专有的 `hermes_home` 参数（改用自己的"脚本所在目录当 cwd"）、一个 Unix 用例改成 Windows 版。
**不要退回自写的读线程/解析**（理由写在文件头注释里，另有 `runs_the_real_installer_manifest` 真机单测兜底）。

清单协议注意：hermes 的 `Manifest`/`StageInfo` 反序列化**要求 `needs_user_input` 字段存在**，
所以 `mirach-install.ps1` 的 `$Stages` 里每个阶段都要写 `needs_user_input = $false`（缺了首装会卡在"读取清单"）。

## 页面流

```
首次启动，bootstrap_status().ready === false
        │
        ▼
   选择页 choice
   ├── 本地安装（推荐） ──► startInstall() ──► 进度页 progress ──► 成功页 success ──► finishSetup() 进应用
   │                                              └── 失败 ──► 失败页 failure（重试 / 改用远端）
   └── 连接远端引擎 ──► 远端页 remote（host/port/identity/node/sidecar + 测试连接）──► 保存并连接
```

- 进度页：阶段列表（等待 / 运行中带实时计时 / 成功 / 跳过 / 失败）、总进度条、可折叠实时日志（环形 2000 行）、取消按钮。
- 成功页：显示安装目录，点"进入 Mirach"会 `dsh_restart_sidecar` 让引擎按新运行时重启。
- 便携包 / 开发仓库已有 sidecar 时 `ready === true`，安装门不出现（调试构建永远不认"应用内安装"，
  否则开发机装过一次后本地改动就不生效）。

## 阶段协议（与 hermes 同形）

```
powershell -File scripts/mirach-install.ps1 -Manifest -NonInteractive -Json
  → 一行 JSON：{"protocol_version":1,"stages":[{"name","title","category"}...]}

powershell -File ... -Stage <name> -NonInteractive -Json -Root <dir> -SidecarSrc <dir> -SdkVersion <ver>
  → 阶段结束时最后一行 JSON：{"stage","ok","skipped","reason","duration_ms"}
  → 其余 stdout/stderr 逐行透传给前端（bootstrap 事件 type=log）

powershell -File ... -Check -Root <dir>
  → {"ready":bool,"installRoot":str,"missing":["node"|"deps"|"sidecar"]}
```

mirach 自己的四个阶段（顺序即依赖顺序）：

| 阶段 | 做什么 | 跳过条件 |
| --- | --- | --- |
| `node` | 复用 PATH 上合规的 Node ≥22（**必须**是真正的 node 安装目录：有 `node.exe`+`npm.cmd`，且不是盘根），否则从 nodejs.org 下 zip 解压到 `<root>\node` | `<root>\node\node.exe` 已存在且版本 ≥22 |
| `deps` | `npm install --prefix <root>\agent-sidecar @deepseek-ai/dsh-sdk-client@<ver>`（引擎 dsh 及插件随之落到同一 `node_modules`） | 已装同名同版本 SDK |
| `sidecar` | 从应用资源目录（打包态）或仓库（开发态）复制 `dist/`、`config/`、`package.json` | 每次覆盖（很快） |
| `marker` | 写 `<root>\.mirach-bootstrap-complete`（node/engine/sdk 版本 + 时间戳） | 每次重写 |

安装根目录：`%LOCALAPPDATA%\MirachRuntime`（Rust 常量 `bootstrap::install_root()`）。
Node、sidecar 代码、SDK/引擎、npm 产物全部装在这里，卸载 = 删目录。

> 为什么不放 `%LOCALAPPDATA%\mirach\runtime`：安装版的 exe 目录是 `%LOCALAPPDATA%\Mirach`
> （NSIS currentUser 默认路径），运行时根若是它的子目录，`portable_runtime_root()` 会把
> 安装版误判成便携版（安装门不触发 + 自更新提示换整包）。便携包仍然用 exe 旁 `runtime/`。

## 运行时解析（改了什么）

`src-tauri/src/dsh_relay.rs`：

- `portable_runtime_root()`：`MIRACH_RUNTIME_DIR` 或 exe 旁 `runtime/` —— **便携版语义只认这两种**。
- `installed_runtime_root()`：`%LOCALAPPDATA%\MirachRuntime`。
- `runtime_root()` = 便携优先，其次应用内安装；**调试构建跳过应用内安装**（保证开发机跑仓库代码）。
- `sidecar_available()`：三种布局任一生效即视为就绪（安装门据此判断）。
- `spawn_sidecar()` 在应用内安装存在时注入 `MIRACH_DSH_BIN=<root>\agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js`。
- 便携版判定 `is_portable_runtime()` 用 `portable_runtime_root()`：应用内安装**不算**便携版，
  因此自更新走正常安装器（便携版才提示"去发布页下载整包"）。

## 打包

`src-tauri/tauri.conf.json` 的 `bundle.resources` 带上 `../scripts/mirach-install.ps1` 与
`../agent-sidecar/{dist,config,package.json}`，NSIS 安装后落在资源目录（`_up_/...`），
`bootstrap.rs` 的 `script_path()`/`sidecar_src()` 按"资源目录 → 仓库 → 缓存 → 远端下载"解析。

因此**安装包不再需要附带 1.8GB 便携运行时**：单个 `Mirach_<ver>_x64-setup.exe` 装完启动，
首次运行自己把 Node + 引擎 + 桥接装好（约 200–300MB 下载，视网络 2–5 分钟）。

卸载说明：NSIS 卸载只删应用本体（`%LOCALAPPDATA%\Mirach`），**运行时目录会保留**
（`%LOCALAPPDATA%\MirachRuntime`，约 500MB）。这是有意的 —— 应用更新时安装器会先卸载旧版，
若卸载钩子清运行时，每次更新都要重新下载几百 MB。要彻底清理就手动删该目录。

## 应用更新后的运行时刷新

完成标记里记了写入时的应用版本（`appVersion`）。应用升级后首次启动时
`bootstrap_status()` 返回 `stale: true`，前端静默重跑一遍安装阶段：`node`/`deps` 命中跳过条件
直接跳过，`sidecar` 用新版本资源覆盖代码，`marker` 重写版本 —— 然后 `dsh_restart_sidecar`
让新代码生效。整个过程不弹安装门、不打断界面（失败则保持旧运行时可用）。

## 踩过的坑（改脚本前务必看）

1. **PowerShell 5.1 把无 BOM 的 UTF-8 当 ANSI 读**：`Get-Content -Raw | ConvertFrom-Json` 遇到
   中文描述会解析失败（sdk/引擎/侧车 package.json 都可能中招）。统一走 `Read-JsonFile`（显式 UTF-8）。
   同理脚本本身必须是纯 ASCII（中文注释会让无 BOM 的 .ps1 解析失败）。
2. **不要按 `Get-Command node` 的父目录复制东西**：开发机上 `D:\node.exe` 是裸二进制，
   父目录是盘根 —— 会开始复制整个 D 盘（实测 778MB 才被中止）。必须先过
   `Test-NodeInstallDir`（有 node.exe + npm.cmd，且父目录不是 `X:\`）。
3. `https://nodejs.org/dist/latest-v22.x/` 是 HTML 目录页，不能 JSON 解析；用 `dist/index.json`
   取 `version` + `files` 里含 `win-x64-zip` 的那条。
4. PowerShell 5.1 要显式开 TLS1.2（nodejs.org/npm）。
5. `Expand-Archive` 解 node zip 很慢，用 `[System.IO.Compression.ZipFile]::ExtractToDirectory`。
6. npm install 首次要几分钟且几乎不输出：脚本先打印预期耗时，UI 的阶段计时器负责"还活着"的反馈。
7. **管道编码**：PowerShell 把输出重定向到管道时用 `[Console]::OutputEncoding`（默认 = 系统 OEM 码页，
   中文机是 GBK），宿主按 UTF-8 读会解出乱码；脚本开头必须 `[Console]::OutputEncoding = UTF8`。
   宿主侧（`bootstrap.rs`）也必须 **lossy 解码且绝不因解码失败停止读取**——否则一旦某行不是合法
   UTF-8，后面（包括末尾的 JSON 结果帧）全部丢掉，阶段原因退化成"安装器退出码 Some(1)"。
8. **每个阶段都要自己建目录**：下载分支只 `Move-Item` 到 `$NodeDir`，若 `$InstallRoot` 还不存在就是
   `DirectoryNotFoundException`。之前"跑通"只是碰巧有上一次失败的残留目录兜底 —— 干净机器必炸。
   现在 node/sidecar/marker 三个阶段都先 `New-Item -ItemType Directory -Force`。
9. **`\\?\` 扩展长度前缀**：Tauri 的 `resource_dir()` 在 Windows 上返回带 `\\?\` 的路径，直接传给
   PowerShell 5.1 后，`Join-Path`/`Split-Path` 会抛"无法处理参数，因为参数"drive"的值为空"
   （`-SidecarSrc` 一带前缀，sidecar 阶段必挂，而 node/deps 因为只用 `-Root` 而看起来正常）。
   Rust 侧 `strip_extended_prefix()`（`\\?\UNC\x` → `\\x`、`\\?\C:\x` → `C:\x`）+ 脚本侧
   `Normalize-Path` 双向兜底，另有单测。
10. **打包运行时时不能删 `@img` 的非本机平台目录**（`_pack_runtime.ps1` 的裁剪白名单）：
   删掉 `@img/sharp-wasm32`、`@img/sharp-libvips-dev-*` 这类目录后，引擎启动会失败并报
   **`cannot create effect on inactive context`**（插件装配期 sharp 解析平台包失败 → cordis
   上下文失活）。用 318MB 未裁剪运行时对照可 100% 复现，逐类 bisect 定位。
   **可安全裁剪的类别**（已逐项验证引擎仍 `runtime ready`）：`*.map`、`*.pdb`、
   `*.tsbuildinfo`、`*.md`、`test/tests/__tests__/spec/docs/examples` 目录
   → node_modules 222.7MB → 150.8MB，整树 318 → 246MB，7z 包 44.0MB。
   裁剪一律走 `scripts/_prune_apply.mjs`（PowerShell 的 `-Include -Recurse` 在某些路径下
   静默匹配零文件，曾把一次坏裁剪伪装成"已裁剪"）。
