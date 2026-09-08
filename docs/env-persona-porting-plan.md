# mirach 环境主人格移植方案（参考 hermes Profile/Bots 架构）

> **状态（2026-09）：阶段 1 已落地** —— `store/agents.ts` ENV_PRIMARY_SEEDS
> 每环境种子主人格（primary: true），命名跟随环境：Mirach / Mirach chat /
> Mirach code / Mirach work / Mirach finance / Mirach write；姓名迁移表
> PRIMARY_NAME_MIGRATIONS 兼容旧命名。阶段 2/3 仍为计划。

> 目标：把 hermes 的 Profile/Bots 架构映射到 mirach 的 6 个环境
> （main 主环境 + chat/code/work/finance/write），做到：
> ① 每个环境有一个**主人格**（该环境的常驻主 agent）；
> ② **主环境里有一个由全部环境主人格组成的团队**（跨环境成员）。
> 配套研究：`docs/hermes-profiles-comms-bots.md`。

## 1. 现状盘点（移植的起点）

| mirach 现有 | 位置 | 对应 hermes 概念 |
|---|---|---|
| `EnvProfile { id, name, cwd, icon, visible, builtIn }` | `store/environments.ts` | ProfileInfo（档案元数据） |
| 切环境 = `dsh_set_env(envId + cwd)` → sidecar 以 `<envId>::<会话id>` 做会话命名空间 + cwd 切换 | environments.ts 头注 / MainPanel 串行下发 | HERMES_HOME 隔离（现阶段用会话命名空间替代目录隔离） |
| `$envEpoch` 环境切换代数（旧环境流式尾巴丢弃） | environments.ts | hermes 的 epoch 失配作废（同一思想，已落地） |
| 每环境智能体团队 `loadAgentsOf(envId)` / `saveAgentsOf(envId)`（ConvItem：name/desc/avatarBg/systemPrompt/model/tools） | `store/agents.ts` | bot 名册（roster）的雏形——**但缺"主人格"指定，且主环境团队不含其他环境的人格** |
| 成员会话路由 | member-panel + engine session mapping | hermes 的 canonical chat / session-owner 路由 |

结论：**会话隔离与 epoch 已就绪；缺的是"主人格"这一层语义和跨环境聚合**。

## 2. 目标模型（hermes 映射）

```
hermes                          mirach 移植后
─────────────────────────────  ─────────────────────────────────────────
Profile（HERMES_HOME+进程）  →  环境 EnvProfile（阶段1-2：会话域；阶段3：目录+进程）
profile.yaml / SOUL.md      →  环境主人格（ConvItem.primary + systemPrompt，SOUL.md 文件化）
profiles.list 名册          →  主环境团队 = 本环境成员 + 各环境主人格（跨环境成员行）
bot_relay 跨网关投递        →  跨环境会话路由（阶段1-2 单 sidecar 内路由即可）
ui_meta（CAS 修订）         →  成员展示状态（分组/颜色/置顶，localStorage → 目录文件）
$activeGatewayProfile+epoch →  $envEpoch（已有）+ 阶段3 的 (connectionId, env) 路由
```

## 3. 核心语义：主人格（Primary Persona）

1. **数据模型**（`store/agents.ts` + `store/environments.ts`）：
   - `ConvItem` 增加 `primary?: boolean`；或 `EnvProfile` 增加
     `primaryAgentId?: string`。推荐后者（环境是主人格的宿主，一个环境
     恒有一个主人格；删除主人格 = 换人，不会出现"无主"环境）。
   - 每个环境种子一个主人格：`teamSeedFor(envId)` 里追加，如
     chat→"对话总管"、code→"代码总管"、work→"工作总管"…，
     systemPrompt 写明该环境的职责边界与工作区路径。
2. **主人格 = 环境的门面**：侧栏团队视图里主人格排第一并带标记；
   新会话默认 persona = 当前环境主人格的 systemPrompt
   （现在默认成员"奎木狼"的机制沿用，改为按环境解析）。
3. **SOUL.md 化（阶段 2）**：主人格的 systemPrompt 落地为
   `profiles/<envId>/SOUL.md` 文件（hermes 同名机制），设置 → 智能体
   可编辑；localStorage 迁移到目录文件（Tauri fs）。

## 4. 主环境的"全部环境主人格团队"

- **聚合名册**：主环境的成员列表 = `loadAgentsOf('main')` ⊕ 各环境的
  主人格行。跨环境成员行带 `route: { envId }`（对应 hermes RosterRow.route
  的 ProfileRoute：成员不是本地的，来自另一个"连接"——这里是另一个环境）。
- **路由语义**：点击跨环境成员 → 打开该成员的会话 =
  `envId 环境下、以该环境主人格为 persona 的会话`。现阶段单 sidecar：
  切 `dsh_set_env(env)` + 选 persona；展示上仍留在主环境视图
  （hermes 的 canonical chat 模式：成员的"永远聊天"按归属解析，不存指针）。
- **消息回写**：成员线程按 `ownerKey = envId::personaId` 归档
  （对应 hermes 的 session-owner 路由），主环境团队视图读取时按 ownerKey
  聚合 last_active/preview。
- **状态点**：各环境主人格的状态（进行中/需输入/空闲）从引擎会话状态
  聚合——hermes 的 worker_session/last_active 同款。

## 5. 分阶段实施

### 阶段 1：人格与团队（纯前端，1-2 天量级）
1. `EnvProfile.primaryAgentId` + 各环境种子主人格（agents.ts）。
2. 主环境团队聚合名册（跨环境成员行 + ownerKey 路由）。
3. 侧栏团队视图：主人格置顶标记 + 跨环境行来源徽标（env 图标）。
4. 新会话默认 persona = 当前环境主人格。

### 阶段 2：目录隔离（数据落地，替代 localStorage）
1. `profiles/<envId>/`：`env.json`（EnvProfile）、`SOUL.md`（主人格）、
   `agents.json`（团队）、会话历史文件。
2. 启动迁移：localStorage → 目录（一次性）。
3. 收益：hermes 式"档案可搬迁/可备份"，为多后端做准备。

### 阶段 3：进程隔离（hermes 后端池，按需）
1. per-env sidecar：Tauri 侧 spawn（pin 数据目录 env），端口宣告 + 注册表。
2. 通讯路由升级：(connectionId, env) 二元组；REST `?env=`；
   WS 网关注册表（primary + secondary，keep-set = 有活跃会话的环境）。
3. 治理：spawn 上限、空闲回收、活跃环境豁免（hermes pool-eviction/scale_to_zero）。
4. 一致性：env epoch（已有）扩展为跨后端失配作废；成员展示状态加 CAS。

## 6. 风险与取舍

- **阶段 3 的收益边界**：mirach 单 sidecar 的会话命名空间隔离已满足
  "环境间不串"，进程隔离只在需要**独立凭据/独立引擎配置/并行长任务**
  时才有价值——hermes 是因为 profile 携带独立凭据与工具链才必须一进程一档。
- **跨环境成员的写语义**：主环境团队里与"代码总管"对话 = 代码环境会话；
  要明确 UI 提示归属（hermes 用 route/connectionLabel 解决，mirach 用 env 图标）。
- **删除/改名联动**：环境删除时其主人格行从主环境名册消失（hermes 的
  profile-delete-routing 同款问题，注册表是权威）。
