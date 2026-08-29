# 工作交接 — 2026-08-12 晚（21:00-23:40）：聊天记录弹窗 + 首启/登录页体系

> 给下一位接手 AI 看的交接文档。覆盖 **今晚（2026-08-12 21:00 后）** 在
> `C:\Users\Administrator\my-hermes-rs`（React 19 + Vite + Tailwind v4 + Tauri v2 + Rust 桌面客户端）
> 的全部改动（依据 mtime 20:50 之后）。白天（公司那轮）改动见 `HANDOFF-2026-08-12.md`，更早见 `HANDOFF-2026-08-11.md`。
> 今晚主线：**① 窗口跑屏外修复 ② 聊天记录弹窗（微信式）③ 首启引导按原型重做 ④ 移除安装层 ⑤ 启动密码登录页**。

---

## 0. 一句话总结

晚上做了五件事：修了窗口位置跑到屏幕外的 bug（物理/逻辑像素错配 + 离屏校验）；
把"查找聊天记录"做成完整弹窗（搜索 + 标签页 + 日历 + 多选收藏/转发/分享到手机）；
按原型把首次引导重做成 **provider 连接引导**（Picker → API key/OAuth → 确认模型 → Begin）；
**移除了应用内安装层**（DesktopInstallOverlay/FirstRunRemoteForm 已删，打包安装由系统安装器负责）；
新增**启动密码登录**（设置→安全开关 + 改密码 + 启动门：开启=登录页，关闭=连接动画），登录页已做成启动页风格（品牌面板 + 引擎/ACP/版本状态）。

> ⏭️ 用户明天继续：**登录页与动画过渡页的视觉设计**（今天只做了功能骨架，视觉后续再调）。

---

## 1. 改动明细（按功能域）

### A. 窗口跑屏外修复（`src/lib/windowState.ts`）⚠️ 重要 bug

**症状**：`npm run tauri dev` 应用进程在跑但窗口不出现。定位：PowerShell `GetWindowRect` 查句柄发现窗口在 **(-32000,-32000)**（Windows 停靠离屏/最小化窗口的标准位置）。
**根因两点**：
1. **物理/逻辑像素错配**：`outerPosition()/outerSize()` 返回**物理像素**，恢复时却用 `LogicalPosition/LogicalSize`（逻辑像素）——缩放 ≠100% 或换显示器后位置错位。
2. **无离屏校验**：恢复位置照单全收，不检查是否落在当前显示器内。

**修复**：
- 恢复改用 `PhysicalPosition/PhysicalSize`（与保存单位一致）
- 恢复前 `availableMonitors()` 校验：窗口至少 80×60px 与某显示器相交，否则 `win.center()` 回退居中
- 临时急救手段（已删）：写 ps1 用 user32 `SetWindowPos` 把窗口拉回 (80,40) 1600×920 —— 下次遇到同样问题可复用该思路

### B. 聊天记录弹窗（微信"查找聊天记录"样式）— 新功能

**入口**：Ctrl+F 或对话区右上角**工具按钮**（🕘 History 图标，StatusWindow 左侧）→ 菜单 [聊天记录] [隐藏/显示会话标签页]。

| 文件 | 内容 |
|---|---|
| `src/store/chat-history.ts`（新） | `ChatRecordEntry` 模型（type: chat/image/file/link + role/text/time/date/dayMs/messageIndex）；`buildChatRecords()` 从当前会话构建；**mock 日期合成**（400 条消息按 `floor(i/14)` 铺到最近 30 天）+ 合成 5 张图片（SVG 渐变 dataURL）+ 4 个文件；真实模式图片从 `$toolCalls` 的 `image_generate` 解析（`parseGeneratedImage`）、日期=当天；链接从消息 `detectArtifacts` 提取。状态：`$chatHistoryOpen/open/close`、`$showSessionTabs/toggleSessionTabs`、`$jumpRequest/requestJump`（跨组件跳转事件）。 |
| `src/store/favorites.ts`（新） | 消息收藏（快照存 localStorage `hermes.favorites.v1`）：`$favorites/isFavorite/toggleFavorite/toggleFavoriteBatch/removeFavorites`。 |
| `src/components/chat/CalendarPopover.tsx`（新） | 月历弹层：周一开头、上月/下月、今天/全部日期；有消息的日期显示蓝点。 |
| `src/components/overlays/ChatHistoryOverlay.tsx`（新） | 弹窗主体（OverlayShell 720×600）：搜索框 + 日期按钮（开日历）+ 多选开关；标签页 全部/对话/图片/文件/链接/收藏；结果行（发送者徽标/图片缩略图/文件图标 + 命中词 `<mark>` 高亮 + 时间/日期）；**点对话结果 → requestJump(messageIndex) + 关窗**；多选工具条 [收藏][转发][分享到手机][取消]；转发弹层（选会话 → `appendSessionUserMessage`）；分享弹层（8 平台 → notify + 剪贴板复制 + toast）。 |
| `src/components/layout/MainPanel.tsx` | Ctrl+F 改为 `openChatHistory()`（不再开 inline 查找条）；ChatSection 监听 `$jumpRequest` → `jumpToFind(idx)` 滚动+闪烁（复用原 findMatches/jumpToFind，**保留为跳转服务**）；`SessionTabs` 包 `$showSessionTabs` 条件渲染；ChatSection 顶部加工具按钮（Wrench/History 图标菜单）。`InThreadFind.tsx` 组件保留但 Ctrl+F 不再触发（死代码，可清）。 |

