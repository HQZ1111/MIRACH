# Hermes Dashboard ⇄ Agent 引擎 对接契约（已实现 Tauri Relay）

> 本文档定义 `my-hermes-rs` 前端与 Agent 引擎（`hermes-agent-ultra`）之间的通信契约。
> 架构为 **UI → Tauri Relay → 引擎** 三层：Rust 中继层只做转发，不含任何 AI 逻辑。

## 1. 架构现状（四路引擎接入）

```
┌─────────────┐  Tauri IPC (invoke)  ┌──────────────────┐  HTTP   ┌────────────────────────────┐
│  UI (React) │ ───────────────────► │ Tauri Relay (Rust)│ ──────► │ hermes-http (引擎, 8787)    │
│             │ ◄──── 事件/Channel ── │  relay.rs          │ ◄────── │ 对话/命令面/认证/RPC         │
│             │                      │  relay_cron.rs     │ ──────► │ api_server (8090) 定时任务   │
│             │                      │  sessions.rs       │ ────    │ {hermesHome}/sessions.db    │
│             │                      │  acp.rs (边车)      │ ──────► │ hermes acp start (stdio)    │
└─────────────┘                      └──────────────────┘          └────────────────────────────┘
```

| 层 | 职责 | 位置 |
|---|---|---|
| UI | 渲染 + 交互，不直接请求引擎 | `src/`（React） |
| **Tauri Relay** | 转发、探活、事件/流式推送；**无 AI 逻辑** | `src-tauri/src/relay.rs` / `relay_cron.rs` / `sessions.rs` / `acp.rs` |
| 引擎 | 会话/生成/工具，Agent 逻辑 | `hermes-agent-ultra`（hermes-http / api_server / hermes acp） |

- 前端客户端抽象：`src/lib/api/client.ts`（`HermesClient`：`MockClient` / `RealClient`）
- 切换开关：`VITE_MOCK=1`（默认 mock）/ `VITE_MOCK=0`（走 Relay）
- 引擎地址配置（`src-tauri/src/lib.rs` `load_config`，见 §5）；所有引擎接入都有"不可达 → UI 降级提示"兜底，不白屏

## 2. Tauri Relay 命令（前端经 invoke 调用）

### 2a. 对话（hermes-http 8787，`relay.rs`）

| 命令 | 引擎侧调用 | 用途 |
|---|---|---|
| `relay_ping` | `GET {engine}/health` | 网关状态点探活 |
| `relay_submit(sessionId, text, model?)` | `POST {engine}/v1/sessions/{id}/messages` | 整段提交，成功后 `emit("relay:reply")` |
| `relay_stream_submit(sessionId, text, ch)` | 同上（Channel 推 `message.delta` + `message.complete`） | **降级**流式：无 ACP 时单条 delta |
| `relay_models` | `GET {engine}/v1/models` | 模型列表（引擎缺省返回空） |
| `relay_rpc(method, params)` | `POST {engine}/v1/rpc` | `project.tree` / `llm.oneshot` 等 |
| `relay_command(sessionId, command)` | `POST {engine}/v1/commands` | **斜杠命令面**：`/usage /status /stop /queue /undo /resume /fast /steer` 等 |
| `relay_auth_status()` | `GET {engine}/auth/status` | 认证状态（mode/authenticated/identity） |

### 2b. 定时任务（api_server 8090，`relay_cron.rs`）

| 命令 | 引擎侧调用 | 用途 |
|---|---|---|
| `relay_cron_ping()` | `GET {apiBase}/api/jobs` | 可达性探测（面板决定真实/降级） |
| `relay_cron_list()` | `GET {apiBase}/api/jobs?include_disabled=true` | 任务列表（`{jobs:[…]}` 透传） |
| `relay_cron_create(payload)` | `POST {apiBase}/api/jobs` | 建任务（name/schedule/prompt/deliver/enabled/…） |
| `relay_cron_update(id, payload)` | `PATCH {apiBase}/api/jobs/{id}` | 更新 |
| `relay_cron_delete(id)` | `DELETE {apiBase}/api/jobs/{id}` | 删除 |
| `relay_cron_pause/resume/run(id)` | `POST {apiBase}/api/jobs/{id}/pause\|resume\|run` | 暂停/恢复/立即运行 |

认证：有 `apiToken` 时带 `Authorization: Bearer`。

### 2c. 会话列表/搜索（本地持久化层，`sessions.rs`，不依赖 HTTP 服务）

| 命令 | 说明 |
|---|---|
| `sessions_list()` | 只读 `{hermesHome}/sessions.db`（`sessions` 表按 updated_at 倒序）；db 缺失降级扫 `sessions/*.json` 快照 |
| `sessions_search(query, limit?)` | `messages_fts` FTS5 `MATCH`（snippet 带 `<mark>`）；FTS 不可用降级 `LIKE` |
| `sessions_load(sessionId)` | 取该会话全部消息（打开历史渲染） |
| `sessions_rename(sessionId, title)` | best-effort 写库（busy_timeout 处理引擎锁库） |
| `sessions_delete(sessionId)` | 删 sessions + messages + FTS + 快照文件 |

### 2d. ACP 边车（`hermes acp start`，stdio JSON-RPC，`acp.rs`）—— 细粒度流式

