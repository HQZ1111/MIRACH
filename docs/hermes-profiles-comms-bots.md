# hermes 配置档案（Profile）/ 环境分离与通讯 · Bots 实现研究

> ⚠️ **存档说明**：本文为外部代码库（D:\hermes-agent-main）的调研快照，
> 仅供 mirach 演进参考；mirach 现状以 `HANDOVER.md` 与 `docs/official-internals-map.md` 为准。

> 对 `D:\hermes-agent-main`（hermes desktop + Python 引擎）的深度调研，
> 目标：弄清"配置档案/环境怎么隔离、怎么按档案分离通讯、bots 怎么实现"，
> 作为 mirach 环境系统演进的参考。文件路径均为 hermes 仓库内相对路径。

## 0. 一句话总览

- **一个 Profile = 一个完整 HERMES_HOME 目录 + 一个独立 Python 后端进程**。
  代码共享（同一份引擎安装），状态/配置/凭据/会话全部按 HERMES_HOME 隔离。
- **通讯按 (connection, profile) 二元组路由**：REST 用 `?profile=` 查询参数、
  WebSocket 用"网关注册表条目（connectionId + profile）"定位目标后端；
  Electron 主进程是所有本地后端进程的生成器与路由器。
- **一个 Bot = 一个 Profile 的前端人格化**：roster 行就是 profile 行；
  群聊 = 多 profile 的回合编排；桌面端只做渲染与路由，工作全部在引擎进程。

## 1. Profile 模型与磁盘布局

| 项 | 位置/形态 | 说明 |
|---|---|---|
| 根 HERMES_HOME | `~/.hermes`（`main.ts: resolveHermesHome`，可被 env/注册表覆盖） | 唯一用户级根；`default` profile 就是它本身 |
| 命名 profile | `~/.hermes/profiles/<name>/` | `normalizeHermesHomeRoot`：父目录名是 `profiles` 就上跳——profile 目录即完整 HERMES_HOME |
| 每档案配置 | `<home>/config.yaml`、`profile.yaml`（display_name、角色）、`SOUL.md`（persona） | profile.yaml 存展示名/角色；SOUL.md 存人格与代理通讯协议 |
| 每档案状态 | `hermes_state_*.py` 系列管理的 SQLite（sessions/usage/fts/WAL…） | 会话、压缩谱系、ui_meta、凭据全部按家目录隔离 |
| 每 profile 的 venv | `venvRoot/(Scripts|bin)`（backend-env.ts 拼进 PATH） | 允许档案间依赖差异 |
| 托管 Node | `$HERMES_HOME/node[/bin]`（backend-env.ts，与 `hermes_constants.py: iter_hermes_node_dirs()` 镜像） | 桌面安装的可移植工具链 |

关键点：**隔离单位是"家目录 + 进程"**，不是容器也不是线程级命名空间。
切换 profile = 换一个 HERMES_HOME 再起一个后端进程；两个 profile 的
config/env/skills/凭据/会话物理上不可能互相污染。

## 2. 后端进程池（Electron 主进程）

- `main.ts` 按需 spawn `hermes` 子进程：**显式 pin `HERMES_HOME` env**
  （"so Python's get_hermes_home() resolves like `hermes -p <name>`"），
  附加 `backend-env.ts` 的 PATH/PYTHONPATH/PYTHONUTF8=1 组合。
- **端口宣告**：子进程启动后宣告自己的端口（`portAnnouncement` race
  `startFailed`），主进程记入连接注册表（connection-registry.ts）。
  因此不存在固定端口表——**端口号是进程的属性，不是配置**。
- **进程池治理**：`pool-spawn-coordinator.ts` 限制同时启动/运行的本地
  profile 后端数；`pool-eviction.ts` + `scale_to_zero.py` 空闲回收；
  `pool-stop.ts`/`backend-ownership.ts` 防止两个子进程共享同一个
  （可能正在死掉的）HERMES_HOME；`pool-touch-scope.ts` 按"有活干的
  profile 集合"续命（活跃 profile 永不回收）。
- 主后端（primary）与次级后端（secondary/background profile）唯一的差别是
  谁的 socket 被标为 active——进程模型完全一致。

## 3. 通讯分层（renderer ↔ 后端）

三层通道，全部按 (connection, profile) 定位：

1. **REST `/api/*`**（api/client.ts）
   - profile 作用域 = `setApiRequestProfile()` 写入的 `_apiProfile`，
     以 `?profile=` 附加到请求；Electron 主进程把 `request.profile` 当作
     请求作用域路由：本地调用的 REST handler 支持 profile 的走
     `?profile=`，不支持的重定向到该 profile 的后端进程。
   - **`profileScoped(profile?)` / `profileScopeKey(scope)`**：能力面
     （config/env/skills/tools/model）的缓存键是 `connectionId::profile`
     ——**profile 不是机器全局名**，它属于某一个 gateway/连接。
2. **WebSocket JSON-RPC 网关**（tui_gateway/ws.py + server.py）
   - 线协议 = 新行分隔的 JSON-RPC（与 stdio 传输同构），`gateway.ready`
     握手，服务端推送走 `event` method。
   - **socket 池**（store/gateway.ts + connection-registry）：常驻一个
     primary socket（跟随 $activeGatewayProfile）；打开/发送不同 profile
     的会话时惰性切换或开 secondary socket（后台 profile 视图）；
     **keep-set 重算**：有进行中/需输入会话的 profile + 活跃 profile 免于
     回收，其余 socket 断开后端可被 idle-reap。
   - 注册表是路由权威：`onActiveRouteChanged` 把 active 路由镜像进
     `$activeGatewayProfile`，"profile 删除/连接移除/回收"等驱逐回退
     不能让 atom 指向一个 socket 已经不服务的 profile（#89206）。
