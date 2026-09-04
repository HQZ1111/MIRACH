# Mirach（奎木狼）— DSH 桌面版交接文档

## 第二十三批：设置页接入官方 settings.section 槽位 + 样式适配层

- 设置侧栏动态读取 `ctx.slots.entries("settings.section")`——官方 5 个内置分区
  （general/models/plugins/agent-presets/tavern-manager）+ 任何第三方插件注册的
  分区自动出现在设置侧栏「官方 / 插件」分组下。
- renderContent 优先匹配官方分区：走 `ctx.slots.renderSlot` 正确绑定 locale/inject
  席位，失败回退直调组件；宿主容器补齐 DSW_ALIAS_VARS + CSS 适配层
  （按钮/输入框/表格/字体对齐 mirach 视觉）。
- 官方更新设置面板内容时重启自动对齐（slot 系统随版本更新）。
- 修复 nativeTavernSection 的 getSlots 不存在 bug → 改用 entries API。
- tsc 通过；sidecar 变更需重启应用。

---

## 1. 项目是什么

Mirach = DeepSeek Harness (dsh) 引擎的桌面前端。Tauri 2 + React 19 自定义 UI + sidecar（Node stdio JSON-RPC）+ 官方引擎核心。

**仓库**：
- mirach 应用：Gitee `HANQINGZHOU/mirach` + GitHub `HQZ1111/MIRACH`（双远程）
- 整体工作区（含官方 dsh 源码 + mirach 子模块）：Gitee `HANQINGZHOU/mirach-harness`（仅 Gitee，GitHub 推送已取消）
- 工作目录：`G:\deepseek-harness-master\apps\mirach`（官方 0.1.2-alpha.4 workspace 成员）

**官方 dsh 引擎**：npm `@deepseek-ai/dsh`，当前全局安装 **0.1.2-alpha.5**（alpha 通道）。更新 = `npm i -g @deepseek-ai/dsh@alpha` 一条命令 + 重启。

---

## 2. 架构

```
Tauri 壳（Rust）
 ├─ WebView（mirach React 前端，端口 1420 dev）
 │   └─ src/dsh-kernel/boot.ts → 内核加载官方 client 栈（KERNEL_PLUGINS 41 bundle）+ dsh-tavern
 ├─ src-tauri（Rust 中继：sidecar 管理、文件操作、git、手机接入 web_host）
 └─ agent-sidecar（Node 进程，stdin/stdout JSON-RPC）
      ├─ 引擎启动：dsh.cmd --profile mirach（npm 全局安装的 dsh CLI）
      ├─ 命令队列 / turn lease / 预设绑定 / 注入门控
      └─ profile = ~/.mirach/profiles/mirach（官方 cordis 契约）
           ├─ package.json（bundles + dependencies 社区插件）
           ├─ cordis.patch.yml（ Mira 专用补丁：多提供商路由/沙箱/权限）
           └─ node_modules（pnpm hoisted 布局，官方 + 社区包）
```

**数据流**：
- 前端 → Tauri invoke → Rust 中继 → sidecar stdin JSON-RPC → 引擎 runtime
- 引擎事件 → sidecar 适配（pi→MirachEvent）→ stdout → Tauri Channel → 前端
- 内核镜像：sidecar raw_session_event 与官方 client 栈同 seq 空间，去重合流

**环境隔离**：sidecar 以 `<envId>::<frontendId>` 做会话映射命名空间 + cwd 切换。dsh 会话持久化按 cwd 分组。成员私聊 = `member-<成员id>` 独立会话。

---

## 3. 已完成功能

### 对话与渲染
- 三种对话风格：默认（mirach 气泡 UI）/ dsh（官方 ConversationRoot 原生渲染，无 iframe）/ 简约（zosma 组件树）
- 消息定位器 TurnNavigator（官方组件移植，右侧回合导航轨）
- StatsLine（官方投影字段：工作/思考时长、首字、tok/s、缓存、四桶 token）
- 等待指示（头像+名字+思考气泡+工作中计时，Virtuoso Footer）
- 剧情选项按钮（解析回复末尾 1.2.3. 渲染为可点击按钮）
- 状态栏卡片（「状态栏：」块渲染为紫色卡片）
- 群聊 v1（多成员同聊，@点名/全员/轮流，逐个走各自会话）
- 文件更改汇总（回合结束显示改动文件 + 审查入口 GitReviewPanel）

