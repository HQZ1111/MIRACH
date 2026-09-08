# Mirach ⇄ dsh 引擎 对接契约（dsh 单核心版）

> 本文档定义 mirach 前端与 dsh 引擎（DeepSeek Harness）之间的通信契约。
> 架构为 **UI → Tauri（dsh_relay.rs）→ agent-sidecar（Node）→ dsh 引擎**：
> Rust 中继层只做进程管理与转发，不含任何 AI 逻辑。
> 线路级协议细节（JSONL 信封 / rpc-http / dsh-auth / 事件底座）见 `docs/protocol-coupling.md`。

## 1. 架构现状（dsh 单核心）

```
┌─────────────┐  Tauri invoke/Channel  ┌───────────────────────┐  stdio JSONL  ┌─────────────────────┐
│  UI (React) │ ─────────────────────► │ Tauri (Rust)           │ ────────────► │ agent-sidecar (Node) │
│             │ ◄── 事件/Channel ────── │  dsh_relay.rs（主通道） │ ◄──────────── │  src/index.ts        │
│             │                        │  relay.rs（仅供应商探测）│               │  ├─ dsh.ts           │
│             │                        │  sessions.rs（FTS5 检索）│               │  └─ plugins.ts 等    │
└─────────────┘                        └───────────────────────┘               └──────────┬──────────┘
                                                                                       │ spawn
                                                                          ┌────────────▼────────────┐
                                                                          │ dsh 引擎（npm 全局 CLI）   │
                                                                          │ dsh --profile mirach     │
                                                                          │ DSH_HOME=~/.mirach       │
                                                                          └─────────────────────────┘
```

| 层 | 职责 | 位置 |
|---|---|---|
| UI | 渲染 + 交互，不直接请求引擎 | `src/`（React） |
| Tauri（Rust） | sidecar 进程管理、命令转发、流式 Channel；**无 AI 逻辑** | `src-tauri/src/dsh_relay.rs` / `relay.rs` / `sessions.rs` |
| agent-sidecar | JSONL 命令面 → SDK 子进程管理、会话映射、插件安装、引擎更新 | `agent-sidecar/src/` |
| 引擎 | 会话/生成/工具，Agent 逻辑 | npm 全局 `@deepseek-ai/dsh@alpha`（`dsh --profile mirach`） |

- 前端客户端抽象：`src/lib/api/client.ts`（`MirachClient`：`MockClient` / `RealClient`）
- 切换开关：`VITE_MOCK=1`（mock 演示）/ `VITE_MOCK=0`（真实链路，.env 已固化 0）
- 引擎 home：sidecar 注入 `DSH_HOME=%USERPROFILE%\.mirach`（终端裸跑 `dsh` 落默认 `~/.dsh`，两套互不干扰）
- 所有引擎调用都有「不可达 → UI 降级提示」兜底，不白屏

## 2. Tauri 命令（前端经 invoke 调用）

### 2a. 对话与引擎 RPC（`dsh_relay.rs`，stdio JSONL → sidecar → dsh）

| 命令 | 用途 |
|---|---|
| `send_prompt(text, ch, provider?, model?)` | 流式提交：pi 事件经 Channel 推 `message.*` / `tool.*` / `user_question` 等 |
| `abort_prompt` / `steer_prompt(text)` / `follow_up_prompt` | 中止 / 转向纠偏 / 追问 |
| `clear_queue` / `sync_provider_config` | 队列清理 / 提供商配置下发 |
| `get_models` / `get_active_model` / `set_active_model` | sidecar catalog 模型目录与选型 |
| `dsh_set_env(envId)` | 会话环境注入（`envId::sessionId` 命名空间 + DSH_CWD） |
| `load_dsh_session` / `dsh_get_history` / `dsh_list_sessions` | 历史加载 / 引擎会话列表 |
| `dsh_set_effort` / `dsh_rpc(method, params)` | 思考档位 / **通用 RPC 透传**（commands.execute、settings.describe、session.modelCatalog、messageFeedback.put、agentPresets.select、update.check/update.engine、plugins.*、skill.list 等） |
| `dsh_sidecar_ready` | sidecar 就绪探活（网关状态点 / 启动门） |

