# 官方协议耦合面清单（dsh 升级检查表）

> 用途：dsh 官方（引擎/客户端包/插件系统）发大版本时，照此清单逐项回归。
> 原则：mirach 主体是"免费跟随"——官方 client 包自消化协议；手写面集中在
> sidecar 与装配层，官方改协议时按下表跟改。
>
> 最后盘点：2026-09-02（设置页四连环修复 + dsh-pocket 接入之后）。

## 一、免费跟随层（官方改协议 → 升级官方包版本即可）

| 层 | 说明 |
|---|---|
| 前端内核全部官方 client 包 | `src/dsh-kernel/boot.ts` 顶部 30+ 个 `@deepseek-ai/dsh-client-*/client` import：连接/鉴权/typert 反射/会话/设置分区/词典全在官方包内消化 |
| stdio JSON-RPC 面 | `agent-sidecar/src/dsh.ts` 经 `@deepseek-ai/dsh-sdk-client`：spawn/握手(initialize/provider/model)/prompt/teardown 全类型化 |
| 插件 client bundle | 酒馆/dsh-pocket 的 UI 部分自包含（只依赖 react + ui-primitives） |
| 官方设置分区渲染本体 | mini 渲染器只读槽位 ledger，不碰 wire |

## 二、手写协议层（官方改动 → 必须跟改）

### 1. typert remote web 面 wire（最核心）
- `agent-sidecar/src/rpc-http.ts`：`POST {base}/api/<ns>/<method>`；信封
  `{type:"client-request", rpcId, method, payload:{args}}`；响应
  `envelope.result.{ok,value,error}`
- `agent-sidecar/src/index.ts` `adaptRpcArgs` 参数形状表：单对象参数 = `request`、
  无参 = `_request:{}`、`commands.execute = {agentId,line,images}`、
  `goals = {agentId,ref,request?}`、`agentPresets = {agentId,agentPreset}`；
  `remoteCallAny` 依赖错误码含 "arguments/missing/unexpected" 做回退
- 官方改动症状：404 / protocol/invalid / 参数校验 400

### 2. 鉴权 cookie 铸造（唯一实现）
- `shared/dsh-auth.cjs`：cookie 名 `dsh-auth-+base64url(sha256(authority))`、
  值 `v1.<base64url(payload)>.<HMAC>`、secret 读 `~/.mirach/.credentials.yaml`
  的 `client-connection/browser-session` 记录、30 天有效期
- 官方改动症状：401 unauthorized（设置页数据全空、remote.mux WS 握手失败）

### 3. 存储直读（历史回放）
- `agent-sidecar/src/history.ts`：会话目录布局
  `<DSH_HOME>/sessions/<cwd编码>/<sessionId>/session.jsonl.zstd|.jsonl`、
  多帧 zstd 手工切帧（magic `28 B5 2F FD`）
- `agent-sidecar/src/chunk-rows.ts`：官方 chunk-rows decode 半边的移植副本
  （text/reasoning/tool-chunks、`seq0/time0/dt`、`surfaceOp/sourceEventSeqs`）
- 官方改动症状：历史会话空白/乱码（不影响实时对话）

### 4. bundle 装载 shim 与插件清单
- `src/dsh-kernel/module-loader-shim.ts`：`__ModuleLoader__.load({id,factory})`
  契约、bundle id = 去掉 `/client` 后缀的包名、平台外部依赖表
  （cordis/client-store/ui-slots/ui-primitives/react/jsx-runtime/react-dom/clsx）
- `boot.ts` KERNEL_PLUGINS：40 个官方 bundle id 清单 + 激活顺序
  （**typert 必须先于 session-controller**，后者 inject 依赖 typert）
- 社区插件侧载：`vite.config.ts` 别名（dsh-tavern/dsh-pocket 的 client bundle
  绝对路径）+ `boot.ts` 侧载 apply；引擎侧 = `~/.mirach/profiles/mirach`
  的 package.json 依赖 + `dsh.profile.bundles`
- 官方改动症状：内核 boot 失败（sidecar 管道兜底）/ 插件分区消失

### 5. 进程装配与 env 契约
- `agent-sidecar/src/dsh.ts`：`%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js --profile <name>`；
  env：`DSH_CWD/DSH_SESSION_ROOT/DSH_SYSTEM_PROMPT/DSH_LLM_PROVIDERS/
  DSH_CORDIS_CONFIG/DSH_HOME/MIRACH_WEB_PORT/MIRACH_WEB_HOST/DSH_EFFORT`
- `agent-sidecar/src/runtime.ts`：profile 探测（`profiles/<name>/package.json`
  存在 = profile 模式）；sessionRoot = `<DSH_HOME>/sessions`
- 引擎 profile 补丁层：`~/.mirach/profiles/mirach/cordis.patch.yml` 的
  `!!js` 表达式读 `DSH_LLM_PROVIDERS/DSH_EFFORT`（改 env 名需同步改 yaml）
- 官方改动症状：引擎起不来 / 配置静默失效（看 sidecar 日志）

### 6. 文本/错误码启发式（静默降级，不致断）
- `index.ts`：id collision 检测匹配官方错误文案 `persisted log|id collision`；
  `remoteCallAny` 参数错误回退匹配 `arguments|missing|unexpected`
- 官方措辞变化 → 失去自动重试/换 id（单次操作报错）

### 7. 事件/形状手取
- `index.ts`：HarnessNotification 方法名（`subagent.started/finished`、
  `session.event`、`session.status`、`question/requested`）与 SessionEvent
  字段（`params.event.{seq,type,time,data}`、`turn/end` 的 `reason.kind`）
- `boot.ts`：usage 抽取（`assistant/message` 的 `data.usage`、
  `assistant/chunk` 的 `chunk.type==="usage"`）；sessions 服务最小形状
  （`refresh/open/binding/list/eventSource/projections.faceOf("goal")`）
- 官方改动症状：事件镜像断（sidecar 管道兜底）/ 用量统计为 0 / 提问卡不弹

### 8. vite 代理与栅栏补齐
- `vite.config.ts`：`/api` 与 `/dsh-pocket` 两通道 → 核心-web 面；补
  `Origin: core` + `Cookie: dsh-auth-...`（信任栅栏要求 Origin===Host）
- 官方改动症状：dev 期内核连接 401/404（设置页空数据）

## 三、mirach 自有协议层（与官方无关）

- Tauri ↔ sidecar：stdin/stdout JSONL（`ready/event/result/done/error` 信封，
  `src-tauri/src/dsh_relay.rs`）
- 旧 hermes 遗留通道：`relay.rs`（8787 `/v1/rpc`）、`relay_cron.rs`（8090
  `/api/jobs`）——非 dsh 官方，升级 dsh 不影响

## 四、升级回归清单（照做）

1. `pnpm --filter mirach exec tsc --noEmit`（前端类型）
2. 启动应用 → 控制台确认无 `[dsh-kernel] ctx.sessions missing`、
   无 `slot declarations failed`、无 `Maximum update depth`
3. 设置页：五分区 + 手机访问 + 酒馆管理齐全、可切换、文案中文、无
   "官方项暂不可用"降级
4. 对话：发送/回复/事件镜像/用量统计正常
5. 历史会话：旧会话可打开（存储直读未破坏）
6. 手机访问：局域网二维码出现、密码可刷新
7. 若 401：查 shared/dsh-auth.cjs（对照官方 browser-auth.ts 新版）
8. 若 404：查 wire 端点/信封（rpc-http.ts + adaptRpcArgs）
