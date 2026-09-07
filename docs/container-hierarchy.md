# mirach 容器层级说明

> 本文描述 mirach 桌面应用（Tauri 2 + Vite 7 + React 19）从窗口到叶子节点的
> 容器层级，以及每个容器"承载什么、为什么存在、有哪些关键约束"。
> 与代码的对应关系以 `src/components/layout/*`、`src/dsh-kernel/*`、
> `src/index.css` 为准。改动布局前先读本文的"关键机制与教训"一节。

## 0. 总览

```
Tauri 透明窗口（全屏，无系统边框）
└─ AppLayout
   ├─ 面板阴影层（absolute，透明窗口内的投影）
   └─ panelRef＝软件面板（1580×900 设计稿，圆角 40，translateZ(0)，overflow:hidden）
      ├─ TopBar（absolute 覆盖层 z-10，高 53，窗口拖拽区）
      ├─ LeftToolbar（70px 全高图标栏）
      ├─ MainPanel（main，flex:1 1 0，min-width 350）
      │  └─ 内容容器（relative，flex-1）
      │     ├─ NativeChatArea ＝ .dsh-native-area（官方内核树宿主）
      │     │  └─ 官方 AppFrame（grid：侧栏列 | 对话列 | 详情列）
      │     │     ├─ sidebarCol → renderSlot('sidebar') → MirachSidebar
      │     │     ├─ centerCol → renderSlot('conversation') → ChatView + Composer
      │     │     ├─ detailsCol → renderSlot('details')（常驻挂载，托管时 fixed）
      │     │     ├─ overlayLayer（shell.overlay 槽）
      │     │     └─ DragHandle（左|主手柄；详情手柄已隐藏）
      │     ├─ 终端面板（absolute bottom，只压缩对话列）
      │     ├─ 顶栏覆盖层（createPortal 进官方 centerCol）
      │     ├─ UserQuestionCard / ChatToolButton / StatusWindow（浮动件）
      │     └─ ViewPage（工具类视图，absolute 覆盖对话列）
      ├─ 成员子栏 wrapper（flex 0 0 memberW，内嵌 Sash）→ MemberChatPanel
      ├─ 右侧栏 wrapper（flex 0 0 rightW，内嵌 Sash）→ RightSidebar
      ├─ RightToolbar（60px 全高）
      └─ 功能 Overlays（消息/命令中心/技能/排程/产物…，Suspense 按需）
+ KernelMirrorHost（镜像层，与 AppLayout 平级、在 panelRef 之外）
   └─ 官方根树第二实例（声明链激活器 + 设置弹窗宿主）
```

## 1. 窗口与软件面板

### Tauri 透明窗口
- 无系统边框，窗口本体透明；应用视觉由内部的"软件面板"承担。
- 窗口拖拽区：TopBar 的 `data-tauri-drag-region`（浏览器/ vite 下 TopBar
  为 `pointer-events-none`，不拦下层点击；Tauri 下为 auto）。

### 面板阴影层
- AppLayout 最外层的 absolute div（top/left/width/height = 面板几何 + 圆角 +
  投影），纯粹画阴影，不承载交互。

### panelRef ＝ 软件面板（`data-panel`）
- **承载**：全部应用 UI。白色圆角容器（设计默认 1580×900），窗口内悬浮居中，
  四周留透明边距。
- **`transform: translateZ(0)`（关键）**：让面板成为内部所有 `position:fixed`
  元素的**包含块**——弹窗/遮罩/启动页/图片预览相对面板定位，被圆角
  `overflow:hidden` 裁剪，不会溢出到透明边距上。
- **代价（教训）**：它也是官方树内 fixed 元素的包含块，而 fixed 以 transform
  祖先为包含块后，会被**中间 overflow 祖先裁剪**（如官方 `sidebarCol` 的
  `overflow:hidden`）；且**祖先的 `mask-image` 是组级遮罩，fixed 也逃不掉**。
  需要真正全窗口浮层的 UI（设置弹窗）因此放在镜像层（见 §5）。
- **CSS 变量挂载点**：`--col-right-w`（右栏宽，详情面板宽度公式与右栏
  wrapper 同源）、`--mirach-internal-sidebar-w`（ResizeObserver 从官方侧栏列
  实测写入，顶栏覆盖层/终端/ViewPage 的 left 定位用）。

## 2. 面板直属子层（panelRef 的 flex 行）