### 2b. 会话检索（本地持久化层，`sessions.rs`，不依赖引擎进程）

| 命令 | 说明 |
|---|---|
| `sessions_list()` | 只读会话库（db 缺失降级扫快照） |
| `sessions_search(query, limit?)` | FTS5 `MATCH`（snippet 带 `<mark>`）；不可用降级 `LIKE` |
| `sessions_load / sessions_rename / sessions_delete` | 历史加载 / 重命名 / 删除 |

### 2c. 供应商探测（`relay.rs`，与引擎无关，唯一遗留命令）

| 命令 | 用途 |
|---|---|
| `relay_probe(base_url, api_key, protocol)` | 登录页/设置页「测试连接」「获取模型」：探测 OpenAI/Anthropic 端点 + 拉模型目录 |

### 2d. 其他（终端 / Git / HUD / 多窗口，见 lib.rs）

`open_terminal` 系列（portable-pty）、git 审查系列、`hud_*`（悬浮窗拖动/边界/穿透/开合）、`open_session_window` 等多窗口命令。

## 3. 事件流（引擎 → UI）

- **流式事件**经 `send_prompt` 的 **Tauri Channel** 逐条回调，不经全局事件（`client.ts` submitPromptStream 桥接为 `MirachEvent`）
- `raw_session_event`（dsh 原始 SessionEvent 透传，seq/type/time/data）作为装配层/定位器的事件底座，与 sidecar 的 `raw_session_event` 共享 seq 空间
- 全局 `listen` 事件当前无推送源（subscribe 口保留供统一挂载）

## 4. 本地配置（`get_config` / `set_config`）

环境变量 → `%APPDATA%\my-hermes-rs\config.json` → 默认。前端 `useAppConfig`（`src/hooks/useAppConfig.ts`）缓存，改后 dispatch `hermes-config-reload` 事件。

| 字段 | 环境变量 | 默认 |
|---|---|---|
| `workspace` | `MIRACH_WORKSPACE` | `D:\hermes-agent-main` |
| `mirachHome` | `MIRACH_HOME` | `C:\Users\Administrator\Hermes` |
| `browserHome` | `HERMES_BROWSER_HOME` | `https://www.bing.com` |
| `webHost` | `MIRACH_WEB_HOST` | `127.0.0.1` |
| `dataDir` | （只读，应用数据目录） | `%APPDATA%\my-hermes-rs` |

引擎地址/home/凭据等不在前端配置：home 由 sidecar 注入 `DSH_HOME`，引擎更新走 `update.engine`（`npm i -g @deepseek-ai/dsh@alpha`），提供商配置经 `sync_provider_config` 下发给 sidecar。

## 5. 降级链（引擎不可达时的行为）

| 功能 | 引擎不可达时 |
|---|---|
| 对话流式 | sidecar 未就绪 → 网关门 connecting（40×750ms 宽限）→ BootFailure 浮层（重试/设置） |
| 会话列表 | sessions 库 → 本地 store（localStorage） |
| 会话搜索 | FTS5 → LIKE；无库 → 无结果 |
| 定时任务 | dsh schedule 插件（send_prompt 语义），无独立 HTTP 面 |
| 引擎任务面板 | `jobs.list` 引擎未暴露 → 面板给出说明（不灌假数据） |

## 6. 验证步骤

1. 启动应用：`npm run tauri dev`（VITE_MOCK=0 已固化）
2. 预期：
   - 右侧工具栏网关点绿（dsh_sidecar_ready，sidecar 冷启动有 30s 宽限）
   - Composer 发送 → dsh 流式（text/thinking 增量、tool.start/complete、user_question 提问卡）
   - 命令面板"引擎"组斜杠命令经 commands.execute 真实执行
   - 设置 → 关于 → 引擎 可检查/一键更新（npm alpha 通道）
   - 左侧官方工作区块（WorkspaceBrowser）列出引擎会话，点击经 sessions.open 反向同步
