# 官方内核位置与数据面速查（dsh 0.1.2-alpha.4 实测）

> 2026-09-05 全面调研结论。目的：mirach 侧接官方数据时不用来回翻代码。
> 官方源码零改动原则下的只读调查记录。官方升级后如有出入，以源码为准。

## 一、官方包在仓库的位置

| 关注点 | 位置（`packages/client/` 下） | 说明 |
|---|---|---|
| 三栏壳（sidebar/中间/details 网格） | `ui-layout/src/client/AppFrame.tsx` | 注册进 `root` 槽；`data-sidebar-collapsed` 属性在 frame 根元素上 |
| 折叠 rail（56px 图标列） | `ui-sidebar/src/client/SidebarRoot.tsx` + `.module.css` | 没有独立组件，就是 SidebarRoot 的 collapsed 形态 |
| 会话/工作区浏览区 | `ui-workspace/src/client/rows/WorkspaceBrowser.tsx` | 填 `sidebar.workspaces` 槽，**可脱离官方侧栏单独渲染**（本体透明，背景是侧栏列画的） |
| 官方"新任务"行为 | `ui-workspace/src/client/navigation.ts` → `uiWorkspace.startSession()` | cordis 服务 `ctx.uiWorkspace`，继承当前工作区 → connectWorkspace（空白复用/新建）→ open |
| 官方输入条 | `ui-conversation/src/client/skeleton/InputBar.tsx` | 卡片锚点 `data-composer-card`；工具行：左 = + 号（`aria-haspopup="listbox"` 的 button，唯一）→ 权限（`PermissionSelect`）→ `conversation.input.left` 槽；右 = `conversation.input.right` 槽 → 模型槽 → ContextMeter → 发送 |
| 官方发送按钮空态 | InputBar.tsx `primaryStops`/`disabled={...empty...}` | 空输入时按钮 disabled（覆盖层方案的依据） |
| 槽位注册表 | `ui-renderer/src/client/registry.ts` + `scoped-slots.tsx` | `ctx.slots.register/inject/renderSlot`；`entriesOfSlot` = 影子胜者 |
| 槽位核心（校验/台账） | `ui-slots/src/index.ts`（`SlotCore`） | register 语义：同 cell 同 priority 抛错；list 按 id+priority 去重 |
| 会话服务 | `api/session-controller/src/`（list.ts/service.ts/types.ts） | `ctx.sessions`；`list` observable 见下文数据面 |
| 主题令牌 | `ui-theme/src/client/styles.ts` | `base.css?inline` 等 6 个内联导入；`--dsw-*` 令牌源头 |

构建产物（mirach 实际消费）：`packages/<group>/<pkg>/lib/client.js`（exports `"./client"`）。
lib 是 gitignore 的本地构建产物，**官方同步 src 后必须 `npm run build:lib`**，否则跑旧构建
（mirach 的 `scripts/check-dsh-lib-fresh.mjs` + vite 插件会拦截）。

## 二、官方槽位树（渲染骨架）

```
root（single, AppFrame）
├─ sidebar（single, SidebarRoot）
│   └─ sidebar.workspaces（single, WorkspaceBrowser）   ← 会话/工作区列表
│   └─ sidebar.settings / sidebar.footer.action
├─ conversation（single, ConversationRoot）
│   └─ conversation.composer（chain）
│       └─ conversation.composer.bar（single, InputBar, session-maybe）
│           ├─ conversation.input.left  （list, session）  ← mirach 注入"终端"
│           ├─ conversation.input.right （list, session）  ← mirach 注入听写/唤醒/朗读
│           ├─ conversation.input.plan / .model（single, session）
│           └─ conversation.composer.dock（list，官方待办 TodoDock 在此）
│   └─ conversation.session.header.actions（list）← 官方 ui-jobs 的任务按钮
└─ details（single）
```

要点：
- `conversation.input.left/right` 是 **list 槽、session scope**——mirach 控件必须经
  `ctx.slots.inject(name, cb)` + `ctx.slots.register` 注册（见 `dsh-kernel/composer-extras.tsx`）。
- `sidebar.workspaces` 是 **root scope 单槽**——可在 mirach 自己的 React 树里
  `renderSlot("sidebar.workspaces", { wide: true, expandSidebar: () => {} })` 渲染
  （见 `dsh-kernel/boot.ts` 的 `nativeWorkspaceBrowser()`；LeftSidebar "所有会话" tab 在用）。

## 三、官方数据面（活动/状态数据从哪读）

### 1. `ctx.sessions.list` observable（官方 list 快照）

经 `nativeSessionsList()`（boot.ts）拿到的 `{ getSnapshot, subscribe }`，快照字段
（types.ts + service.ts 实测）：