### 成员系统
- 智能体团队并入环境面板（每环境卡片展开管理）
- 成员私聊接真引擎（每成员独立 dsh 会话 + persona 注入 + session-bindings 登记）
- 成员历史回放（dsh_get_history）+ 本地持久化（localStorage）
- 内置环境不可删除（SEED_ENV_IDS），用户只删自己添加的
- 环境隐藏 = 团队失效（面板提示 + 左栏不显示）
- 群聊创建（名称+参与者多选+策略选择）

### 酒馆（dsh-tavern）全量对接
- 一键安装器（npm → junction → profile bundles 声明，官方机制）
- 原生酒馆管理面板（嵌入聊天环境智能体上方，补齐 dsw-alias 令牌）
- 角色导入：内置角色库 22 角色 6 分类 / SillyTavern PNG+JSON / 在线市场 / 酒馆预设
- 世界书面板（v2 格式，全文/关键词注入模式，读写 worldbooks.json）
- 注入门控：session-bindings.json 登记 → 只有绑定的成员会话有酒馆注入
- 成员融合：预设绑定（agentPresets.select）→ 世界书/记忆/关系网/剧情选项激活
- NSFW：插件自带开关在原生面板里可用；mirach 代码不实现/不接线破限

### 基础设施
- 引擎 npm 全局安装（更新 = npm i -g @deepseek-ai/dsh@alpha + 重启）
- 内核加载完整官方 client 栈（KERNEL_PLUGINS 41 bundle：连接/gateway/remotes/session-controller/workspace-controller + 全套 client UI 包（renderer/locale/settings 及分区包/session/workspace/theme/layout/sidebar/conversation/chat/tool/attachment/reference/brand-official + 输入框/对话区/能力包/定时/目录选择器栈）；酒馆与 dsh-pocket 经 apply 侧载）
- 插件一键安装器（npm 搜索发现 + 安装/卸载 + 步骤日志）
- 环境记忆（per-env MEMORY.md + USER.md，sidecar set_env 注入，AI 自维护）
- About 双标签（Mirach/引擎）+ 真实版本检查 + 一键更新 + 自动更新开关 + 更新内容展示
- 手机接入（局域网开关 + 二维码 + Tailscale 跨网识别 + 防火墙提示）
- profile 迁移官方契约（pnpm-workspace.yaml + dependencies + bundles 声明）
- 插件管理器真实化（npm 搜索发现 + 已安装列表 + 引擎装配清单）
- listEnginePlugins 修复为 dsh_rpc stdin 通道（原 relay_rpc HTTP 必失败）

### 酒馆以外社区插件
- dsh-workgroup、dsh-realtime-voice 已装并激活
- 安装器支持任意 npm 包（plugins.install RPC）

---

## 4. 关键文件速查

### 前端（src/）
| 文件 | 说明 |
|---|---|
| `dsh-kernel/boot.ts` | 内核启动：加载官方 client 栈 + 酒馆 bundle + slots |
| `dsh-kernel/module-loader-shim.ts` | __ModuleLoader__ shim（收集 factory，PLATFORM 种子表） |
| `dsh-kernel/adapter.ts` | sidecar adapter 本地副本（pi→MirachEvent 转换） |
| `dsh-kernel/dsh-bridge.ts` | 内核事件桥（boundSid 会话绑定 + 后台簿记） |
| `store/chat-events.ts` | 统一事件处理器（sidecar/内核双管道共用，background 模式） |
| `store/agent.ts` | busy 分桶（$busyMap 按会话，$agentBusy=computed 任一忙） |
| `store/engine-session.ts` | bindEngineSession（set_env + load_session 两连） |
| `store/environments.ts` | 环境分片（SEED_ENV_IDS 内置不可删） |
| `store/agents.ts` | 智能体团队（按环境分片读写 + upsertTavernMember） |
| `store/groups.ts` | 群聊定义（participants + mode） |
| `store/session-events.ts` | 原始事件日志（装配层底座） |
| `components/layout/MainPanel.tsx` | 对话区主面板（消息列表/等待指示/文件更改/定位器） |
| `components/settings/AgentTeam.tsx` | 智能体团队面板（每环境实例化） |
| `components/settings/EnvSettingsSection.tsx` | 环境设置分区（团队展开/内置锁） |
| `components/chat/TurnNavigator.tsx` | 官方消息定位器（移植） |
| `components/chat/MemberChatPanel.tsx` | 成员/群聊面板（署名渲染/剧情选项/状态栏） |
| `components/chat/FileChangesRow.tsx` | 回合文件更改汇总 + 审查入口 |
| `lib/tavern.ts` | 酒馆预设扫描 + PNG/JSON 卡解析 + session-bindings 登记 |
| `lib/tavern-characters.ts` | 内置角色库（22 角色 6 分类） |
| `lib/paths.ts` | 用户主目录推导（tavern/记忆路径） |
| `hooks/useStreamingReply.ts` | sidecar 管道消费（绑定→事件→handleMirachEvent） |

