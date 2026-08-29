# 隔离设计调研：Hermes（旧引擎）vs Mirach 现状

> 调研对象：`D:\hermes-agent-main`（Hermes 引擎，Python）的多用户/多环境隔离实现，
> 对照 Mirach（Tauri + sidecar + dsh 引擎）现状，给出借鉴清单。
> 详细源码引用见调研过程（hermes_constants.py / profiles.py / gateway/session.py /
> session_context.py / runtime_cwd.py / cron/jobs.py / memory_tool.py / system_prompt.py）。

## 一、Hermes 的隔离模型（一句话）

**没有用户表/环境表**，而是三层："目录即环境（profile）" + "逻辑路由键（session_key）" + "ContextVar 会话上下文"：

1. **目录即环境**：每个 profile 是一个完整自包含的 HOME（`~/.hermes/profiles/<name>/`），
   内含 config/.env/SOUL.md/memories/sessions/state.db/skills/cron/plans/workspace——
   所有状态（凭据/记忆/会话/定时任务）都在它下面，物理隔离。
2. **session_key 路由**：`agent:<namespace>:<platform>:<chat_type>:[scope]:<chat_id>:<thread_id>[:user_id]`
   单一事实源函数生成；DM 按发送者隔离、群按人隔离、thread 共享——规则收敛一处。
3. **ContextVar 运行时绑定**：并发消息任务用 contextvars 绑定会话身份（不用 os.environ），
   显式处理 asyncio 继承泄漏与子进程 env 桥 strip。

## 二、Hermes 值得借鉴的设计点（17 条精选）

| # | 设计 | Mirach 现状 | 借鉴建议 |
|---|---|---|---|
| 1 | profile = 完整 HOME（含记忆/凭据/定时任务） | 会话/成员有 env 分片；记忆/凭据/任务未分 | 环境 = 目录方案（Mirach Home per env）中长期最优 |
| 2 | session_key 单一事实源函数 | envId::sessionId 映射 ✓ 已收敛 | 保持 |
| 3 | session_key 只做路由不进文件名；文件名 session_id 单独校验 | 引擎持久化按 cwd 编码 ✓ | 保持 |
| 4 | ContextVar 会话身份（防并发串号） | JS 单线程事件循环，无此并发问题 | 不适用 |
| 5 | workspace_key = git_repo_root 优先于 cwd | Mirach cwd 即工作区 | 增强项：git 仓库根优先 |
| 6 | cwd 解析单点 + 读写锁串行化覆盖 | dsh_set_env 单点 ✓ | 保持 |
| 7 | **cron 存储强制 per-profile**（注释明言共享根会打破隔离） | cron 全局单表 ❌ | **补齐**：任务表加 envId |
| 8 | cron job 声明无状态 + 清空会话身份，防结果投错聊天 | 不适用（Mirach cron 前端展示） | 低优先 |
| 9 | **记忆冻结快照**：会话内只读保 prefix cache | 记忆未接入 | 接入记忆时采用 |
| 10 | MEMORY.md（项目事实）与 USER.md（用户画像）分文件 | — | 接入记忆时采用 |
| 11 | 授权 = allowlist + pairing 审批 | 不适用（单机应用） | 不适用 |
| 12 | IM 身份规范化防拆会话 | 不适用 | — |
| 13 | **profile 可克隆并发布为发行包**（成员模板分发） | 成员手填 | **高价值**：团队成员模板导入/导出 |
| 14 | **profile 当 kanban 队员**（按 description 路由子任务） | 成员仅展示 | 中期：成员接引擎任务分派 |
| 15 | 多路复用网关（单进程多 profile） | 单环境单引擎进程（更简单更稳） | 不必借鉴 |
| 16 | **整条 system prompt 持久化到会话行**（resume/压缩沿用） | persona per env（重启生效） | 增强：会话级 persona 快照 |
| 17 | **web 层不存业务状态**（localStorage 只存 UI 偏好） | Mirach 会话/成员在 localStorage ⚠️ | 中期：迁到引擎/文件（换机不丢） |

## 三、Mirach 现状隔离矩阵

