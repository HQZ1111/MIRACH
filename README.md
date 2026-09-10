# Mirach — 多 Agent 智能体系统

> 多 Agent 协作 · 多工作环境 · 自进化 harness。一套**前后端一体**的 AI Agent 桌面应用：React 19 界面与交互 + Tauri(Rust) 通信中继 + agent-sidecar 桥接服务 + **dsh（DeepSeek Harness）引擎运行时**。

---

## 一、产品定位

Mirach 是面向「多 Agent 协作工作流」的完整智能体系统，核心三件事：

1. **多 Agent 协作**——主对话与成员会话、子代理（subagent）、用户提问闭环（ask_user_question）、工具调用与产物（deliverables）全链路呈现与编排；
2. **多工作环境**——每个视图/项目对应独立引擎环境（按工作区 cwd 隔离的引擎 namespace、会话持久化分片、互不串扰），支持多工作区并行；
3. **自进化 harness**——基于 dsh 引擎的 cordis 插件体系，按需动态装配能力：压缩（compaction）、时间感知（time-context）、技能（skills）、工作流（workflow）、文件系统、反馈回路等，运行时组合成当前任务最优的 agent 形态。

界面不持有业务状态，引擎是数据与能力的所有者。前端只认事件契约，不认具体引擎——替换引擎时 UI 零改动或极小改动。

## 二、核心架构

```
┌─────────────────────────── Mirach 桌面应用 ──────────────────────────┐
│                                                                      │
│  ┌──────────────────┐      ┌───────────────────────┐                 │
│  │  前端 (React 19)  │      │  Tauri Relay (Rust)    │                 │
│  │  UI · 交互 · 状态 │─IPC─▶│  命令注册 / Channel 事件 │                │
│  │  invoke()/Channel │      │  sidecar 生命周期管理    │                │
│  └──────────────────┘      └───────────┬───────────┘                 │
└────────────────────────────────────────┼────────────────────────────┘
                                         │ stdio JSON-RPC（逐行信封）
                              ┌──────────▼───────────┐
                              │  agent-sidecar (Node) │
                              │  会话映射 / 事件适配    │
                              │  环境隔离 / 历史回放    │
                              └──────────┬───────────┘
                                         │ SDK（子进程 + 握手）
                              ┌──────────▼───────────┐
                              │  dsh 引擎运行时        │
                              │  cordis 插件装配       │
                              │  LLM 路由 / 工具执行    │
                              │  会话持久化 (zstd JSONL)│
                              └──────────────────────┘
```

**设计要点**

- **前后端一体的智能体系统**：前端呈现与编排、中继层协议收敛、sidecar 会话与环境管理、引擎执行与持久化，四层职责清晰。
- **引擎能力经 cordis 动态装配**：compaction（上下文压缩）、time-context（时间感知）、skills、workflow、user-questions、message-feedback 等插件按配置组合，harness 形态随任务自进化。
- **多环境隔离**：`hermes.sessions.v1.<envId>`（前端会话分片）+ 引擎按 cwd 分组的持久化 namespace，主环境/聊天/代码/写作等互不串扰。
- **流式全链路**：引擎事件 → sidecar 适配 → Rust Channel → 前端增量渲染；delta 合帧（90ms）+ 流式行降级纯文本 + 虚拟滚动（Virtuoso），长会话百万条消息流畅。
- **可靠性**：sidecar 崩溃自动重建、迟到事件门控（envEpoch）、Stop 定稿守卫、运行时冷启动预热（prewarm）。

## 三、技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面外壳 | **Tauri 2 (Rust)** | 系统能力（窗口、文件、深链、快捷键）经命令暴露给前端 |
| UI 框架 | **React 19 + TypeScript** | 函数组件 + Hooks |
| 构建 | **Vite 7** | 秒级冷启动 |
| 样式 | **Tailwind CSS v4** + shadcn/ui | 设计令牌驱动，深浅色主题 |
| 状态 | **Nanostores** | 轻量原子状态，React 绑定 + 非组件环境读写 |
| 富渲染 | react-markdown · rehype-katex · mermaid · highlight.js | Markdown / LaTeX / 流程图 / 代码高亮 |
| 虚拟滚动 | react-virtuoso | 百万级消息只渲染视口 |
| 桥接服务 | **Node 22 + tsx**（agent-sidecar） | stdio JSON-RPC，会话映射与事件适配 |
| 引擎 | **dsh（DeepSeek Harness）** | cordis 插件装配的 agent 运行时，多 LLM 路由 |

## 四、目录结构