3. **Electron IPC**（desktop.profile / connections / fs / git / terminal）
   - 档案偏好存在主进程（`window.hermesDesktop.profile.set`）→ 主进程
     换 HERMES_HOME 重启后端 → 窗口 reload；`adoptPrimaryProfile` 在
     boot/softSwitch 时对齐 `$activeGatewayProfile`。

### 跨后端一致性三件套（值得抄）

- **epoch 失配作废**：`profileListEpoch` 在每次后端切换时 +1；在途 fetch
  返回时 epoch 不匹配就丢弃写缓存（"防过去的数据"），单飞（single-flight）
  插槽同时作废，避免新请求搭旧后端的在途重试链（#85731/#70679）。
- **CAS 修订号**：`ui_meta_revisions` 每 key 一个版本号，
  profiles.configure 按 compare-and-swap 合并写。
- **回合锁 + 尝试上限**：bot_relay.deliver 每 profile 一把回合锁，
  客户端容忍 ~1320s 的长回合，超时才判失败（#93091）。

## 4. Profile 切换 / 软切换（softSwitch）

- `switchProfile(name)`：乐观更新 pill → 主进程 `profile.set` → 后端重启 +
  窗口 reload（正常情况下调用不返回）。
- **softSwitch**（连接切换，不重启窗口）：`adoptPrimaryProfile` 先落
  （session scope 依赖它）→ `refreshActiveProfile()` 刷新档案列表（不 await）
  → 其余拉取并发；切换时 `invalidateProfileListFetches()` + 各 scoped
  query 失效（`invalidateProfileScopedQueries`）。
- 助手窗口（HUD）可带 `windowProfileOverride`，钉在某个 profile 的后端上，
  不随主窗口软切换漂移。

## 5. Bots 的实现

### 5.1 Bot = Profile 的人格化

- `plugins/hermes-bots/types.ts`：**RosterRow 就是 profile 行**（name/
  display_name/title/role/last_session…）。创建一个 bot = 创建一个
  profile（`profiles.create`：镜像启动凭据、继承启动模型、生成 SOUL.md
  persona），bot 的"性格/能力"全部落在该 profile 的 config/profile.yaml/
  SOUL.md/skills 里。
- **roster 行的三个来源**：活跃 gateway 的富 `profiles.list` 行；其他已注册
  连接的瘦 `host.agents()` 行；离线"ghost"孪生行（保持可见不消失）。
  字段全部 optional——老网关会整字段缺失。
- **Bot Chat（canonical forever-chat）**：每个 bot 有且只有一个标题恰为
  "Bot Chat"的会话，由服务端按标题解析并随 roster 行下发；**故意不存
  session-id 指针**（AGENTS.md），靠 `resolved_id`（压缩谱系 tip）跨压缩
  稳定。

### 5.2 展示状态与资产

- `BotMeta`（section/color/avatar/groups/pinned/hidden）持久化在
  **profile 的 `ui_meta`**，走 `profiles.configure`（CAS 修订号）；头像
  数据 URL 走 `set_asset`（configure 前剥离）——**presentation 状态跟随
  profile 走机器**，成员关系记在 bot 身上而非 section 身上（删除 section
  不会孤儿任何 bot）。

### 5.3 群聊与跨网关投递

- 群聊 = hosted room：多个 profile 的 bot 在一个房间协作
  （gateway/hosted_rooms*.py + methods_groups.py），group-hold-status
  管"谁在等谁"。
- **bot_relay**（methods_bot_relay.py + tools/bot_relay.py）：跨网关投递——
  `bot_relay.roster.sync`（写远端名册）、`outbox.drain`（取信封）、
  `deliver`（目标网关执行回合：acquire_turn_lock → 跑 → 回信）、
  `reply`（写回信）——文件式中继根 + 回合锁 + 尝试上限，让"远程连接上的
  bot"与本地 bot 在同一 roster 里协作。

### 5.4 桌面端角色（plugin.tsx）

- 插件只做：注册 panes（roster 名册、routines 定时）、聊天空态脸
  （BotChatEmpty + Wordmark 显示 bot 名）、palette 项、i18n、头像时钟、
  会话清扫调度——**一切工作经 RPC 落在引擎**，桌面端是渲染器/路由器。

### 5.5 新建任务页（Intro）的风格参考

- `components/chat/intro.tsx` + `wordmark.tsx`：`Wordmark('HERMES AGENT')`
  = 超大宽度自适应纯文字（`.fit-text` 容器查询 + aria-hidden 双胞胎做宽度
  基准，`text-midground`），下面一行 muted 随机文案（按人格 pick）。无图标、
  无徽章。mirach 的 hero 覆盖（index.css：MIRACH HARNESS 字标）即按此风格。

## 6. 对 mirach 的映射建议（速记）

- mirach 的"环境"概念 ≈ profile：按 HERMES_HOME 模式隔离即可（目录级），
  进程按需 spawn + 空闲回收不必常驻。
- "环境间通讯分离"用 (connectionId, profile) 二元组 + 查询参数路由，
  缓存键 `connectionId::profile`，配 epoch 失配作废。
- "成员/bots"若要演进：把每个成员映射到一个独立环境（profile），
  名册行 = 环境行，presentation 状态放环境自身（ui_meta + CAS），
  群聊走回合锁编排。