| 维度 | Hermes | Mirach 现状 | 差距 |
|---|---|---|---|
| 会话 | session_key + state.db | env 分片 localStorage + 引擎 cwd 分组持久化 | ✅ 等效 |
| 成员 | profile 当队员 | mirach.agents.v1.<envId> 分片（本轮） | ✅ 等效 |
| 工作区 | sessions.cwd/git_repo_root + ContextVar 单点 | dsh_set_env cwd（~ 展开本轮补） | ✅ 等效 |
| 记忆 | memories/MEMORY.md + USER.md，冻结快照注入 | 未接入（mcp-memory 未挂载） | ❌ 待做 |
| 定时任务 | cron/jobs.json **per-profile** | Rust 全局单表 | ❌ 待加 envId |
| persona | per-profile SOUL.md + 会话行持久化 | set_env.systemPrompt（env 级） | 增强：会话级快照 |
| 凭据 | per-profile .env/.credentials | 全局 providerConfig | 中期：随环境分片 |

## 四、结论

Mirach 的 env 分片思路与 Hermes 的 profile 隔离**同构**（Hermes 是目录级、Mirach 是
localStorage key + 引擎 cwd 级）。近期补齐优先级：

1. **定时任务加 envId**（借鉴 #7，防任务跨环境误执行）
2. **记忆接入 + per-env root**（借鉴 #9/#10，mcp-memory 或 MEMORY.md 模式）
3. **会话级 persona 快照**（借鉴 #16，resume 稳定）
4. **成员模板导入/导出**（借鉴 #13，配合 dsh-tavern 角色卡生态）
5. 长期：业务数据迁出 localStorage（借鉴 #17）

## 五、官方 0.1.1 消息定位器/轨迹/JobPanel 的移植评估（2026-08-30）

### 结论：不是组件移植，是架构级升级

官方 0.1.1 的「消息定位器」实为 ConversationLocationIndex（475 行）——
Turn/Step 时间线索引 + 事件到 Location 的解析层，与 assembler（797 行）、
assembly（243 行）、definition/event/view registry 共同构成一套**事件溯源装配体系**
（依赖 client-runtime 的 projection 座、api-session-controller、contract 类型 11 个文件）。

Mirach 现状：LiveChatMessage 数组 + engineId 映射（扁平模型）。直接「复制组件」不可行——
需要先移植投影/装配层（估计 2-3 周工作量级），才有定位器/轨迹/JobPanel 的挂载点。

### 分阶段路线

| 阶段 | 内容 | 产出 |
|---|---|---|
| 1 | 接引擎事件溯源：Mirach store 增加按 seq 的 SessionEvent 日志（实时事件 + 历史回放统一入口） | 定位器/轨迹/JobPanel 共用的数据底座 |
| 2 | 移植 ConversationLocationIndex（可直译 475 行，无外部依赖） | Turn/Step 时间线 + 事件定位 |
| 3 | 轨迹视图按 timeline 渲染（对齐官方 TrajectoryView 的分组/状态标记） | 轨迹 UI 对齐 |
| 4 | JobPanel（ui-jobs）+ 消息定位器 UI（按 Turn/Step 跳转） | UI 对齐 |

### 环境切换方案深度对比（回应「等效不等于更好」）

Hermes 的「目录即环境（profile）」**在架构上优于** Mirach 的 localStorage 分片 + 引擎 cwd 模型：

| 维度 | Hermes profile | Mirach 现状 | 判定 |
|---|---|---|---|
| 数据主权 | 全部状态在 profile 目录，换机/备份/迁移 = 拷目录 | 会话/成员在 localStorage（引擎侧会话在 dsh home） | Hermes 优——业务数据应逐步迁出浏览器存储 |
| 记忆/凭据/任务 | 随 profile 天然隔离 | 每类各自实现分片（遗漏风险） | Hermes 优——一个边界管所有状态 |
| 人设 | per-profile SOUL.md + 会话行持久化 | per-env persona（重启生效） | Hermes 优——SOUL.md 模式值得直接采用 |
| 引擎侧 | 引擎本身读 HERMES_HOME | dsh 引擎读 DSH_SESSION_ROOT/cwd | 中性（dsh 按目录分组已等效） |

