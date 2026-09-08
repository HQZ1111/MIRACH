# hermes → mirach 移植清单（全量对照）

> 说明：mirach 移植自 hermes（`D:\hermes-agent-main`）的功能，全部遵循
> 「官方 dsh 已有的不重做、hermes 代码能直接抄的直接抄、只做 mirach 侧适配」原则。
> 本表回答：移植了什么、hermes 侧源在哪、mirach 侧落在哪、怎么实现的。

## 一、启动与连接体系（2026-09 修复"假连接"时移植）

| 功能 | hermes 侧源 | mirach 侧落点 | 实现说明 |
|---|---|---|---|
| 启动状态机 | `apps/desktop/src/store/boot.ts` | `src/store/boot.ts`（原样移植） | nanostores atom：phase 阶梯 + 单调进度（只升不降）+ 错误闩锁；`completeDesktopBoot`/`failDesktopBoot`/`resumeDesktopBootForRetry` 全套 |
| 有界等待 | `src/lib/with-timeout.ts` | `src/lib/with-timeout.ts`（原样移植） | `withTimeout()` + 冷启动预算 45s / 重连单次 20s 常量 |
| 重连退避 | `src/lib/reconnect-backoff.ts` | `src/lib/reconnect-backoff.ts`（原样移植） | full-jitter 指数退避（AWS jitter 论文），300ms 基数 / 15s 封顶 |
| 单飞重连 | `src/store/gateway-reconnect.ts` | `src/store/gateway-reconnect.ts`（原样移植） | 多处触发重连时 single-flight，同跑只有一个 |
| 启动即预热引擎 | `electron/main.ts`（`startHermes()` 在 createWindow 时立即拉起后端） | `src/store/gateway.ts`（pingGateway → dsh_prewarm 单飞） | 对齐"后端冷启动是主要启动成本，别懒到首条消息"——冷启动在启动门内完成，进主界面即可用 |
| 三层就绪门 | `electron/backend-ready.ts`（stdout 哨兵）+ `backend-health.ts`（/health 轮询）+ `gateway-ws-probe.ts`（WS 握手） | `src-tauri/src/dsh_relay.rs`（`dsh_engine_ready`）+ `gateway.ts`（两层轮询） | sidecar 进程 ready ≠ 引擎 ready；启动门必须探引擎 runtime 就绪，根治"显示已连接但发消息无反应"假阳性 |
| liveness 探测 | `use-gateway-boot.ts`（wake/focus 时 ping 探活） | `gateway.ts` `ensureEngineAlive()` | 发消息前/放行前先探引擎；失败触发退避重连 |
| 失败可见化 | `onBackendExit` 非阻塞 toast + 有界重试后 BootFailure | `chat-events.ts` message.error 分支（已有）+ `client.ts` 发送前预检 | 引擎未就绪 → 聊天区系统错误 + 重试条 + busy 释放，绝不静默吞 |
| "冷启动后不复活全屏" | `gateway-connecting-overlay.tsx`（coldBootDoneRef 闩锁） | `AppLayout` 浮层挂载条件（`startupPhase === "ready"` 才显示） | 重连期间不遮聊天，用户可继续打字/开设置 |

**启动页为什么以前"看不见/是假的"**：旧 SplashGate 是定时假进度（60ms+4%，1.8s 定时退出），且 tauri dev 下 vite 先起、窗口秒开、引擎后到——启动页一闪而过甚至跳过，而引擎冷启动 ~28s 全暴露给首条消息。现在进度条消费 `$desktopBoot` 的真实阶段（sidecar 启动 84% → 引擎预热 88% → 就绪 100%），引擎就绪才放行。

## 二、交互与系统组件（2026-09 批量移植）

| 功能 | hermes 侧源 | mirach 侧落点 | 实现说明 |
|---|---|---|---|
| 快捷键系统 | `src/lib/combo.ts` + keybinds actions/capture/conflicts + `use-keybinds.ts` | `src/lib/keybinds/combo.ts` + `actions.ts`（原样）+ `src/store/keybinds.ts` + `src/hooks/useKeybinds.ts` | 组合键解析/捕获改键/冲突检测全套；mirach 动作目录（⌘K 面板/⌘N/⌃Tab 切会话/⌘B 栏切换等）；设置页改键面板 |
| 通知中心 | `components/notifications.tsx` + `store/notifications.ts` | 同名文件（原样 + 中文文案/Alert/Button/Codicon 垫片） | 置顶堆叠 + "+N" 展开 + 动作按钮 + 底右常驻确认栈；`pushToast` 桥接同源；桌面通知（turnDone/turnError）走 hermes 语义 |
| 抓取滚动 | `hooks/use-grab-scroll.ts` | `src/hooks/useGrabScroll.ts`（原样） | 中键/手型拖拽滚动面板 |
| 语音朗读 TTS | `lib/speech-text.ts` + voice 管线 | `src/lib/speech-text.ts`（原样）+ `src/lib/voice-playback.ts`（管线适配）+ `src/store/voice-playback.ts` | 句子切分 + speechSynthesis 分块朗读；回复完自动朗读（turnDone 触发）；中文停止词（`lib/voice-stop-word.ts`） |
| 会话星图 | `components/starmap/*`（d3-force 渲染管线） | `src/components/starmap/*`（color/geometry/render/simulation/text/time-axis 原样）+ mirach 侧 index/node-context-menu/share-controls 重写 | 会话关系力导图 + 时间轴 + 图例 + 分享码；overlay 从 ⌘K/侧栏进入 |
| 触感/提示音开关 | `$hapticsMuted` 单一共享静音 | `src/lib/haptics.ts` + `hooks/useHaptics.tsx`（事件同步） | 顶栏触感按钮 = 提示音总开关（含完成音/思考音） |

