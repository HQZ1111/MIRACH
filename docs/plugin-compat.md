# 插件兼容性（A 线）：dsh 升级后"插件对不上"的定位与结论

> 2026-09-10 定案。用户现象："每次 dsh 升级都对不上，插件可能是过期插件没更新，新版本不支持
> 之前的插件了"。结论：**插件本身多数已是最新版；真正的原因是插件直接 import 的引擎 API
> 在新引擎里被删/改名，ESM 导入期就炸，整棵插件树连坐**。下面是可复现的证据链与工装。

## 1. 插件版本现状（`scripts/_plugin_versions.mjs` 查 npm dist-tags）

| 包 | 本地 | npm latest / next | 结论 |
|---|---|---|---|
| dsh-multi-model-provider | 0.1.0-rc.19 | latest=0.1.0-rc.11 / **next=0.1.0-rc.19** | 已是最新（next 线） |
| dsh-realtime-voice | 0.3.3 | 0.3.3 | 已是最新 |
| dsh-tavern | 2.2.2 | **2.3.1** | 有更新 |
| dsh-pocket | 2.10.3 | **2.10.6** | 有更新 |
| dsh-workgroup | 0.1.0 | 0.1.0 | 已是最新 |
| dsh-muv-engine / -table | 0.3.1 / 0.2.1 | 同 | 已是最新 |
| @deepseek-ai/dsh-subagent-codex / -claude-code | 0.1.5-alpha.1 | alpha=0.1.5-alpha.2 / **next=0.1.5-rc.2** | 有更新（rc 线） |
| @deepseek-ai/dsh-client-runtime | 0.1.1-rc.2 | next=0.1.1-rc.2 | 已是最新 |

引擎（`%LOCALAPPDATA%\MirachRuntime\agent-sidecar\node_modules\@deepseek-ai\dsh`）= **0.1.5-rc.1**。

## 2. 真正的原因：硬 ESM 导入失败，整棵树连坐

把 `dsh-multi-model-provider` 加进 `dsh.profile.bundles` 后，引擎能起进程、但 **initialize 握手失败**：

```
JSON-RPC error: cannot create effect on inactive context        （SDK 侧只看到这句）
```

用 `scripts/_engine_init_probe.mjs`（手写 initialize，直取引擎 stderr）看到根因：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
  failed to import loader entry multi-model-provider (dsh-multi-model-provider):
  The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'

file:///<profile>/node_modules/dsh-multi-model-provider/lib/index.js:4
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
         ^^^^^^^^^^^^^^^^^
SyntaxError: The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'
```

- 这是 **ESM 链接期**错误（不是运行时），所以插件自己的 try/catch 兜不住，cordis 的
  `include` 条目 apply 失败 → 上下文失活 → 后续 `ctx.effect` 报 "inactive context"。
- 插件声明 `peerDependencies` 是 `^0.1.1-rc.2`（语义上"允许" 0.1.5-rc.1），但实际用的
  导出在新引擎里没有了 → **声明范围没兜住 API 漂移**。
- 同一条链上 `dsh-realtime-voice` 现在就在 bundles 里、而它的 peer `dsh-multi-model-provider`
  装不下 → 语音的 realtime runtime 起不来（这就是语音 P1 卡住的那一步）。

**所以"对不上"不是"插件没更新"，是插件写的引擎 API 与当前引擎不匹配**（可能作者按 repo 源码或
另一条版本线写的）。这类问题只能在插件侧修（或降到它匹配的引擎版本），mirach 不该也不能替它糊。

## 3. 为什么会"整机打不开"（可改进项）

`agent-sidecar/src/plugins.ts` 的安装/激活是**事务性**的（写 bundles 失败会回滚），但
**回滚判据只有"CLI 装包/patch 文件校验"**，不包含"引擎还能不能用"。于是"能装上但装完引擎起不来"
的插件会直接把应用带进打不开的状态（只能手动改 profile）。建议（未做）：

1. **last-good 快照**：引擎 `initialize` 成功时把 `dsh.profile.bundles` 抄一份到
   `<profile>/bundles.last-good.json`；启动失败且当前 bundles ≠ last-good 时**自动回滚并告知**
   （文案里带插件名）。
2. **激活前试跑**：写 bundles 前用 `dsh-sdk-client` 起一次短超时探针（同 profile，换端口），
   失败就拒绝激活并**把引擎原始 stderr 那几行**回显给用户（现在只回一句人话）。
3. 版本提示：拿 `_plugin_versions.mjs` 的口径在插件管理器里标"有更新/已最新"。

## 4. 工装（`scripts/`，非产品代码）

| 脚本 | 用途 |
|---|---|
| `_plugin_versions.mjs` | 本地已装版本 vs npm dist-tags / 最近版本 |
| `_engine_boot_probe.mjs` | 直接起引擎（同 sidecar argv/env），只验证"进程能起" |
| `_engine_init_probe.mjs` | **手写 initialize 握手** + 引擎 stderr 全文（找根因用这个） |
| `_engine_sdk_probe.mjs` | 用官方 SDK 走完整握手（应用路径口径：READY/FAILED + 错误） |

三者都会自动备份/恢复 `~/.mirach/profiles/mirach/package.json`，可安全重复跑。
`--add <pkg> [--add-before <anchor>]` 可临时把插件加进 bundles 做对照。

## 5. 已确认的无关项（别再往这上面查）

- 引擎文件裁剪（`_pack_runtime.ps1` 白名单）没问题：当前运行时里 241 个 `@deepseek-ai/*` 齐全。
- profile 的 `node_modules/@deepseek-ai` 里有 `dsh-brand@0.1.5-alpha.1`、`dsh-sdk-protocol@0.1.5-alpha.1`
  两个**旧引擎残留**（引擎侧是 0.1.5-rc.1）。实测把这两个挪走，故障现象不变（不是本次根因），
  但它们属于同一类漂移，值得在插件重装时一并清掉。
- 插件顺序（provider 在 voice 前/后）不影响结果。