**建议的收敛路径**（大版本）：Mirach Home 目录 = `%USERPROFILE%\.mirach\<env>\`，
把会话/成员/记忆/任务全部落在环境目录（引擎 DSH_SESSION_ROOT 已按 env 分 ✓，
前端业务数据逐步跟随），localStorage 只留 UI 偏好——即采纳 Hermes 的「目录即环境」。

**但当前优先级判断**：画廊/成员/统计/插件移植等可见功能刚落地，架构迁移建议在
功能面稳定后单独立项（涉及 sessions/agents/usage/projects 全部 store 的迁移与兼容）。

## 六、官方 0.1.1-rc.2 复制可行性最终验证（2026-08-30）

1. npm 全套 0.1.1-rc.2 bundle 已装（196 包 @deepseek-ai/*）——但**内部包未单独发布**
   （dsh-api-session-controller/dsh-compact 等 404）：官方 UI 体系无法纯 npm 组装，
   官方 web 是 bundle 自包含分发。
2. rc.2 的 web 启动存在回归（已两次复现）：启动自举写 flat 布局会话文件，
   随后 workspace 校验拒绝同一文件（unsupported flat-file layout）——与
   DSH_SESSION_ROOT 无关。等官方 rc.3 修复后再走「内嵌官方 web UI」路线。
3. 当前结论：Mirach 对话区维持自制 UI + 逐功能对齐官方（StatsLine 已完成，
   轨迹/JobPanel/定位器按 ui-trajectory/ui-jobs 源码对齐——0.1.1 的定位器
   依赖的新装配层等官方修复后整体评估）。

## 七、mirach-envs 插件具体实施方案（2026-08-30）

### 结论

多环境做成 **cordis 插件并入引擎**：隔离由引擎侧强制执行（每环境一个自包含
目录 = Hermes profile 式），前端只消费插件的 RPC/Web 路由，删除 localStorage
分片代码。

### 官方连接核心参考（web 版连接方式）

- **host-webserver** = 纯 HTTP/WS 载体（node:http + gzip + 命名路由注册 +
  WS upgrade 座），**不含业务**；session controller、API gateway 等服务插件
  通过 `register(route)` / `registerUpgrade(route)` 把 API/WS 挂进同一端口。
- **client-connection**（浏览器侧）= 带 MRU 代际生命周期与指数退避重连的
  RPC transport：握手拿 host 事实（home 路径），之后逐请求 RPC（zod 校验），
  事件经同代际通道推送。
- Mirach 现状对照：sidecar（stdio JSON-RPC）≈ 无 webserver 的同型 RPC 面；
  **遗漏参考**：官方连接层含代际重连、请求信任栅（api-request-trust）、
  browser-auth、回环主机名校验——Mirach 的 Tauri invoke 通道天然免这些，
  但若未来直连 webserver 需要补 browser-auth 栅。

### mirach-envs 插件结构

```
mirach-envs/
├── package.json          # name: mirach-envs; dsh.bundle.patch: ./cordis.patch.yml
├── cordis.patch.yml      # - id: mirach-envs / - insert: - name: mirach-envs
└── src/
    ├── index.ts          # Plugin 导出：envs 服务（list/active/switch/members）
    ├── service.ts        # EnvsService：环境目录管理 + 激活态重配
    └── routes.ts         # host-webserver 路由：/api/envs（GET 列表/POST 切换）
```

### cordis.patch.yml

```yaml
- id: mirach-envs
  name: mirach-envs
  config:
    root: !!js "process.env.DSH_ENVS_ROOT ?? require('os').homedir() + '/.mirach/environments'"
- insert:
    - name: mirach-envs
