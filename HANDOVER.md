# Mirach — DSH 桌面版交接文档

## 第二十四批：hermes 功能批量移植 + 官方工作区切换器 + 收敛 dsh 单核心

- **hermes 功能批量移植**（源 D:\hermes-agent-main，均做成 mirach 自有组件/插件）：
  - 唤醒词插件（`plugins/plugin-wake-word.ts`，默认短语 "hey hermes"，Composer 唤醒按钮右键换短语，连续检测 one-shot 触发）
  - 提示音系统插件（`plugins/plugin-sound-cues.ts`，WebAudio 合成 14 种完成音变体 + 思考音/唤醒音，顶栏触感开关 = 总静音）
  - 语音对话补全（`lib/speech-text.ts` 句子切分 + `lib/voice-playback.ts` TTS 管线 + `lib/voice-stop-word.ts` 中文停止词；回复完自动朗读）
  - 快捷键系统（`lib/keybinds/` + `hooks/useKeybinds.ts` + `store/keybinds.ts`，hermes combo/capture/conflicts 全套，设置页可改键）
  - 抓取滚动（`hooks/useGrabScroll.ts`）+ 会话星图（`components/starmap/`，d3-force 力导渲染管线完整移植）
  - 通知中心（`components/notifications.tsx` + `store/notifications.ts`，TopCenter/BottomRight 栈，替代旧 Toaster）
  - 国产内嵌卡片（`components/chat/markdown/embeds/`：哔哩哔哩/网易云/高德/抖音/红果短剧 + 同意卡）
  - HUD 悬浮窗（`components/hud/` + Tauri `hud_*` 命令：透明置顶小窗、拖动/八向缩放/点击穿透）
  - 会话环境隔离（`lib/session-env.ts` `$sessionEnvIndex`：引擎 `envId::sessionId` 映射驱动，非客户端过滤）
  - 主人格命名跟随环境（`store/agents.ts` ENV_PRIMARY_SEEDS：Mirach / Mirach chat / code / work / finance / write）
- **侧栏工作区切换器替换为官方组件**：dsh ui-workspace 的 WorkspaceBrowser 整块
  经 `sidebar.workspaces` 槽位渲染（列表/添加/重命名/删除/排序/视图选项），mirach
  搜索/置顶/成员标签原样保留。
