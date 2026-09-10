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

## 阻塞点：引擎 0.1.5-alpha.1 装不下 peer

- 运行时自带引擎 = `0.1.5-alpha.1`（`bootstrap.rs` 的 `SDK_VERSION`）；npm 上 `latest/next` = **0.1.5-rc.1**、`alpha` = 0.1.5-alpha.2。
- 把 `dsh-multi-model-provider` 加入 bundles → 引擎启动报 **`cannot create effect on inactive context`**（SDK initialize 阶段，进程活着但 web 面不监听）。
- 顺带发现：**`dsh-pocket` 一旦进 bundles 也会打断引擎**，报
  `failed to apply loader entry dsh-pocket (dsh-pocket): cannot get property "webServer" without inject`
  （它作为 dependency 装着但不激活时无碍——这就是本机原本的状态）。
- 现状：bundles 已恢复为"不含 pocket / 不含 peer"的可知良好集合，`_boot_verdict` 实测 `runtime ready` ✓。

**下一步**（未做）：把运行时引擎升到 0.1.5-rc.1（走 mirach 的引擎更新路径，或改 `SDK_VERSION` 重打运行时包），再试把 peer 放进 bundles；仍失败就查 peer 的 `spec/`、`tests/` 与 `plugin-spec.json` 找它要求的引擎版本/服务。

## 工具（scripts/）

- `_dev_with_runtime_engine.cmd`：dev 前端 + 已安装运行时（debug 构建强制 `src+tsx`、机器级 `NODE_22_BIN` 指向 Node24 都会打断引擎，这里都钉住了）。
- `_kill_dev_stack.ps1`：清 mirach/vite/tauri/sidecar 并确认 1420 释放。
- `_boot_verdict.ps1 -Root <runtimeRoot>`：起 sidecar 看是否 `runtime ready`（引擎能否装配的唯一判据）。
- `_check_voice_routes.ps1`：探 `/dsh-realtime-voice/{client.js,models,audio-input-worklet.js}`。
- `_probe_mic.mjs`：CDP 里跑 `getUserMedia` + AudioWorklet，打印 mic/AEC 参数。
- `_set_bundles.ps1` / `_restore_bundles.ps1` / `_toggle_peer_bundle.ps1`：profile bundles 白名单的读写。
- `_verify_archive.ps1` / `_pack_runtime.ps1` / `_prune_apply.mjs`：运行时打包与裁剪（裁剪白名单见 AGENTS.md）。
- `_add_voice_plugins.ps1` / `_finish_voice_plugins.ps1`：官方 CLI（`dsh plugin --profile mirach add …`）装语音相关包。