### C. 首次引导按原型重做（provider 连接引导）— 替换原三步教程

**`src/components/overlays/OnboardingOverlay.tsx` 整体重写**（对齐原型 DesktopOnboardingOverlay）：
- **Picker 屏**：精选提供商（**Nous Portal** OAuth 置顶 + Fireworks）+ "我有 API key"（提供商下拉+粘贴 key+保存并继续）+ 其他提供商折叠列表（OpenAI/Anthropic/DeepSeek/OpenRouter/Gemini/xAI）+ 底部"稍后选择提供商"
- **API key 表单** / **OAuth 演示**（Nous：三步步骤条 + 模拟完成授权；真实模式接引擎 OAuth 后替换）
- **确认默认模型**：`getApi().getModels()`（mock 返回 Kimi K2/DeepSeek V3 带价格，空则演示默认 hermes-1.5-pro），单选 + "开始使用"
- 完成/跳过写 `hermes.onboarded.v1`；命令面板"使用引导"随时重开（入口不变）

**`src/store/providers.ts`（新）**：提供商注册表 + 连接状态共享（localStorage 沿用旧 key `hermes.providerKeys.v1`，历史数据自动沿用）：`$providers/connectProvider/connectProviderOAuth/disconnectProvider/hasConnectedProvider`。

**`src/components/overlays/SettingsOverlay.tsx`**：`ProvidersContent` 从本地 state 重构为用 `$providers` store（删了 `ProviderAuth`/`PROVIDER_LIST`/`loadProviders`/`persistProviders`）——**引导里保存的提供商，设置页立即同步显示已连接**。

### D. 移除应用内安装层

- **AppLayout**：删 `showDesktopInstall`/`dismissInstall`；真实模式启动**直接用默认引擎地址**（config `engineBase`，默认 http://127.0.0.1:8787）探活，不通走 BootFailure（重试/去设置连接）
- **删除文件**：`src/components/overlays/DesktopInstallOverlay.tsx`、`FirstRunRemoteForm.tsx`（已无引用）
- 打包后的安装向导（安装位置/快捷方式等）由 Tauri bundle 的 **NSIS/MSI 安装器**负责（系统级，非应用内页面）；定制改 `tauri.conf.json` 的 `bundle.nsis/msi` 段
- 命令面板 mock 预览入口"预览启动流程"同步改为两阶段：**连接动画 → provider 引导**

### E. 启动密码登录（新功能）

**`src/store/password.ts`（新）**：密码加盐哈希（Web Crypto SHA-256 + 随机盐，存 localStorage `hermes.password.v1`，明文不落盘；桌面本地锁非强安全边界）。`$startupPhase: "splash"|"locked"|"ready"` + `lockApp/unlockApp`；`$passwordEnabled/setAppPassword(≥4位)/clearAppPassword/verifyAppPassword`。

**`src/components/layout/StartupGate.tsx`（新）**：启动门（主界面始终在背后渲染，叠上层）：
- 密码开启 → **启动页式登录页**：`inset-3 rounded-[40px]`（与软件卡片同尺寸同圆角）；左品牌面板（深色渐变 + H logo + 标语 + 底部状态行），右密码表单；输对 **300ms 淡出无缝进入主页**
- 密码关闭 → **连接动画**（GatewayConnectingOverlay 解码动画 + Preparing 进度，~1.8s）淡出进主页
- 状态行实时检测：**引擎**（`getApi().ping()` 绿/红/检测中 + `config.engineBase` 地址）、**ACP 边车**（`acpAvailable()` 可用/不可用）、**版本**（Tauri `getVersion()`，浏览器降级 0.1.0）

**`src/components/layout/AppLayout.tsx`**：渲染 `<StartupGate />`（卡片末尾）；真实网关浮层（连接中/失败）改为 `startupPhase === "ready"` 后才显示（避免与启动动画叠加）。

**`src/components/overlays/SettingsOverlay.tsx` → SafetyContent**：加"启动密码"分区——**密码登录开关**（开→设置密码弹窗，关→确认后清除）+ **修改密码**按钮（当前密码+新密码+确认，当前密码错拦截）+ `PasswordModal` 组件（z-120）。

---

## 2. 文件清单（今晚）

