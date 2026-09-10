# 官方实现采纳对照（apps/desktop + apps/desktop-host → mirach）

本文档记录 mirach 对官方 Electron 桌面壳 / `@deepseek-ai/dsh-desktop-host` 机制的
采纳状态。**mirach 的定位不变**：接入官方组件、跟随官方升级；每项以「官方文件
升级后 mirach 无需改代码即可跟随」为验收标准。

更新时间：2026-09-10（第二轮：官方机制替换落地）

## 已采纳（本轮）

| # | 官方机制 | mirach 实现 | 验收 |
|---|---|---|---|
| 1 | `dsh-client-modules` 官方模块系统：queue 门面 + `createClientModuleSystem` + `__DSH_BOOT__` 图 + `ClientModuleSystem`（`packages/client/modules/src/client/*`） | `src/dsh-kernel/module-loader-shim.ts` 逐行对齐官方 HTML 门面（queue → `create()` 引导 → 官方接管）；`boot.ts` 经 `moduleSystem.import()` 实例化全部 46 个 bundle，`ctx.modules` 由官方 `apply` 提供 | ✅ 官方模块表接管解析：strip `/client`、重复注册拒绝、require 环检测、样式归属；mirach 不再自实现加载器。bundle 仍由 Vite 构建期打进应用（离线可用、无需放宽 CSP） |
| 2 | `dsh-app-boot`：`readProfileManifest` / `writeProfileManifest` / `loadProfileDirectory` / `composeEntries` | `agent-sidecar/src/plugins.ts` 的 bundles 读改写与「引擎实际装配行」全部改走官方 API（原为手搓 JSON + regex 解析已删除的 cordis.generated.yml） | ✅ 官方字段校验/格式化随包升级；设置页插件清单 = 官方 profile 组合结果 |
| 3 | 应用自有 overlay（`desktop.cordis.patch.yml`） | `agent-sidecar/config/mirach.cordis.patch.yml` + SDK `patches`（`HarnessClientOptions.patches`，与官方 desktop-host 同机制） | ✅ 应用自有装配层，profile 重建/引擎升级不覆盖 |
| 5 | `dsh-home-paths` `resolveDshHome` | `agent-sidecar/src/runtime.ts` 导出 `mirachHome()`（DSH_HOME 优先，`~/.mirach` 为默认，官方函数负责 `~` 展开/绝对化/空白值处理）；plugins/dsh/session-store/subagent-backends 统一使用 | ✅ 单一解析点 |
| 6 | 宿主注入 `__DSH_CONNECTION_RECOVERY__`（`connection/src/index.ts:121-123`） | `transport.ts` `installKernelTransport()` 注入与官方默认同值的恢复参数（显式可调单点） | ✅ 官方参数变更时只改一处 |
| 7 | per-stream abort/cancel（desktop-host 的 `cancel(streamId)`） | `dsh_http_proxy` 支持前端 `requestId` + 新增 `dsh_http_proxy_cancel`；`transport.ts` 的 `AbortSignal` 真正中止在途 HTTP | ✅ 取消后不再跑满 120s |

## 未采纳（附原因）

| # | 官方机制 | 原因 |
|---|---|---|
| 4 | agent-presets `roots: [{path, trust:'system'}]` | 官方 desktop-host 指向的是**打包期复制进种子**的 `config/agent-presets`；npm 发行版 `@deepseek-ai/dsh` 不含该目录（已核实全局安装与 workspace 两处），没有可指向的随包预设根。mirach 前端读写的 `~/.dsh/.agent-presets` 与插件默认用户根一致。待官方发行包提供该目录后在 `mirach.cordis.patch.yml` 追加（文件内已留示例）。 |
| 7b | 帧化字节管道（64KiB 分帧 + 背压） | **安全半已做**：`dsh_http_proxy` 请求体 256MB 字符上限（≈192MB 原始字节，引擎聚合限制 200MB 之内）、响应 64MB 上限、逐跳头过滤——超大负载现在**明确报错**而不是无限缓冲。**流式半未做**：真正的分帧+背压要按 `apps/desktop/src/host-protocol.ts` 重写 Rust↔sidecar 传输，改动面覆盖全部命令与事件通道，需单独排期 + 大附件场景回归。 |
| 8 | 事务化 pnpm project manager | **已做等价语义**（见上表 #8 行）：安装/卸载改为「清单快照 → 官方 CLI → 安装后校验（`dsh.bundle.patch` 必须存在且在包目录内）→ 失败恢复清单并移除半装包」。未做的是官方那种"整 profile staging + 完整后端健康检查 + 目录原子切换"——它需要第二份引擎实例做健康检查与跨进程锁协调，成本远高于收益。 |
| 9 | `createSharedFetchHandler('/api')` | mirach 的宿主是 sidecar 而非进程内 cordis；等价语义已由 `dsh_http_proxy` 提供（含官方 `ownsHost`/`openStream` 契约）。 |
| 10 | host 侧 `dsh-host-directory-picker-native` | Tauri 原生对话框等价且少一个依赖。 |
| 11 | 单实例锁 | ✅ 已采纳（`tauri-plugin-single-instance` + 独立命名互斥量竞态兜底）。electron-updater → Tauri updater（见下）。 |

## 相关：应用自更新（Tauri updater）

- 依赖：`tauri-plugin-updater`；公钥在 `tauri.conf.json` `plugins.updater.pubkey`，
  私钥在 `src-tauri/.tauri-keys/`（已 gitignore）。
- 端点：配置项 `updateEndpoint`（config.json / `MIRACH_UPDATE_ENDPOINT`），空 = 关闭。
- 命令：`app_update_check` / `app_update_install`；UI 在 设置 → 关于 → Mirach 标签。
- 发布：`TAURI_SIGNING_PRIVATE_KEY=... pnpm tauri build` → 上传产物 + `latest.json`
  到端点目录即可（签名由 minisign 校验，篡改会被拒绝）。
