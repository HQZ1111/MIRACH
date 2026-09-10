# Mirach 0.1.2

**首次启动自己装依赖**：安装包不再是"空壳"，单个 `Mirach_0.1.2_x64-setup.exe` 就能在新机器上用起来。

## 新增

- **应用内依赖安装**（实现照搬 hermes bootstrap-installer）
  - 首次启动弹出选择页：**本地安装**（推荐）或**连接远端引擎**（SSH）。
  - 本地安装 = 分阶段下载/安装，页面显示阶段列表（等待/运行中带计时/成功/跳过/失败）、总进度条、
    可折叠实时日志、随时取消；完成后一键进入应用。
  - 阶段：Node 运行时 → 引擎依赖（dsh + 插件）→ 桥接程序 → 完成标记。
    安装到 `%LOCALAPPDATA%\mirach\runtime`，首次约 200–300MB 下载。
  - 失败有重试；也可随时改用远端引擎分支。
- 安装包内置安装脚本与桥接程序（`bundle.resources`），因此**不再需要下载 1.8GB 便携包**才能用。
  便携包仍保留（离线/免安装场景）。

## 修复

- 安装器复用系统 Node 时增加目录校验：只认真正的 Node 安装目录（含 `node.exe` + `npm.cmd`，
  且不是盘根），否则一律下载官方 zip。此前开发机上 `D:\node.exe` 这种裸二进制会导致递归复制整个盘。
- PowerShell 5.1 下读 JSON 一律显式 UTF-8（无 BOM 的中文 package.json 会被当 ANSI 读坏）。
- 便携版判定收窄为"exe 旁 runtime/ 或 MIRACH_RUNTIME_DIR"，应用内安装的运行时走正常自更新。
- 真机首装验证中修掉的问题（干净机器上都会踩）：
  - `\\?\` 扩展长度前缀让 PowerShell 的 `Join-Path` 报"参数 drive 的值为空"，
    sidecar 阶段必挂（安装器路径来自 Tauri `resource_dir()`）——两侧都做了剥前缀。
  - 安装阶段日志/失败原因乱码且丢行：PowerShell 重定向输出默认用 OEM 码页（GBK），
    宿主按 UTF-8 严格解码一失败就停止读取（连末尾的 JSON 结果帧都丢）——
    脚本统一 UTF-8 输出 + 写一行 flush 一行，宿主改 lossy 解码。
  - 下载分支没建安装根目录，`Move-Item` 到不存在的父目录直接 DirectoryNotFound。
  - 运行时安装根不能放在安装版 exe 目录（`%LOCALAPPDATA%\Mirach`）下面，否则被误判为便携版
    → 改成 `%LOCALAPPDATA%\MirachRuntime`。
  - sidecar 现在优先用**自己 node_modules 里的引擎**（`MIRACH_DSH_BIN` → 内置 → 全局 npm），
    干净机器上不再依赖全局 npm 安装的 dsh。
  - 安装器无结果帧时，错误信息带上输出尾部（不再是干巴巴的"退出码 Some(1)"）。

## 说明

- 自更新端点不变：`docs/latest.json`（Gitee raw），签名校验。
- 远程引擎（SSH）分支与 0.1.1 用法一致，设置 → 通用 → 远程引擎。