**新建**：`src/store/chat-history.ts`、`src/store/favorites.ts`、`src/store/providers.ts`、`src/store/password.ts`、`src/components/chat/CalendarPopover.tsx`、`src/components/overlays/ChatHistoryOverlay.tsx`、`src/components/layout/StartupGate.tsx`

**修改**：`src/lib/windowState.ts`、`src/components/chat/InThreadFind.tsx`、`src/components/layout/MainPanel.tsx`、`src/components/layout/AppLayout.tsx`、`src/components/overlays/OnboardingOverlay.tsx`（重写）、`src/components/overlays/SettingsOverlay.tsx`

**删除**：`src/components/overlays/DesktopInstallOverlay.tsx`、`src/components/overlays/FirstRunRemoteForm.tsx`

## 3. 验证状态

- `npx tsc --noEmit` ✅（最终通过）
- `npx vite build` ✅（20-57s 不等，9126+ modules）
- 运行中 `npm run tauri dev` HMR 全程无报错
- 功能点（mock 下可直接验）：
  - Ctrl+F / 工具按钮 → 聊天记录弹窗；各标签页；日历选日期；搜索高亮；多选收藏（收藏 tab + localStorage）、转发（目标会话出现转发内容）、分享（notify + 剪贴板）
  - 设置→安全：开密码登录 → 设密码 → 刷新出现启动页 → 输对进主页、输错红字
  - Ctrl+K → "预览启动流程"：连接动画 → provider 引导
  - 引擎/ACP/版本状态行（mock 下引擎=已连接、ACP=可用）

## 4. 注意事项 / 已知限制

1. **密码开启后每次启动都要输入**（含 dev HMR 刷新 AppLayout 时）——预期行为。关掉：设置→安全开关。
2. **InThreadFind.tsx 已死代码**（Ctrl+F 改走弹窗），未删，可清。
3. **聊天记录数据**：mock 的日期/图片/文件是合成数据；真实模式图片走 tool-calls、日期=当天、文件暂无来源（引擎产物流未接）。跳转依赖 `messageIndex` 与 ChatSection 消息数组同源（mock: `getSessionChat(activeId)`，real: `$liveMessages`）。
4. **分享到手机是演示+复制**（消息平台纯表单无真实发送）。
5. **密码是本地锁**：localStorage + SHA-256 加盐，非强安全（桌面本地；浏览器 DevTools 可见 hash）。若要更强（系统钥匙串/DPAPI）后续可接 Rust 侧。
6. **启动页视觉明天再调**（用户原话）：今天做了功能骨架（品牌面板/状态行/圆角同卡片），布局/配色/动画过渡后续迭代。
7. **findstr 搜中文不可靠**（ANSI 码页）——用 PowerShell Select-String 或 Read 工具。
8. 遗留：AppLayout 里 `PreviewConnecting`（预览用）与 `StartupGate` 的 `SplashGate` 逻辑相似，可考虑合并复用。

## 5. 下一步建议（明天）

- **登录页 / 动画过渡页的视觉设计**（用户指定）：启动页品牌面板配色、logo、转场动画、密码框交互、版本/引擎状态展示细化；连接动画与登录页之间的过渡衔接。
- 可打磨：InThreadFind 死代码清理；PreviewConnecting 与 SplashGate 合并；聊天记录"链接"tab 与 ArtifactsOverlay 联动；密码可接 Rust 侧系统级存储。
- 真实模式验证：VITE_MOCK=0 下走真实引擎时，启动门 → 探活（连接动画）→ provider 引导（getModels 真实）→ 主页。

## 6. 关键文件索引

| 文件 | 作用 |
|---|---|
| `src/lib/windowState.ts` | 窗口几何持久化（物理/逻辑像素 + 离屏校验回退居中） |
| `src/store/chat-history.ts` / `favorites.ts` / `providers.ts` / `password.ts` | 今晚四个新 store（聊天记录/收藏/提供商/密码） |
| `src/components/overlays/ChatHistoryOverlay.tsx` | 聊天记录弹窗（搜索/标签/日历/多选/收藏/转发/分享） |
| `src/components/chat/CalendarPopover.tsx` | 月历弹层 |
| `src/components/overlays/OnboardingOverlay.tsx` | provider 连接引导（Picker→key/OAuth→模型→Begin） |
| `src/components/layout/StartupGate.tsx` | 启动门：登录页（启动页风格）/ 连接动画 |
| `src/components/layout/MainPanel.tsx` | Ctrl+F→弹窗、jumpRequest 跳转、SessionTabs 显隐、工具按钮 |
| `src/components/layout/AppLayout.tsx` | StartupGate 渲染、网关浮层 ready 后显示、预览入口、聊天记录弹窗挂载 |
| `src/components/overlays/SettingsOverlay.tsx` | Providers 用共享 store；安全页密码开关/改密码/PasswordModal |