## 三、插件化移植（mirach 插件注册表）

| 功能 | hermes 侧源 | mirach 侧落点 | 实现说明 |
|---|---|---|---|
| 唤醒词 | Electron HUD IPC + openWakeWord | `src/plugins/plugin-wake-word.ts` | Web Speech API 连续检测（zh-CN），变体匹配（hey hermes/嘿 hermes/hey mirach…）；唤醒 → 提问卡 + 听写；Composer 唤醒按钮右键换短语（默认 "hey hermes"） |
| 提示音系统 | WebAudio 合成音库（振荡器+包络+混响，14 种完成音变体） | `src/plugins/plugin-sound-cues.ts` | voice/pluck/bloom/whoosh/airPuff 合成器 + 14 COMPLETION_SOUND_VARIANTS + 思考音/唤醒音；Web Locks 跨窗口去重；$aiStreaming 下降沿→完成音、上升沿→思考音；试听/换变体在插件菜单 |

## 四、消息内嵌卡片（国产化）

| 供应商 | hermes 侧源 | mirach 侧落点 | 说明 |
|---|---|---|---|
| 框架 | `providers/types.ts` + Embeds 渲染器 | `src/components/chat/markdown/embeds/types.ts` + `Embeds.tsx`（detectEmbed 优先 + 同意卡 + FrameRenderer） | EmbedProvider 联合类型 + iframe 渲染 + 同意卡（隐私提示后才加载第三方帧） |
| 哔哩哔哩 | `providers/bilibili.ts` | 同名（原样） | BV 号解析 → player.bilibili.com 嵌入 |
| 网易云音乐 | `providers/ncm.ts` | 同名（原样） | 歌曲外链播放器（86/450 高度两档） |
| 高德地图 | `providers/amap.ts` | 同名（原样） | reveal/marker/search 链接 → 地图帧 |
| 抖音 | `providers/douyin.ts` | 同名（原样） | 9:16 播放器帧 |
| 红果短剧 | `providers/hongguo.ts` | 同名（原样） | 9:16 页面帧（XFO 受限说明） |

## 五、会话环境与人格（借鉴 hermes 隔离模型）

| 功能 | hermes 侧源 | mirach 侧落点 | 实现说明 |
|---|---|---|---|
| 环境隔离模型 | profile 目录即环境 + session_key 路由 | `src/lib/session-env.ts`（$sessionEnvIndex）+ sidecar `<envId>::<frontendId>` 命名空间 | 隔离来自引擎会话映射，非客户端过滤；详见 `docs/research-isolation.md`（调研存档） |
| 每环境主人格 | hermes Profile/Bots 架构 | `src/store/agents.ts` ENV_PRIMARY_SEEDS | 阶段1已落地：Mirach / Mirach chat / code / work / finance / write；详见 `docs/env-persona-porting-plan.md` |

## 六、有意未移植（及原因）

| hermes 功能 | 原因 |
|---|---|
| git-checkout 自更新（hermes-setup.exe / update-marker / venv-blocker） | hermes 整个应用住在可变 git checkout 里，mirach 是打包安装的 Tauri 应用；GUI 自更新走 Tauri updater。但**更新编排经验已借鉴**（互斥标记/门控/锁扫描） |
| 首装 bootstrap 引导安装（install.ps1 十四阶段） | hermes 装 Python venv + checkout，mirach 引擎是 npm 全局包（一条命令）；UX 骨架（阶段进度/日志流/本地云端选择页）已调研，待软件成型后按 `docs/sync-procedure.md` 的形态移植 |
| Electron OAuth cookie 分区登录窗 | Electron 专属；Tauri 需自建 webview 登录窗方案 |
| ACP 边车通道 | mirach 已收敛 dsh 单核心（acp.rs 已删）；hermes 引擎接入位保留在 docs/api-contract.md 的历史记录里 |

## 七、移植守则（AGENTS.md 精神在移植语境下的重申）

1. dsh 官方已有的组件/机制 → 用官方的，不移植 hermes 的同类物（例：工作区用官方 WorkspaceBrowser，不搬 hermes 侧栏）
2. hermes 的纯逻辑/纯渲染（无 Electron 依赖）→ 原样复制，文件头注明来源
3. Electron 耦合层（IPC/child_process/safeStorage）→ 换成 Tauri invoke/event/命令，模式照抄
4. 每次移植在 HANDOVER.md 记一批；本表为汇总索引