| 命令 | 说明 |
|---|---|
| `acp_status()` | 探测并启动边车（`hermesBin` 配置 > PATH；initialize 握手自检）；返回 `{available, reason}` |
| `acp_request(method, params)` | 通用 JSON-RPC（initialize / session/list / session/title / session/new …） |
| `acp_submit(sessionId, text, ch)` | **流式提交**：session/update 通知经 Channel 推 `message.delta(thinking/text)` / `tool.start/complete` / `status.update` |
| `acp_sessions_list()` | ACP 会话列表（前端会话列表优先于此） |
| `acp_steer(guidance)` | `/steer` 真打断转向（运行中注入纠偏） |
| `acp_cancel()` | `session/cancel` |
| `acp_stop_cmd()` | 停止子进程（退出时自动清理） |

ACPC 子进程退出时自动清理状态；未安装 hermes / 未配置 provider → `acp_status.reason`，前端降级到 8787 整段。

## 3. 引擎事件（Rust → UI）

| 事件 | 来源 | 前端消费 |
|---|---|---|
| `relay:reply` | `relay_submit` | `RealClient.subscribe` → 追加 AI 消息 |
| `acp:event` | `acp.rs` 通知广播 | 全局事件（带 `sessionId`） |

流式提交（`acp_submit` / `relay_stream_submit`）经 **Tauri Channel** 逐事件推送，不经全局事件。

## 4. 事件映射（ACP 通知 → HermesEvent，`src/lib/api/types.ts`）

引擎 `AcpEvent`（`session/update` 的 `params`，`kind` 为 snake_case）→ 前端事件：

| AcpEvent kind | HermesEvent | 前端消费点 |
|---|---|---|
| `message_delta` / `agent_message_chunk` | `message.delta`（partType=text） | `appendAiDelta` 流式追加 |
| `thinking` / `agent_thought_chunk` | `message.delta`（partType=thinking） | `ThinkingDisclosure` |
| `message_complete` | `message.complete`（含 text） | `finalizeAiMessage` 权威定稿 |
| `tool_call_start` | `tool.start` | `appendToolMessage` 插入工具行 |
| `tool_call_complete` | `tool.complete`（status=completed/error + detail） | `updateToolMessage` 更新 |
| `step_complete` / `plan_update` / `usage_update` / `session_info_update` | `status.update` | 系统消息（步骤/计划/上下文用量） |
| `error` | `message.error` | 系统错误消息 |
| `approval.request` / `clarify.request` / `subagent.*` / `background.complete` | 类型已定义 | ⏳ 引擎无对应出口（approval 桩恒 409） |

## 5. 本地配置（`get_config` / `set_config`）

环境变量 → `%APPDATA%\my-hermes-rs\config.json` → 默认。前端 `useAppConfig`（`src/hooks/useAppConfig.ts`）缓存，改后 dispatch `hermes-config-reload` 事件。

| 字段 | 环境变量 | 默认 |
|---|---|---|
| `workspace` | `HERMES_WORKSPACE` | `D:\hermes-agent-main` |
| `hermesHome` | `HERMES_HOME` | `C:\Users\Administrator\Hermes` |
| `browserHome` | `HERMES_BROWSER_HOME` | `https://www.bing.com` |
| `engineBase` | `HERMES_ENGINE` | `http://127.0.0.1:8787` |
| `apiBase` | `HERMES_API_BASE` | `http://127.0.0.1:8090` |
| `apiToken` | `HERMES_API_TOKEN` | （空 = 无认证） |
| `hermesBin` | `HERMES_BIN` | （空 = 走 PATH） |

设置 → 连接 分区可编辑 engineBase / apiBase / apiToken / hermesBin，并显示 ACP 边车可用状态。

## 6. 降级链（引擎不可达时的行为）

| 功能 | 引擎不可达时 |
|---|---|
| 对话流式 | ACP 不可用 → 8787 整段；8787 也不可达 → 提交报错提示（不崩溃） |
| 会话列表 | ACP 列表 → sessions.db → 本地 store（localStorage） |
| 会话搜索 | sessions.db FTS5 → LIKE；无库 → 无结果 |
| 定时任务 | api_server 不可达 → 本地 mock 数据 + "引擎未连接"横幅 |
| 认证卡 | 8787 不可达 → "引擎未连接"降级卡 |

## 7. 验证步骤

1. 启动引擎：`hermes-http`（8787）＋（可选）`api_server`（8090，带 token）＋（可选）本机 `hermes acp start`
2. 启动前端：`set VITE_MOCK=0 && npm run tauri dev`
3. 预期：
   - 右侧工具栏网关点绿（relay_ping）
   - Composer 发送 → ACP 流式（thinking/tool 增量/逐块文本）；无 ACP 时 8787 整段
   - 命令面板"引擎"组斜杠命令真实执行（输出进聊天区）；设置→账户显示真实认证状态
   - 排程面板显示 api_server 真实任务（不可达时横幅降级）
   - 左侧会话列表 = 引擎会话（ACP 优先），搜索框 = FTS5 深搜，点击会话加载历史

## 8. 尚未实现（引擎无出口 / 后续项）

- approval / clarify / subagent 外部事件（引擎 HTTP 面为桩或无暴露）
- provider API key 的 HTTP 保存/校验（引擎仅 CLI `hermes secrets`）
- 出站 webhook 订阅端点、usage 历史 JSON 端点、Gateway 四模式、更新器、Voice 全链路、插件系统