- **收敛 dsh 单核心**：删除 `acp.rs`（hermes ACP 边车，从未激活）与 `relay_cron.rs`
  （8090 /api/jobs，已被 dsh schedule 插件取代）；`relay.rs` 只留 `relay_probe`
  （供应商端点探测，与引擎无关）；AppConfig 去掉 engineBase/apiBase/apiToken/hermesBin；
  client.ts 移除 ping/submitPrompt(整段)/skills/cron/runCommand/getAuthStatus 等死面，
  getModels 改走 sidecar catalog；命令面板引擎命令改道 nativeExecuteCommand
  （dsh commands.execute）；快捷入口改走 submitPromptStream；会话转发改本地追加；
  JobsOverlay 改 dsh_rpc 透传。`更新dsh核心.bat` 删除（引擎更新只有 npm alpha 通道）。

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
 │   └─ src/dsh-kernel/boot.ts → 内核加载官方 client 栈（KERNEL_PLUGINS 46 bundle）+ dsh-tavern
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
- NSFW：插件自带开关在原生面板里可用；
### 基础设施
- 引擎 npm 全局安装（更新 = npm i -g @deepseek-ai/dsh@alpha + 重启）
- 内核加载完整官方 client 栈（KERNEL_PLUGINS 46 bundle：连接/gateway/remotes/session-controller/workspace-controller + 全套 client UI 包（renderer/locale/settings 及分区包/session/workspace/theme/layout/sidebar/conversation/chat/tool/attachment/reference/brand-official + 输入框/对话区/能力包/定时/目录选择器栈）；酒馆与 dsh-pocket 经 apply 侧载）
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
| `dsh-kernel/sidebar-shell.tsx` | mirach 侧栏外壳（官方 WorkspaceBrowser 经 sidebar.workspaces 槽位渲染） |
| `dsh-kernel/composer-extras.tsx` | Composer 附加件（听写/朗读/唤醒/模型选型，官方 input 槽位注入） |
| `dsh-kernel/module-loader-shim.ts` | __ModuleLoader__ shim（收集 factory，PLATFORM 种子表） |
| `dsh-kernel/adapter.ts` | sidecar adapter 本地副本（pi→MirachEvent 转换） |
| `dsh-kernel/dsh-bridge.ts` | 内核事件桥（boundSid 会话绑定 + 后台簿记） |
| `plugins/plugin-wake-word.ts` | 唤醒词插件（连续检测，one-shot 触发听写） |
| `plugins/plugin-sound-cues.ts` | 提示音插件（WebAudio 合成，14 完成音变体 + 思考/唤醒音） |
| `components/hud/` | HUD 悬浮窗（聚光灯外壳/拖动/缩放/点击穿透/线程聚焦） |
| `components/starmap/` | 会话星图（d3-force 移植管线 + 时间轴 + 分享码） |
| `components/notifications.tsx` | 通知中心（TopCenter/BottomRight 栈 + 桌面通知桥） |
| `lib/keybinds/` + `hooks/useKeybinds.ts` + `store/keybinds.ts` | 快捷键系统（combo/capture/conflicts + 全局监听分发） |
| `lib/session-env.ts` | 会话环境索引（引擎 envId::sessionId 映射驱动） |
| `lib/voice-playback.ts` + `lib/speech-text.ts` + `lib/voice-stop-word.ts` | 语音朗读管线（句子切分 TTS + 中文停止词） |
| `lib/voice-dictation.ts` | 语音听写（Web Speech API，IME 守卫） |
| `components/chat/markdown/embeds/` | 国产内嵌卡片（bilibili/ncm/amap/douyin/hongguo + 同意卡） |
| `store/chat-events.ts` | 统一事件处理器（sidecar/内核双管道共用，background 模式） |
| `store/agent.ts` | busy 分桶（$busyMap 按会话，$agentBusy=computed 任一忙） |
| `store/engine-session.ts` | bindEngineSession（set_env + load_session 两连） |
| `store/environments.ts` | 环境分片（SEED_ENV_IDS 内置不可删） |
| `store/agents.ts` | 智能体团队（按环境分片读写 + ENV_PRIMARY_SEEDS 主人格 + upsertTavernMember） |
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
| `hooks/useGrabScroll.ts` | 抓取滚动（hermes 原样移植） |

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
| `dsh_relay.rs` | sidecar 管理（spawn/重启循环防护/命令透传），唯一引擎通道 |
| `lib.rs` | 主入口（配置/终端/git/文件/浏览器/手机接入 web_host/HUD/多窗口） |
| `relay.rs` | 仅 `relay_probe`（供应商端点探测，与引擎无关） |
| `sessions.rs` | 会话检索（FTS5 / 快照降级） |

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
1. **dsh 风格完整官方 ChatView 渲染**：内核已加载全部 46 个官方 bundle；chatStyle=dsh 已由 NativeChatArea 直挂官方 ConversationRoot 树。剩余为官方会话数据接通后的完整体验对齐（对齐后 dsh 风格 = 官方对话区完整体验 + 自动跟随更新）。
2. **群聊增强**：状态栏卡片/剧情选项按钮在群聊已生效，但群聊上下文靠 prompt 注入最近 12 条（各成员保有自己会话记忆）。
3. **手机端**：设置 → 手机接入 → 开开关 → 重启 → 扫码即用。已用插件实现。
4. **dsh-agent-rp**：npm 上不存在（404），待用户提供来源。
5. **定时任务 envId 隔离**：当前是命名约定（[envId] 前缀），字段级隔离需引擎支持。
6. **成员模板导入导出**：已有团队导出/导入 JSON，成员级细粒度待做。

### 已知限制
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