### sidecar（agent-sidecar/src/）
| 文件 | 说明 |
|---|---|
| `index.ts` | 命令处理（set_env/load_session/rpc/agentPresets.select/plugins.*/net.info） |
| `dsh.ts` | 引擎启动（npm dsh.cmd 优先回退 workspace 源码；NODE_PATH；systemPrompt） |
| `runtime.ts` | 路径解析（profileMode/sessionRoot/migration） |
| `plugins.ts` | 社区插件一键安装（npm/junction/patch）+ net.info + update.check/engine |
| `adapter.ts` | dsh SessionEvent → pi 事件（humanizeError 完整映射） |
| `turn-lease.ts` | Turn lease（代际令牌 + 身份校验 + fail-open） |
| `history.ts` | 会话历史读取（zstd JSONL 多帧解压） |

### Rust（src-tauri/src/）
| 文件 | 说明 |
|---|---|
| `dsh_relay.rs` | sidecar 管理（spawn/重启循环防护/scmd_r/命令透传） |
| `lib.rs` | 主入口（git/文件/浏览器/手机接入 web_host/fetch_text/read_file_bytes） |
| `relay_cron.rs` | 定时任务（api_server /api/jobs CRUD 透传） |

---

## 5. 运行与更新

### 启动
```
cd G:\deepseek-harness-master\apps\mirach
pnpm tauri dev       # 前端 + Tauri（自动拉起 sidecar → 引擎）
```

### 引擎更新（一条命令）
```
npm i -g @deepseek-ai/dsh@alpha
```
重启应用生效。设置 → 关于 → 引擎标签 → 检查更新/一键更新也可。

### 插件安装
```
右工具栏 → 拓展(▦) → 插件 → 安装标签 → 输入 npm 包名 → 安装 → 重启
```
或：`npm i <包名>` 装到 `~/.mirach/dsh-plugins` + profile cordis.patch.yml 加 insert 行。

### 插件卸载
插件管理器 → 已安装 → 卸载按钮（内置三件禁用）。store 层 removeEnvironment 拒删内置环境。

---

## 6. 已知限制 / 待做

### 待做（按优先级）
1. **dsh 风格完整官方 ChatView 渲染**：内核已加载全部 41 个官方 bundle；chatStyle=dsh 已由 NativeChatArea 直挂官方 ConversationRoot 树。剩余为官方会话数据接通后的完整体验对齐（对齐后 dsh 风格 = 官方对话区完整体验 + 自动跟随更新）。
2. **群聊增强**：状态栏卡片/剧情选项按钮在群聊已生效，但群聊上下文靠 prompt 注入最近 12 条（各成员保有自己会话记忆）。
3. **手机端**：设置 → 手机接入 → 开开关 → 重启 → 扫码即用。公网需隧道+HTTPS。
4. **dsh-agent-rp**：npm 上不存在（404），待用户提供来源。
5. **定时任务 envId 隔离**：当前是命名约定（[envId] 前缀），字段级隔离需引擎支持。
6. **成员模板导入导出**：已有团队导出/导入 JSON，成员级细粒度待做。

### 已知限制
- NSFW 破限：mirach 代码不实现/不接线。原生酒馆面板里的开关属插件作者功能。
- 成员线程 UI 记录在内存 + localStorage（重启恢复），引擎侧持久日志是权威。
- 群聊并发绑定窗口理论上可交错（引擎串行队列兜底）。
- 内核单会话绑定：A 的回合收尾可能短暂清 B 的 busy（B 的 turn 事件到达后恢复）。

---

## 7. 凭据 / 路径

- **数据目录**：`C:\Users\Administrator\.mirach`（会话/插件/存储/profiles）
- **酒馆数据根**：`C:\Users\Administrator\.dsh\.agent-presets`（插件硬编码 homedir）
- **引擎源码**：`G:\deepseek-harness-master`（官方 workspace 0.1.2-alpha.4 源码）
- **npm 引擎**：全局 `@deepseek-ai/dsh@alpha`（0.1.2-alpha.5）
- **社区插件目录**：`C:\Users\Administrator\.mirach\dsh-plugins\node_modules`
- **Gitee PAT**：`scripts/_gitee_pat.txt`（已 gitignore）
- **API Key**：本机 providerConfig（localStorage），代码中无硬编码
- **便携包**：`dist-portable\`（已 gitignore）