```

### 环境目录布局（Hermes profile 式，每环境自包含）

```
~/.mirach/environments/<envId>/
├── env.yaml             # 名称/描述/模型选择/成员注册表（人设+工具）
├── sessions/            # 该环境独立会话持久化（替代 sessionRoot 切换）
├── members/             # 成员注册表（奎木狼/鲁班/…，含 systemPrompt）
├── memories/            # MEMORY.md + USER.md（冻结快照注入，借鉴 Hermes）
├── storage/             # message-feedback 等 storage 后端
└── jobs.json            # 该环境定时任务（隔离 cron）
```

### EnvsService 职责（切换 = 重配三处 root）

switch(id) 执行：
1. session-persistence-jsonl 的 root 重配 → 会话日志/历史切到该环境目录
2. storage-json 的 root 重配 → 反馈/附件存储隔离
3. 成员注册表重载 → ask_user_question 反馈与成员 RPC 使用该环境成员
（live 重配优先走 cordis Fiber 重载；跨插件 root 重配不支持的行用 Fiber
 restart 仲裁——插件内实现，前端无感知。）

### Mirach 前端对接（替换 localStorage 分片）

- 删除 mirach.sessions.v1.<envId> / mirach.agents.v1.<envId> 分片与
  setSessionsEnv/setAgentsEnv——改调 /api/envs RPC
- 会话列表/成员列表/统计来源 = 当前激活环境目录
- 多窗口天然一致（状态在引擎侧，非各窗口 localStorage）

### 结果

- 隔离引擎侧强制执行（目录边界），前端分片代码全部退役
- 换机/备份 = 拷贝 ~/.mirach/environments/<envId>/
- 官方插件生态（记忆/任务/审批等 per-env root 类）由插件统一管理，永不遗漏

## 八、官方 web 连接层清单 vs Mirach 连接层（2026-08-30）

### 官方 web 连接层连接了什么

1. **载体**：host-webserver（node:http，exact/prefix 路由 + WS upgrade 座，零业务）
2. **浏览器侧 transport**：client-connection（zod 校验 RPC 协议 ClientRequest/ServerResponse、
   代际生命周期、指数退避重连、api-request-trust 浏览器信任栅、browser-auth）
3. **host 侧分发**：api-gateway（typert-gateway）把 RPC 分发到各服务插件注册的面
4. **业务 RPC 面**（服务插件注册）：session controller（事件流/发送/历史）、jobs、
   deliverables、attachments（图片内容寻址）、user-questions、feedback、workflow、
   cordis 自省（tool-cordis/web-cordis：插件清单与配置读写）
5. **client-runtime**：projection 座（tokenUsage/sessionStats/contextPressure）+
   snapshot 选择器 + stores——StatsLine/ContextMeter/定位器/轨迹/JobPanel 全部吃它

### Mirach 连接层缺的（按补齐顺序）

| # | 缺口 | 用途 | 补法 |
|---|---|---|---|
| 1 | **原始 SessionEvent 流** | 装配层/定位器/轨迹的数据底座（官方逐 seq 事件流） | sidecar adapter 转发原始事件（现在转换后丢弃）|
| 2 | **contextPressure projection** | ContextMeter 环 + 压缩触发显示 | token-meter 投影随 usage 事件透出 |
| 3 | jobs RPC 面 | 引擎级任务（补 Rust cron 之外的会话内 jobs UI）| jobs-local 已挂，加 RPC 透传 |
| 4 | attachments RPC | 图片发送/预览 | attachment-local 已挂，加 RPC 透传 |
| 5 | session-query 面 | 会话全文检索 | query-sqlite 已挂（:memory:），开 first-search + 落盘 path |
| 6 | cordis 自省面 | 插件清单/配置 UI | tool-cordis 已挂，加 RPC 透传 |
| 7 | approval/auth 栅 | 审批弹窗闭环（ask 模式时） | 复用 user-questions 通道 |

### dsh 原生风格对话区直接用官方装配层——可行，前置是 #1+#2

dsh 风格对话区作为官方装配层的宿主试点：原始事件流接入 → ConversationLocationIndex/
assembler 构建 timeline/projection → dsh 风格渲染层吃装配输出（消息块/定位条/轨迹入口）。
default/minimal 两种风格不受影响。
## 八、官方 web 连接层清单 vs Mirach 连接层（2026-08-30）

### 官方 web 连接层连接了什么

1. **载体**：host-webserver（node:http，exact/prefix 路由 + WS upgrade 座，零业务）
2. **浏览器侧 transport**：client-connection（zod 校验 RPC 协议、代际生命周期、退避重连、api-request-trust 浏览器信任栅、browser-auth）
3. **host 侧分发**：api-gateway 把 RPC 分发到各服务插件注册的面
4. **业务 RPC 面**：session controller（事件流/发送/历史）、jobs、deliverables、attachments、user-questions、feedback、workflow、cordis 自省（tool-cordis/web-cordis）
5. **client-runtime**：projection 座（tokenUsage/sessionStats/contextPressure）+ snapshot 选择器——StatsLine/ContextMeter/定位器/轨迹/JobPanel 全部吃它

### Mirach 连接层缺的（按补齐顺序）

| # | 缺口 | 补法 |
|---|---|---|
| 1 | **原始 SessionEvent 流** | sidecar adapter 转发原始事件（✅ 本轮已补 raw_session_event）|
| 2 | contextPressure projection | token-meter 投影透出 |
| 3 | jobs RPC 面 | jobs-local 已挂，加 RPC 透传 |
| 4 | attachments RPC | attachment-local 已挂，加透传 |
| 5 | session-query 面 | 开 first-search + 落盘 path |
| 6 | cordis 自省面 | tool-cordis 已挂，加透传 |
| 7 | approval/auth 栅 | 复用 user-questions 通道 |

### dsh 原生风格对话区直接用官方装配层——可行，前置是 #1+#2

dsh 风格对话区作为装配层宿主试点：事件流接入 → ConversationLocationIndex/assembler
构建 timeline/projection → dsh 风格渲染层吃装配输出。default/minimal 不受影响。