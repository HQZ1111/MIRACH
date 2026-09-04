# dsh 对话区官方组件全清单（0.1.2-alpha.4 源码盘点）

> 目的：对齐"完全官方组件"的 dsh 风格前，先列清官方 web 在对话区都渲染/注册了什么。
> 来源：packages/client/{pkg}/src/** 导出与槽位注册（ui-chat / ui-conversation / ui-trajectory / ui-layout / ui-session / ui-sidebar / ui-attachment / ui-tool / ui-goal / ui-plan / ui-subagent / ui-user-questions / ui-deliverables / ui-workflow-run / ui-approval / ui-commands / ui-input-trigger / ui-agent-preset / ui-jobs / ui-schedule / ui-model-selection / ui-permission-presets / ui-message-feedback / ui-workspace）。

## 一、整树骨架（谁渲染什么槽）

| 槽位 | 渲染器/组件 | 内容 |
|---|---|---|
| root | ui-renderer SlotCore | 官方根树入口，子槽 sidebar / conversation / details / shell.overlay |
| conversation | ui-conversation ConversationRoot | **对话区外壳**：session.header + 滚动 body（会话视图 + 输入座）+ 宽度拖柄 |
| conversation.session | ui-chat ChatView（conversation.view chain） | **当前视图内容**（对话/轨迹/交付物…视图在此链选） |
| conversation.composer | ui-conversation（chain，overlay:true） | 输入座（normal + subagent 接管/审批/提问等可覆盖） |
| conversation.composer.bar | ui-conversation InputBar | **官方输入条**：Lexical 编辑器 + 底部工具行（+号/模式/模型/发送） |
| conversation.input.{model,plan,left,right,attachments,overlay,dock} | ui-model-selection / ui-plan / 插件 / ui-attachment / ui-commands+ui-input-trigger / ui-goal(+QueueDock) | 输入条各预留座 |
| details | ui-chat DetailsPanel 等 | 右侧详情栏（工具详情树/轨迹） |

## 二、会话头与上方栏（ConversationSessionHeader 区）

| 组件 | 包 | 职责 |
|---|---|---|
| ConversationSessionHeader | ui-conversation | 会话顶部条容器 |
| 对话/轨迹视图切换（resolveActiveView / readConversationViewPreference） | ui-conversation | 对话视图偏好 = "对话 | 轨迹" 等视图选择 |
| conversation.session.header.lineage（SubagentHeaderLineage） | ui-subagent | 子代理调用链（父→子代理徽标） |
| conversation.session.header.actions（AgentPresetLabel、JobListAction、ScheduleCatalogAction） | ui-agent-preset / ui-jobs / ui-schedule | 头右侧操作（预设标签、任务、定时） |
| conversation.session.header.utilities | 各插件 | 头工具位 |
| GoalBar / GoalDock | ui-goal | 会话目标条/坞 |
| TurnNavigator / TurnProcessNodeView / TurnTailNodeView / TurnUsagePanel / TurnTimePanel | ui-chat | 轮次导航条（第 N 轮/步）+ 用量/耗时 |

## 三、会话消息流（ChatView → 各 node 渲染器）

| 组件 | 包 | 职责 |
|---|---|---|
| SystemPromptRow / SystemPromptNodeView | ui-chat | **系统提示词**：可折叠展开显示会话 system prompt |
| ReasoningRow | ui-chat | **深度求索/思考块**（assistant reasoning，逐段/折叠） |
| ContextInjectionRow（+ ContextBody/InstructionsBody/CatalogBody/SnapshotBody/…） | ui-chat | **上下文注入**：列出被注入的上下文（指令/目录/快照等） |
| CompactionCommandCard / CompactionItem / ManualCompactionNodeView | ui-chat | 压缩命令卡片/压缩行 |
| ApprovalCommand / CommandNodeView / GenericCommandCard | ui-chat | 命令节点（/approval、/plan、/…）卡 |
| UserMessageNodeView / ContextMessageNodeView | ui-chat | 用户消息 / 上下文引用消息 |
| AssistantMarkdown / AssistantNodeView | ui-chat | 助手消息渲染（markdown + thinking 结合） |
| ToolRow / ToolCallTree / ToolDetails + AskQuestionRow/BashRow/ReadRow/SearchRow/TodoRow/WebRow/FileMutationRow/terminalCardModel | ui-tool | **工具调用行与详情**（bash/fs/搜索/web/todo 卡片 + 树） |
| StatsLine | ui-chat | **会话统计行**：轮/步 + LLM 时长·工具时长 + 首 token 均时·tok/s + 缓存命中% + 输入/输出 token |
| TurnProcessNodeView / turn-tail / … | ui-chat | 轮过程/轮尾节点 |
| MessageImages / ComposerAttachments / lightbox | ui-attachment | 图片与附件 |
| MessageFeedbackActions | ui-message-feedback | 消息赞/踩 |
| AskQuestionCard / AskQuestionRow | ui-tool / ui-user-questions | 工具提问卡 |
| PlanReviewPanel / QuestionComposer | ui-user-questions | 计划审查提问（plan 模式的复查） |
| ApprovalPanel | ui-approval | 权限审批面板 |
| ProducedFiles | ui-deliverables | 产物/交付物文件卡 |
| WorkflowRunPanel | ui-workflow-run | 工作流运行 |
| SubagentReadOnlyComposer | ui-subagent | 子代理只读输入座（显示父/子代理） |
| SkillRow | ui-skill | 技能行（@skill） |

## 四、对话视图（conversation.view chain 竞争者）

| 组件 | 包 | 职责 |
|---|---|---|
| chatViewDefinition / registerChatConversationView（ChatView） | ui-chat | 默认"对话"视图（上面的消息流） |
| TrajectoryView / TrajectoryTable / TrajectoryTimeline / TrajectoryToolbar / TrajectoryTurn / TrajectoryCell / TrajectoryGroupHeader | ui-trajectory | **轨迹视图**：时间线/表格浏览历史步骤 |
| workflow-run / deliverables 也有各自 view | 相应包 | 产物/工作流专用视图 |

## 五、输入条组成（官方 InputBar，对应你问的 + / 三模式 / 模型）

| 组件 | 包 | 职责（mirach 若要"接官方"就是接这些） |
|---|---|---|
| ComposerContentEditable / DecoratorPortals / keymap | ui-conversation | Lexical 输入编辑器 + @文件/参考 chip |
| + 号按钮（IconPlusOutline16，打开 / 命令菜单） | ui-conversation InputBar | 命令菜单触发器（toggleCommandMenu） |
| PermissionSelect | ui-conversation | 权限芯片（对应"三模式"的只读/工作区/完全访问 = 官方权限预设） |
| conversation.input.plan → PlanChip | ui-plan | 计划模式芯片 |
| conversation.input.model → ModelSelect | ui-model-selection | 模型 + 思考档位两级菜单（官方，已接入 mirach seat） |
| ContextMeter | ui-conversation | 上下文占用计量条 |
| QueueDock / EnterBehaviorRow / TodoPanel | ui-conversation | 队列坞/回车行为/待办 |
| Conversation 的 attachment rail（ComposerAttachments） | ui-attachment | 附件轨 |

## 六、侧栏/顶栏/杂项（官方 shell 的其它槽）

- ui-layout AppFrame：三栏（sidebar/center/details）宽度与折叠（SIDEBAR_MIN…DETAILS_MAX、computeColumns）
- ui-sidebar SidebarRoot：左栏根
- ui-workspace WorkspaceBrowser / WorkspacePicker：工作区浏览/选择（sidebar.workspaces、conversation.hero.workspace）
- ui-brand-official OfficialBrandMark/Name：顶部品牌
- ui-model-selection /model 命令（commandUi popupSelect）
- ui-commands PopupSelectView + ui-input-trigger MenuView：斜杠命令 / @ 菜单弹层
- ui-plan 的 /plan 命令；ui-permission-presets 的 /permission 命令（= 官方三模式入口）
- ui-session renderSessionArea；ui-settings 全套设置面板（settings.* 槽）
- ui-reference（会话引用）、ui-cordis（开发壳）

## 七、当前 mirach 与"全官方 dsh 风格"的差距（要对齐的点）

1. **视图切换**：官方头部有"对话/轨迹"视图选择（conversation.view），现在 mirach shell 没暴露；dsh 风格需要让 ConversationRoot 真正渲染（含视图偏好）。
2. **会话头**：官方 header 的 lineage/actions/utilities 槽（子代理链、预设、任务、定时）目前依赖内核装载 ui-agent-preset/ui-jobs/ui-schedule/ui-subagent —— 均已列入 KERNEL_PLUGINS，但渲染依赖会话真实打开。
3. **引擎会话服务**：官方树要显示历史/当前会话，需引擎侧 session-controller/follow 可用（见日志 "sessionController is unavailable"）—— 否则 ConversationRoot 只在 hero/空态。
4. **统计行/导航**：StatsLine、TurnNavigator、TurnProcessNodeView 全在 ui-chat（官方），mirach 自绘的"1轮·47步 / LLM 5分37秒…"是重复实现——切 dsh 后应由官方 StatsLine 取代。
5. **系统提示词/上下文注入/深度求索**：官方 node 已存在（SystemPromptRow / ContextInjectionRow / ReasoningRow），dsh 全树会直接渲染——前提仍是 2+3。
6. **详情栏 details**：DetailsPanel + 工具树 ToolCallTree 官方有，mirach 右侧详情是自己的实现，dsh 时折叠官方三栏后只剩中列——要决定中列保留官方 conversation 完整态还是只取消息流。

> 说明：chatStyle=default/简约 是"mirach 壳 + 自己的消息列表/输入条"；chatStyle=dsh = 中列整段官方 ConversationRoot（上面全部由官方组件渲染）。