```
mirach/
├── src/                      # 前端(React 19)
│   ├── components/           # 布局 / 聊天 / dsh 工具行 / 弹层 / Markdown
│   ├── pages/                # 视图页(代码 / 任务 / 写作 / 收藏 / 知识库)
│   ├── store/                # Nanostores(会话 / 聊天 / 工具 / 环境 / 用量)
│   ├── hooks/                # 主题 / 配置 / 流式回复
│   └── lib/                  # API 客户端 / 品牌迁移 / 键迁移 / i18n
├── src-tauri/                # Tauri 中继层(Rust)
│   └── src/
│       ├── lib.rs            # 命令注册表(前端 invoke 入口)
│       ├── dsh_relay.rs      # sidecar 生命周期 / JSON-RPC 信封分派 / 事件转发（唯一引擎通道）
│       ├── relay.rs          # 供应商端点探测(relay_probe，与引擎无关)
│       └── sessions.rs       # 会话检索(FTS5 / 快照降级)
├── agent-sidecar/            # 桥接服务(Node)
│   └── src/
│       ├── index.ts          # 命令循环 / 运行编排 / 崩溃自愈
│       ├── dsh.ts            # 运行时生命周期 / 环境隔离 / 会话句柄
│       ├── adapter.ts        # 引擎事件 → 前端事件适配
│       └── history.ts        # 会话日志解析(按回合合并回放)
└── docs/                     # 契约与说明
```

## 五、运行

```bash
pnpm install

# 桌面应用（真实引擎链路；VITE_MOCK=0 已固化于 .env）
pnpm tauri dev

# 构建
pnpm build             # 前端产物
pnpm tauri build       # 安装包

# 便携分享包（exe + 便携 Node + 引擎 + 依赖，接收者解压即用）
powershell -ExecutionPolicy Bypass -File scripts\build_portable.ps1
```

环境变量：`DSH_HARNESS_ROOT`（引擎位置）、`DSH_NODE_BIN`（Node ≥22.23.2）、`MIRACH_RUNTIME_DIR`（便携包运行时根），默认按仓库/vendor 约定自动探测。

## 六、当前状态

- [x] dsh 引擎端到端：对话 / 思考流 / 工具调用 / 子代理 / 用户提问 / 反馈 / compaction / 会话续聊
- [x] 多工作环境隔离与切换（预热即切即用）
- [x] dsh 原生 UI 组件（ReasoningRow / DshToolRow / CompactionRow）
- [x] 看板 / 产物接真实数据；会话回放按回合合并
- [x] 虚拟滚动 + delta 合帧 + 流式渲染优化（长会话流畅）
- [x] 便携分享包（Gitee Release 分发）
- [x] 可重绑定快捷键（hermes combo/capture/conflicts 全套，设置页改键）
- [x] 内嵌终端（portable-pty 多实例）
- [x] 引擎一键更新（npm alpha 通道 + 版本检查）
- [x] 官方机制替换：内核装配 = 官方 ClientModuleSystem（`__DSH_BOOT__` 图 + `import()`）、引擎 profile 读写 = 官方 `dsh-app-boot`、home 解析 = 官方 `dsh-home-paths`、应用自有 cordis overlay（SDK patches）、unary 请求 abort 透传
- [x] 应用自更新（Tauri updater：签名校验 + 可配置端点 + 关于页检查/安装）
- [x] 单实例锁（第二次启动聚焦已有主窗口 + 命名互斥量竞态兜底）
- [x] 远程引擎（SSH）：sidecar 跑在远端主机，本地只做壳（设置 → 通用 → 远程引擎；见 docs/remote-engine.md）
- [x] 事务化插件安装/卸载（清单快照 + 安装后校验 + 失败回滚）
- [x] 质量门：lint 0 warning / 前端 9 测试 / sidecar 15 测试 / Rust 14 测试
- [x] hermes 功能移植：唤醒词插件 / 提示音系统（14 完成音变体）/ 语音听写与朗读 / 抓取滚动 / 通知中心 / 会话星图 / HUD 悬浮窗 / 国产内嵌卡片（哔哩哔哩/网易云/高德/抖音/红果）
- [x] 侧栏工作区切换器 = 官方 dsh WorkspaceBrowser（槽位渲染，随官方更新）
- [ ] SSH 远程
- [ ] 帧化/背压传输（大附件流式；当前为体积上限 + 明确报错）
- [ ] 巨型组件拆分（Composer / sidebar-shell / SettingsOverlay / AppLayout）
- [ ] 引擎任务面板真实数据（待引擎暴露 jobs.list RPC）

## 七、同步到新机器

见 `docs/sync-procedure.md`（四层结构 + 首装/日常同步步骤；**不能直接复制文件夹**）。
