# 全双工语音（陪伴版）— 实施记录与现状

目标与方案见计划（前台实时语音 dsh-realtime-voice：豆包 WebSocket / OpenAI WebRTC 双协议；
寒暄直接回，要干活时写输入框 → 等推理模型 → 念出来；HUD 悬浮语音条；向量语义记忆；陪伴循环）。

## 已落地（截至 2026-09-10）

| 项 | 状态 |
|---|---|
| WebView2 麦克风权限钩子 | ✅ `src-tauri/src/lib.rs::attach_mic_permission`（主窗 + HUD，只放行 MICROPHONE，其余 DENY）。wry 只自动放行剪贴板，没有这个钩子 `getUserMedia` 直接被拒。依赖 `webview2-com = "0.38"`（与 tauri/wry 锁定的 0.38.2 一致）。日志形如 `[mirach] permission request kind=1 -> state=1` |
| 插件静态资源通道 | ✅ `/dsh-realtime-voice/` 加入前端 `PROXY_PREFIXES`（`src/dsh-kernel/transport.ts`）与 sidecar `handleHttpProxy` 白名单 —— client.js 与 audio-input-worklet.js 同源可加载，CSP 不用放开 |
| AudioWorklet / WS / RTCPeerConnection | ✅ 应用内实测可用（worklet 支持 blob 与同源两种加载） |
| 系统麦克风总开关 | ✅ 已按用户授权打开（`HKLM\...\ConsentStore\microphone` = Allow + LastSetTime 刷新）|
| `getUserMedia` | ⚠️ 仍 `NotAllowedError: Permission denied by system`：OS 已放行（SAPI 能开麦）、钩子已放行、`--use-fake-ui-for-media-stream` 也无效 → 只剩 WebView2/Chromium 进程内缓存，**待重启复验**；真不行转 Rust `cpal` 采集（SAPI 已证明底层可用）|
| 引擎侧依赖 | ✅ 已装 `dsh-multi-model-provider@0.1.0-rc.19`（提供 `realtimeModelRuntime`）、`@deepseek-ai/dsh-client-runtime@0.1.1-rc.2`、升级 `dsh-realtime-voice@0.3.3`（都进 profile 的 dependencies）|
| 语音插件路由 | ❌ 仍 404：把 peer 放进 profile `dsh.profile.bundles` 后**引擎装配失败**（见下）|

## 阻塞点：引擎装不下 peer（已排除版本因素）

- 运行时自带引擎原本是 `0.1.5-alpha.1`（`bootstrap.rs` 的 `SDK_VERSION`），而 profile 的插件树是 `0.1.5-rc.1`
  → 已把运行时对齐到 **engine 0.1.5-rc.1 + sdk 0.1.5-rc.1**（`scripts/_upgrade_runtime_engine.ps1`，
  即 `npm install --prefix <runtime>\agent-sidecar @deepseek-ai/dsh-sdk-client@0.1.5-rc.1`），
  但仍**装不下 peer**：把 `dsh-multi-model-provider` 加入 bundles → 引擎装配失败
  （`cannot create effect on inactive context`）。所以**不是 alpha/rc 版本错配**。
- 顺带确认：**`dsh-pocket` 一旦进 bundles 也会打断引擎**，报
  `failed to apply loader entry dsh-pocket (dsh-pocket): cannot get property "webServer" without inject`
  （它作为 dependency 装着但不激活时无碍）。
- 现状：bundles 已恢复为"不含 pocket / 不含 peer"的可知良好集合，rc.1 运行时下实测 `runtime ready` ✓
  （dev 应用与引擎正常，主对话可用）。
- **待办（下一轮的第一步）**：拿到引擎原始的 plugin-apply 错误。已试过但不奏效：引擎直接跑（stdout/stderr
  全静默）、`DEBUG=cordis:*`+`DSH_LOG_LEVEL=debug`、手写 JSON-RPC 发 `initialize`（引擎不回包——握手参数
  与 SDK 的还不一致）。可行的下一步：① 照 SDK 的 `initialize` 参数逐字段复刻（含 `env`/`patches` 语义）；
  ② 单独只留 peer 一个 bundle 做隔离启动；③ 读 peer 的 `tests/`+`spec/` 找它期望的 profile 配置。
- 另一件该做的对齐：运行时引擎既然已是 rc.1，`bootstrap.rs` 的 `SDK_VERSION` 也应改成 `0.1.5-rc.1`
  并重打运行时包（否则新装机器又会装回 alpha.1）。

## 工具（scripts/）

- `_dev_with_runtime_engine.cmd`：dev 前端 + 已安装运行时（debug 构建强制 `src+tsx`、机器级 `NODE_22_BIN` 指向 Node24 都会打断引擎，这里都钉住了）。
- `_kill_dev_stack.ps1`：清 mirach/vite/tauri/sidecar 并确认 1420 释放。
- `_boot_verdict.ps1 -Root <runtimeRoot>`：起 sidecar 看是否 `runtime ready`（引擎能否装配的唯一判据）。
- `_check_voice_routes.ps1`：探 `/dsh-realtime-voice/{client.js,models,audio-input-worklet.js}`。
- `_probe_mic.mjs`：CDP 里跑 `getUserMedia` + AudioWorklet，打印 mic/AEC 参数。
- `_set_bundles.ps1` / `_restore_bundles.ps1` / `_toggle_peer_bundle.ps1`：profile bundles 白名单的读写。
- `_verify_archive.ps1` / `_pack_runtime.ps1` / `_prune_apply.mjs`：运行时打包与裁剪（裁剪白名单见 AGENTS.md）。
- `_add_voice_plugins.ps1` / `_finish_voice_plugins.ps1`：官方 CLI（`dsh plugin --profile mirach add …`）装语音相关包。