| 容器 | 宽度 | 承载 |
|---|---|---|
| TopBar | absolute，高 53，z-10 | 窗口控制圆点（红黄绿）/项目名/插件条/Ctrl+K 搜索；Tauri 下是拖拽区 |
| LeftToolbar | 70px 全高 | 环境切换（Mirach/chat/code/work/finance/write）、收藏/定时任务/拓展/命令中心/知识库/通讯、**设置齿轮（唯一设置入口）**、锁定 |
| MainPanel | flex:1 1 0，min-width 350 | 见 §3 |
| 成员子栏 wrapper | flex 0 0 memberW（默认 380，min 350） | `MemberChatPanel`（成员独立对话，standalone composer 不落主会话 store）；左缘内嵌 **Sash**（主\|子拖拽，hermes 模式：预览写内联样式、松手提交） |
| 右侧栏 wrapper | flex 0 0 rightW（收起 0/hidden） | `RightSidebar`（辅助对话/与其他项目对话/审查/终端/浏览器，浏览器为 child webview）；左缘 Sash（子\|右 或 主\|右互换拖拽） |
| RightToolbar | 60px 全高 | 右侧工具图标栏（打开/激活右栏各面板） |

- 宽度拖拽模型（hermes pane-shell 移植）：主|子、子|右、主|右三段 Sash 在
  各自 wrapper 左缘；拖动中只写内联 flex-basis/width 预览（rafCoalesce 每帧
  一次），松手一次提交 React 状态；`startRightSash` 预览时同步写
  `--col-right-w`，让托管的详情面板跟手。
- 最小宽保护：主区 ≥ 350；不够时先压成员子栏再压右栏（effect 统一求解）。

## 3. MainPanel（主对话区）

- `<main class="relative flex shrink-0 flex-col bg-white">`——**故意不建**
  isolate/stacking context（否则搜索框 z-50 会被 TopBar 压住）。
- 对话区背景圆角层在官方 `centerCol::before`（index.css），与官方内容同容器
  同帧绘制（拖动左栏手柄时不产生帧差错位）。
- 内容容器（relative flex-1）按 `activeView` 二选一：
  - **对话类视图**（mirach/chat/code/work/finance/write）：官方树全高 +
    mirach 覆盖件；
  - **工具类视图**（收藏/知识库/…）：官方树常驻（侧栏列=mirach 侧栏外壳，
    所有视图可用）+ `ViewPage` absolute 覆盖对话列（left 避开侧栏列宽）。
- **mirach 覆盖件**（都在内容容器内、官方树之上）：
  - 顶栏覆盖层（`data-mirach-topbar-overlay`）：**createPortal 进官方
    centerCol**（同容器同帧绘制，拖左栏手柄时无跨层变量帧差）。第一行
    85px（折叠态展开钮 + HeaderSection：项目名/插件/Ctrl+K），第二行会话名
    （官方"对话/轨迹"tabs 经 index.css 右移让位同行）。
  - 终端面板：absolute bottom，left 从侧栏列右缘起；官方 centerCol 由
    `--mirach-terminal-h` 让位（只压缩对话列，不压缩侧栏列）。
  - UserQuestionCard（引擎提问卡，置顶栏下方）、ChatToolButton（聊天记录/
    详细模式/轨迹/Plan）、StatusWindow（活动窗口，右缘 top-[88px]）。

## 4. 官方内核树（.dsh-native-area 内）

`NativeChatArea` 挂载官方根树（`nativeRootTree()`），容器带 `DSW_ALIAS_VARS`
令牌（官方组件读 mirach 色板）。内核树即官方 AppFrame：

### frame（grid，`div[style*="grid-template-columns"]` 是其稳定特征）
- 轨道：`{侧栏}px minmax(0,1fr) {详情}px`，官方 layout store 经让步链求解
  （CENTER_MIN=640，主区不够时自动把详情列关到 0——**注意：这只关列，
  不清"打开详情"偏好**）。mirach 已关闭官方轨道 transition（文字跳动）。
- **sidebarCol**（官方 overflow:hidden）：`renderSlot('sidebar')` →
  **MirachSidebar**（mirach 侧栏外壳：Header 85px → 团队/会话视图 → 官方
  WorkspaceBrowser（搜索/工作区/官方单列表会话）→ 成员/归档 →
  **HiddenSettingsMount**（官方 footer+设置槽屏幕外挂载，供镜像层开设置））。
  组件宽度 = CSS `width:100%`（与列宽同帧，不溢出不晃动）。
- **centerCol**（对话列）：`conversation` 槽 → ChatView（消息流）+ Composer
  （输入框 + 发送按钮 mirach 样式覆盖）+ `conversation.composer.dock` 槽
  （StatsLine 统计行，mirach 覆盖为 10px/10px/2px）；顶栏覆盖层 portal 到此。
- **detailsCol**（详情列，官方"永不卸载"）：`details` 槽 → DetailsPanel
  （轨迹工具行详情）。**托管模式**：`body[data-mirach-details-open]`
  （由 `watchNativeDetails` 对 `ctx.layout.openDetails/closeDetails` 的包装
  驱动）时 `position:fixed` 到右栏区域（top 85 / right 60 / 宽
  `var(--col-right-w)`，z-40），右栏本体是衬底；否则静态 0 宽隐藏。
  官方让步链在主区压窄时自动关列（列 0）但偏好不变——**托管信号用偏好
  （ctx.layout 包装），不能用 data-details-collapsed**。