| 字段 | 形态 | 用途 |
|---|---|---|
| `current` | SessionId \| undefined | 官方当前会话（WorkspaceBrowser 点击后变 → mirach 反向同步） |
| `byId` | Record<id, SessionSummary> | 摘要：blank/updatedAt/running/title 等 |
| `jobsBySession` | Record<dshId, SessionJob[]> | **后台任务 /bg**。SessionJob：`{ id, kind, label, status: 'running'\|'stopping'\|'completed'\|'killed'\|'failed', detail?, startedAt, finishedAt? }` |
| `subagentsByParent` | Record<dshId, …>（形态演进中） | **子代理**，键 = 父会话 dsh id |

官方 ui-jobs 的 JobListAction 就是读 `jobsBySession[sessionId]`（插件零 RPC 零状态）。

### 2. 会话投影（`projections.faceOf(key)`）

`nativeGoalProjection(dshId)`（boot.ts）= `sessions.binding(dshId).session.projections.faceOf('goal')`，
返回 `{ getSnapshot, subscribe }`，快照 `{ goal: { id, revision, objective, phase, maxGoalRounds } | null }`。

实测全仓库 `faceOf('<key>')` 调用只有三个 key：

| key | 注册方 | 消费方 |
|---|---|---|
| `permissions` | ui-permission-presets | 输入条权限 chip |
| `modelSelection` | ui-model-selection | 模型 seat |
| `goal` | ui-goal | GoalBar |

**注意**：待办（todos）不是投影——官方待办数据在会话 input machine 内部，
经 `conversation.composer.dock` 槽由官方 TodoDock 渲染，外部拿不到独立快照。

### 3. 官方"活动"结论（对照 mirach StatusWindow）

| StatusWindow 分项 | 官方数据面 | 官方展示位置 |
|---|---|---|
| 后台任务 | `sessions.list → jobsBySession` | ui-jobs：会话头按钮 + 弹出列表 |
| 子代理 | `sessions.list → subagentsByParent` | ui-subagent：会话目录/@引用 |
| 目标 | `faceOf('goal')` | ui-goal：输入条上方 GoalBar |
| 待办 | 会话 machine 内部（外部不可取） | `conversation.composer.dock` TodoDock |
| 发送队列 | 官方无独立 UI（input machine 内部） | — |
| 终端 | **官方完全没有**（纯 web 端） | — |

→ StatusWindow 是官方没有的**聚合形态**，数据源已接官方：
`status-stack/useOfficialActivity.ts`（jobs/subagents/goal 读官方，与 mirach relay store 取 max）。

## 四、mirach 侧接官方的既有出口（boot.ts 导出一览）

| 函数 | 用途 |
|---|---|
| `nativeRootTree()` | 整棵官方根树（MainPanel 唯一对话区） |
| `nativeRenderReady()` | 渲染就绪检查（renderSlot + sessions 存在） |
| `nativeCollapsePanels()` | 官方三栏压到只剩中间列（setSidebar/setDetails(0)） |
| `nativeOpenSession(dshId)` | 官方 current 切到目标 dsh 会话 |
| `nativeSessions()` | `ctx.sessions` 原始服务 |
| `nativeSessionsList()` | list observable（jobs/subagents/current，见上文） |
| `nativeGoalProjection(dshId)` | goal 投影面 |
| `nativeOfficialStartSession()` | 官方"新任务"（uiWorkspace.startSession） |
| `nativeWorkspaceBrowser()` | 官方工作区/会话列表 ReactNode（跨树渲染） |
| `nativeLocaleTranslate(ns)` | 官方词典 t 函数（ns 如 'conversation'/'chat'/'goal'） |
| `nativeSettingsSections()` / `nativeSlotEntries(key)` | 设置分区/任意槽位条目（winners 形态） |

## 五、官方的可靠性哲学（mirach 侧行为对齐依据）

官方**从不静默降级，全部 fail-loud**：

- 槽位渲染器启动检查直接 throw（`renderSlot('root') before any registration`）。
- locale 面缺失抛 `SlotAssemblyError`（"no fallback"）。
- 客户端 bundle 纯度门禁直接构建失败（跨插件值导入禁止）。
- 依赖就绪靠声明式 inject 依赖图（没就绪的插件根本不 apply），不是事后兜底。

