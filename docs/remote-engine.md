# 远程引擎（SSH 模式）

mirach 的两种"远程"里，本方案选的是**远程引擎**（本地只做壳）：引擎跑在远端
主机上，本地是它的客户端。终端型 SSH（本地引擎 + 连远端终端）不在此列。

## 架构

```
本地 Mirach（Tauri + React）                      远端主机
┌──────────────────────────┐                 ┌──────────────────────────────┐
│ Rust 中继                │  ssh -T host    │ agent-sidecar（Node）        │
│  └─ spawn: ssh ──────────┼────────────────▶│  ├─ dsh 引擎子进程（stdio）  │
│     （JSONL 走 stdin/out）│  JSONL/stdin    │  ├─ 引擎 web 面 127.0.0.1:3212│
│ 前端内核（官方 client 栈）│                 │  │   （/api、remote.mux）    │
│  └─ dsh_http_proxy ──────┼────────────────▶│  └─ 会话/记忆/工具执行       │
└──────────────────────────┘                 └──────────────────────────────┘
```

关键点：**只把 sidecar 子进程换成 ssh**。协议（JSONL）直接跑在 ssh 的
stdin/stdout 上；引擎的 stdio、web 面（内核的 HTTP 代理与 Remote 流）都在远端
sidecar 内部完成，**不需要任何端口转发**。

## 远端准备

1. Node ≥ 22.23.2（`node --version` 可跑）。
2. agent-sidecar 目录（至少 `dist/`、`package.json`、`config/`、`node_modules/`）：
   最省事的做法是把**便携包**解压到远端，直接用
   `<解压目录>/runtime/agent-sidecar/dist/index.js`。
3. 全局引擎：`npm i -g @deepseek-ai/dsh@alpha`（sidecar 启动时会用它）。
4. SSH 免密登录（`ssh-copy-id` 或把公钥加到远端 `~/.ssh/authorized_keys`）。
   远程模式用 `-o BatchMode=yes`，**不会弹密码提示**——没配好免密会直接连接失败。

## 本地配置

设置 → 通用 → **远程引擎（SSH）**：

| 字段 | 说明 |
|---|---|
| 开启 | 打开后重启引擎连接生效 |
| user@host | SSH 目标 |
| 端口 | 默认 22 |
| 远端 node | 默认 `node`（走远端 PATH） |
| SSH 私钥 | 可选，对应 `ssh -i` |
| 远端 sidecar 入口 | `…/agent-sidecar/dist/index.js` 绝对路径 |

按钮：
- **测试连接**：跑 `ssh … <node> --version`，验证免密与 Node。
- **重启引擎连接**：杀掉本地 ssh 子进程，supervisor 按新配置重新拉起。

等价环境变量（便于脚本化）：`MIRACH_REMOTE=1`、`MIRACH_REMOTE_HOST`、
`MIRACH_REMOTE_PORT`、`MIRACH_REMOTE_NODE`、`MIRACH_REMOTE_SIDECAR`、
`MIRACH_REMOTE_IDENTITY`。

## 行为差异（远程模式）

| 能力 | 位置 |
|---|---|
| 对话、工具执行、会话/记忆/产物 | **远端**（引擎所在机器） |
| 引擎 web 面（含"手机接入"） | 远端 |
| 文件浏览器 / 预览 / 终端 / git 审查 | **本地**（Rust 命令仍是本机路径） |
| 应用配置、API Key、更新 | 本地 |

也就是说：agent 在远端工作区里干活，本地那几个面板看的是本机磁盘——这是当前
实现的已知边界（见 `docs/official-adoption.md` 的后续项）。

## 排错

- 应用里"引擎未连接"且日志有 `remote sidecar: ssh …`：先点**测试连接**。
- `Connection refused` / `Permission denied`：免密或端口/主机名问题。
- 远端 `Cannot find module …`：`remoteSidecar` 指向的不是 sidecar 入口，
  或远端 node_modules 没一起部署。
- 切回本地：关掉开关 → 重启引擎连接。