- **overlayLayer**：`shell.overlay` 槽（官方 shell 级浮层）。
- **DragHandle**：左|主手柄（官方 store 提交）；details 手柄已隐藏（详情
  托管给 mirach 右栏）。

## 5. KernelMirrorHost（镜像层）——官方声明链激活器

- 与 AppLayout 平级（**在 panelRef 之外**，`fixed inset-0` 全窗口），
  常态：`z-index:-1; opacity:0; inert; pointer-events:none`——不可见不可交互。
- **职责（唯一）**：官方 slot 声明是嵌套 effect，父条目渲染才写声明。镜像树
  让 root→sidebar→settings.section 声明链 live，官方设置分区包的 lazy inject
  才会注册。
- 注意：镜像树**不再承载设置弹窗**（历史方案）。弹窗宿主在 body 级 portal
  （见 §6）——镜像树内任何"藏应用副本、放行弹窗"的方案都会撞上两类墙：
  display:contents 槽锚 + visibility 祖先链（visibility 覆盖失效），
  以及镜像容器裁剪/圆角与弹窗拖出边界不可兼得。

## 6. 设置弹窗（body 级 portal，全窗口浮窗）

- 结构：`body > [data-mirach-settings-portal]`（MirachSidebar 经
  **createPortal** 挂载，屏幕外 fixed left:-10000 0×0，常驻）
  → 官方 sidebar.settings 槽 → SettingsRoot（触发按钮 + 打开时的面板）。
- **为什么 portal**：官方面板是 `fixed inset:0`，但只要它的 DOM 在应用树
  （panelRef translateZ(0) 包含块 / sidebarCol overflow / 滚动容器
  maskImage）内部，就会被裁剪或遮罩困住。portal 到 body 后 DOM 脱离应用
  裁剪链：天然全窗口、天然最上层（body 末尾 + z-1000）、可拖出软件边界；
  React 事件仍沿 React 树冒泡，官方交互全部正常。
- 非模态（`dsh-settings-surface` 类，openOfficialSettings 挂上）：
  官方 mask 隐藏（无遮罩）、overlay `pointer-events:none`、面板单独 auto
  ——面板外点击直接落在真实应用上。
- **可拖动**：settings-surface 给面板接 pointer 拖拽（translate 相对居中位
  累积；按钮/输入等交互元素上不启动；rAF 轮询兜底挂载时机）；面板关闭即
  卸载，重开复位居中。
- 入口：**左侧工具栏齿轮**（唯一入口）→ `handleViewChange('settings')` →
  `openOfficialSettings()`；关闭：官方 ✕ / Esc → aria-expanded=false →
  观察器收层（移除浮层类）。

## 7. 关键机制与教训（改布局前必读）

1. **panelRef 的 translateZ(0)** 是所有内部 fixed 的包含块：既是特性
   （弹窗被圆角裁进面板），也是陷阱（fixed 被中间 overflow/mask 祖先
   裁剪）。需要脱离面板裁剪的 UI 一律 portal 到 body。
2. **mask-image 是组级遮罩**：对整棵子树生效，fixed 逃不掉。任何要在
   内部"浮出滚动容器"的 UI，宿主必须在滚动容器之外（设置槽 portal 即
   此原因；侧栏列表底部渐隐的 mask 只属于滚动容器）。
3. **display:contents 槽锚 + visibility:hidden 祖先**：Chromium 下
   visibility 覆盖不生效（子树整体不绘制、不命中）。藏匿用屏幕外定位。
4. **官方让步链**：主区压窄时自动关 details 列（列 0）但偏好不清。"详情是否
   打开"读 ctx.layout 包装信号，"列宽"才读官方 DOM。
5. **拖拽统一 hermes sash 模式**：预览写内联样式（rafCoalesce），松手提交；
   起点+位移不累积；多路收尾（pointerup/cancel/blur/lostpointercapture）；
   `guest-pointer-guard` 防止 webview/iframe 吞手势。
6. **同容器同帧优先**：跨层同步（CSS 变量跨树）有帧差，能用 createPortal
   进目标容器（顶栏覆盖层、设置弹窗）或 CSS 同帧（侧栏 width:100%）就
   不要跨层写变量。
7. **引擎启动缓冲**：`pingGateway(maxTries)` 启动首探 40×750ms≈30s 宽限，
   期间保持 connecting（GatewayConnectingOverlay 缓冲页），宽限耗尽才进
   error（BootFailureOverlay）——sidecar 冷启动不直进主页面。