mirach 对齐原则（2026-09-05 全面收紧后）：
1. 官方树没就绪 → 显示"正在连接"加载占位，**绝不回退到自建对话区**（已实施）。
2. **官方已有的能力一律只走官方实现，不写第二套**。官方入口不可用（内核未
   boot）时 fail-loud：显式提示"内核未就绪"（如新建任务按钮 `pushToast`），
   **不静默回退 mirach 自有新建**。已删除的第二实现：
   - 主对话区 SessionTabs 多标签切换会话（官方无此功能 + 多余，连同
     `open-tabs` store、`$showSessionTabs` 一起删除）；
   - LeftSidebar 官方列表就绪前的"项目"折叠卡 / 搜索框 / 置顶卡（由官方
     WorkspaceBrowser 的搜索 + 工作区 + 会话单列取代；内核未就绪时仅显示
     mirach 简表兜底，无重复入口）；
   - mirach 模型菜单 / 用量悬停面板等与官方 seat/ContextMeter 双源并存的
     路径（ChatToolButton 工具菜单已剔除"会话标签页"开关项）。
3. **允许保留的兜底（白名单，逐条有因）**：
   - `useOfficialActivity`：官方投影与 mirach relay store 取 max——官方没有
     队列/终端概念，mirach 自有数据源必须保留，取 max 防角标漏报（文档认可
     的过渡态，逐步收敛官方为唯一源）；
   - Composer 发送链 "内核优先 + sidecar 管道兜底"：官方内核 boot 失败时
     消息仍可达引擎（架构性双通道，非 UI 第二实现）；
   - `VITE_MOCK=1` 演示模式的数据源：官方无 mock 概念，属 mirach 自有演示
     功能，非运行时降级；
   - LeftSidebar 简表兜底仅在 `officialBrowserReady === false`（内核未 boot）
     时出现，是加载占位语义，不是功能替换。
4. 发现新的"失败悄悄换一套"行为 → 按官方哲学处理：要么让依赖必然就绪并
   fail-loud，要么删除第二套实现。

## 六、已知坑（踩过的，别再踩）

1. **lib 产物旧于 src**：官方同步只更新 src；必须重跑 `npm run build:lib`。
   守卫：`scripts/check-dsh-lib-fresh.mjs`（vite 插件自动拦截）。
2. **`@tsdown/css` 缺失**：官方 lockfile 里是 tsdown 的 optional peer，pnpm install
   时 auto-install-peers 会补；构建 client face 报 "CSS file ... @tsdown/css is not
   installed" 就是它。
3. **根 tsdown workspace 成员**：官方根配置 workspace 模式会把仓库根自己当成员，
   根目录需要 `lib/types/{index,invariant,startup}.js` 与 `src/index.ts` 占位
   （已放好并加入 `.git/info/exclude`，勿删）。
4. **检查脚本被 vite 导入必须零副作用**：参数解析放 main()，CLI 判定用
   `fileURLToPath(import.meta.url)`；`import.meta.pathname` 在 Node 上不存在。
5. **CSS 类名哈希会变**：对官方产物写 CSS 覆盖时禁止 `[class*="_add"]` 这类哈希
   依赖，用结构锚点（`data-composer-card`、`aria-haspopup`、`data-mirach-*`）。
6. **槽位注册冲突**：同一 cell 同 priority 的第二次 register 会抛错；mirach 注入
   一律走 `slots.inject(声明名, cb)` 等声明落地后再 register。
7. **profile 插件包名不同步会导致引擎整机起不来**：`dsh-muv-engine@0.2.1` import
   旧包名 `muv-table`，而安装的是改名后的 `dsh-muv-table` → cordis 插件树加载
   失败 → dsh 引擎进程退出 → 3212 web 面不监听 → 前端"内核一直连接不上"。
   修复：profile 升 `dsh-muv-engine@^0.3.1` + 在 node_modules 建 `muv-table →
   dsh-muv-table` junction（上游 import 未跟改名）。社区插件升级后必须整树冒烟。
8. **条件 return 不能放在 hooks 之前**：`ResizeHandles` 的
   `if (MOCK || maximized) return null` 写在 useState/useEffect 之前——悬浮态
   hooks=0、最大化翻转后 hooks>0 → "Rendered fewer hooks than expected" →
   整树白屏（点最大化即废）。规则：**hooks 一律组件顶部无条件调用，分支只放
   渲染段**。React 渲染崩溃的组件名可用 error boundary 的
   `info.componentStack` 拿到（App.tsx CrashBoundary）。
9. **官方 corner-shape 全局 superellipse**：ui-theme `corner-shape.css` 用
   `* { corner-shape: superellipse(1.5) }` 把全页圆角变方圆；官方组件按 spec
   对全圆形态配对 `corner-shape: round`，mirach 组件没有 → 窗口圆点/头像/胶囊
   变形。修复：`#root` 子树 `corner-shape: round`（index.css），`.dsh-native-area`
   内恢复官方 superellipse。
10. **grid 列不能 display:none**：AppFrame 三列是 grid item，首列 `display:none`
    会让 center/details 整体左移一位（center 掉进 0px 轨道、details 吃掉 1fr）。
    隐藏 rail 只能压轨道宽度 + 隐藏列内子元素。
