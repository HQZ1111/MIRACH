# Mirach Desktop（奎木狼）锛圖SH 妗岄潰鐗堬級浜ゆ帴鏂囨。

> 鏈€鍚庢洿鏂帮細2026-08-27
> 浠撳簱锛歚G:\mirach`锛圙itee: HANQINGZHOU/mirach锛?
> 寮曟搸锛欴eepSeek Harness `D:\deepseek-harness-master`锛坉sh锛?

## 1. 椤圭洰鏄粈涔?

Mirach Desktop（奎木狼） 鏄竴涓?**Tauri 2 + React 19** 妗岄潰搴旂敤锛?*瀹屽叏浠?dsh锛圖eepSeek Harness锛夊紩鎿庝负鏍稿績**鐨勭湡瀹炲璇濆鎴风銆?
娌℃湁鐙珛 hermes 鍚庣 鈥斺€?瀵硅瘽/鎬濊€?宸ュ叿/瀛愪唬鐞?鎻愰棶/鍙嶉鍏ㄩ儴鐢?dsh 寮曟搸椹卞姩銆?

- 鍓嶇锛歊eact + nanostores锛坄src/`锛夛紝涓夌瀵硅瘽椋庢牸锛坉efault / dsh / minimal-zosma锛?
- 涓户锛歚agent-sidecar/`锛圢ode 22 + tsx锛宻tdin/stdout JSONL 鍗忚锛?
- 鍘熺敓灞傦細`src-tauri/`锛圧ust锛宻pawn sidecar + 鍛戒护杞彂锛?
- 寮曟搸锛歞sh runtime 瀛愯繘绋嬶紙sdk JSON-RPC 閫氶亾锛宻idecar 鐢?`node --import tsx` 鐩存帴璺?dsh 婧愮爜锛?

## 2. 鏋舵瀯涓庢暟鎹祦

```
React UI 鈹€鈹€invoke鈹€鈹€> Rust (tauri command) 鈹€鈹€JSONL stdin鈹€鈹€> sidecar (node)
   ^                                                     鈹?
   鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ pi 浜嬩欢娴?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                                     鈹?session.run(msg) / client.request(rpc)
                                     鈻?
                          dsh runtime 瀛愯繘绋嬶紙D:\deepseek-harness-master锛?
```

- **娑堟伅娴?*锛欳omposer 鍙戦€?鈫?`send_prompt`锛圱auri Channel锛夆啋 sidecar 闃熷垪涓茶 鈫?runtime `session.run` 鈫?`session.event` 鈫?adapter 閫傞厤鎴?pi 浜嬩欢 鈫?鍓嶇 store
- **浼氳瘽**锛氬墠绔細璇?id 鈫?sidecar `sessionMap` 鏄犲皠涓?dsh 浼氳瘽 id锛坄dsh-{frontendId}-{rand8}`锛岄伩鍏嶇鐩樻棩蹇?id 鍐茬獊锛夛紱閲嶅惎/鍒囦細璇濈敤 `get_history` 鍥炴斁 `%USERPROFILE%\.hermes\dsh-sessions`
- **宸ュ叿**锛歳untime `tool/call` 閫氱煡锛堝畬鏁村弬鏁帮級鈫?`tool_execution_start` 鈫?鍓嶇 `$toolCalls` 鈫?DshToolRow锛坉sh 椋庢牸锛?
- **寮曟搸鎻愰棶**锛歳untime `ask_user_question` 宸ュ叿 鈫?sdk server 妗ユ帴鍙?`question/requested` notification 鈫?sidecar 杞彂 鈫?鍓嶇鎻愰棶鍗?鈫?鍥炵瓟缁?`question/resolve` RPC 鍥炰紶鎭㈠寮曟搸
- **鍙嶉涓婃姤**锛氱偣"鏈夊府鍔?娌″府鍔? 鈫?`messageFeedback.put`锛堢粡閫氱敤 remote 鍒嗗彂锛夆啋 runtime storage锛坄~/.hermes/dsh-sessions/storage`锛?
- **鎺ㄧ悊寮哄害**锛歚dsh_set_effort` 鈫?鏀?cordis.yml 鐨?`llm-deepseek.reasoningEffort`锛岄噸鍚?runtime 鐢熸晥
- **妯″瀷/鍑嵁**锛氱幆澧冨彉閲?`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`锛坰etx 鎸佷箙鍖栵級锛涜缃〉 providerConfig 缁?`DSH_LLM_PROVIDERS` env 娉ㄥ叆 llm-pi-ai

## 3. 杩愯鏂瑰紡锛堥噸瑕侊級

闇€瑕佸畬鏁寸幆澧冨彉閲忥紙sidecar 渚濊禆锛夛細

```bat
set VITE_MOCK=0
set DSH_HARNESS_ROOT=D:\deepseek-harness-master
set DSH_NODE_BIN=D:\node.exe
set NODE_22_BIN=D:\node.exe
set DEEPSEEK_API_KEY=sk_tr_ftCIa7Y...
set DEEPSEEK_BASE_URL=https://tokenrhythm.studio/v1
npm run tauri dev
```

- 鍚姩瀵嗙爜锛歚test1234`锛堣缃?鈫?瀹夊叏锛泈ebview localStorage锛?
- 妯″瀷锛歚deepseek-v4-flash-0731`锛堥粯璁わ級
- **涓嶈**鐢?`taskkill /F /IM msedgewebview2.exe` 鏉€ webview锛堜細鎹熷潖 WebView2 profile 瀵艰嚧鐣岄潰绌虹櫧锛涙竻 `%LOCALAPPDATA%\com.hanqingzhou.mirach（原 my-hermes-rs）\EBWebView` 鍙仮澶嶏紝鏃ф暟鎹浠藉湪 `EBWebView.bak-20260822`锛?

## 4. 宸插畬鎴愬姛鑳?

- 鉁?鐪熷疄 dsh 瀵硅瘽锛堟€濊€?鏂囨湰/宸ュ叿璋冪敤/瀛愪唬鐞?usage/todo/compaction 浜嬩欢鍏ㄩ摼璺級
- 鉁?涓夌瀵硅瘽椋庢牸锛歞efault锛堟皵娉★級銆乨sh锛堢揣鍑戣寮?+ ReasoningRow/DshToolRow/CompactionRow锛夈€乵inimal锛坺osma 缁勪欢鏍戯級
- 鉁?浼氳瘽锛氭柊寤猴紙dsh 璇箟锛氱┖鐧藉鐢ㄤ笉鍫嗙Н锛夈€佸巻鍙叉寔涔呭寲鍥炴斁銆佸垪琛ㄩ殣钘忕┖鐧戒細璇濄€丆trl+N / Ctrl+]
- 鉁?寮曟搸鎻愰棶锛歛sk_user_question 鈫?鎻愰棶鍗?鈫?鍥炵瓟鍥炰紶鎭㈠锛堝叏闂幆瀹炴祴锛?
- 鉁?鍙嶉涓婃姤寮曟搸锛坢essageFeedback.put + storage 钀界洏锛沀I 鏈夋垚鍔?澶辫触鎻愮ず锛?
- 鉁?鎺ㄧ悊寮哄害鎺у埗锛坋ffort锛夈€佺敤閲忕粺璁★紙token-meter锛夈€侀噸璇曟潯锛堢湡閿欒鎵嶆樉绀猴級
- 鉁?Workflow 宸ヤ綔娴侊紙cordis 鎻掍欢鍚敤锛歸orkflow-worker-thread + tool-workflow锛?
- 鉁?闄勪欢锛氭枃鏈被鏂囦欢鍐呭骞跺叆 prompt锛涘浘鐗?dataUrl
- 鉁?浜у嚭鏂囦欢 chips锛堜粠宸ュ叿鍙傛暟 file_path 鎻愬彇锛?
- 鉁?瀛愪唬鐞嗕簨浠?鈫?鐘舵€侀潰鏉匡紱todo 宸ュ叿 鈫?寰呭姙 store

## 5. 寮曟搸渚ф敼鍔紙D:\deepseek-harness-master锛岀嫭绔嬩粨搴擄紝涓嶅湪 Gitee 鎺ㄩ€侀噷锛?

`packages/sdk/server/`锛?
1. `src/index.ts`锛歚inject` 琛?`userQuestions`锛坰dk-jsonrpc-server 鎻掍欢锛?
2. `src/server.ts`锛?
   - `handleRequest` 鍔?`question/resolve` case锛堢敤鎴锋彁闂洖绛旓級
   - `handleRequest` default 鍒嗘敮锛氶€氱敤 typert-remote 鍒嗗彂锛坄鏈嶅姟.鏂规硶` 濡?`messageFeedback.put`锛夆啋 璁块棶 `ctx[鏈嶅姟][鏂规硶]`
   - 鏋勯€犲嚱鏁版敞鍐?`userQuestions` provider锛坋ngine ask 鈫?notification `question/requested` 鈫?绛?resolve锛? 鍒嗛挓瓒呮椂锛?
3. `lib/index.js`锛氭墜宸ヨˉ涓侊紙鍚屾 1/2 鍒扮紪璇戜骇鐗╋紱**runtime 瀹為檯鍔犺浇 src锛坱sx锛夛紝lib 浠呴潪 tsx 鍦烘櫙鍙屼繚闄?*锛?

**娉ㄦ剰**锛氶噸鏂版瀯寤?dsh 浠撳簱锛坄npm run build:lib:host`锛変細瑕嗙洊 lib锛泃sdown 鍦ㄦ湰鏈烘棤娉曡繍琛岋紙workspace 瑙ｆ瀽鎶ラ敊锛岀幆澧冮棶棰橈級銆俿rc 鏀瑰姩鏋勫缓楠岃瘉杩囷紙`npx tsc --noEmit` 閫氳繃 sdk/server锛夈€?

## 6. sidecar 鍏抽敭璁捐

- `index.ts`锛氬懡浠ゅ垎鍙戯紙prompt/steer/follow_up/abort/clear_queue/get_models/set_model/load_session/list_sessions/set_effort/get_history/**rpc**锛夛紱`runWorker` 涓茶闃熷垪鍗曢锛沗attachNotificationBridge` 璁㈤槄 client 绾?notification锛坬uestion/requested 鈫?鍓嶇锛?
- `adapter.ts`锛歞sh `session.event` 鈫?pi 浜嬩欢锛沗tool/call` 鏄?tool_execution_start 鍞竴鏉ユ簮锛坆lock-end 涓嶅啀鍙戯紝閬垮厤閲嶅鍗＄墖 + 绌哄弬鏁拌鐩栵級锛沗lastEngineMessageId` 浠?assistant/message 鎻愬彇 鈫?message_end 甯?`engineMessageId` 鈫?鍓嶇鍙嶉 target锛沜ompaction_* 鈫?鍓嶇鍘嬬缉琛?
- `runtime.ts`锛氬姩鎬佺敓鎴?`cordis.generated.yml`锛堟ā鏉?+ llm-pi-ai + storage 閾?+ message-feedback + user-questions + tool-ask-user + workflow锛?
- sidecar stderr 鐢?Rust 杞彂鍒?tauri dev 缁堢锛坄[sidecar]` 鍓嶇紑锛涗篃閬垮厤 pipe 绉帇闃诲锛?

## 7. 娣卞害瀹℃煡涓庝慨澶嶏紙2026-08-27锛屽弻浠ｇ悊瀹℃煡 + 鑷锛?

涓や釜瀹℃煡浠ｇ悊锛堝墠绔?Py 绾?+ sidecar/Rust锛夊叏闈㈡鏌ュ悗锛屾寜鎵规淇锛堟彁浜?bb2020a / e2473fb / 9baa31c锛夛細

**鏁版嵁姝ｇ‘鎬?*
- 宸ュ叿琛屾寜娑堟伅褰掑睘锛氬疄鏃舵祦宸ュ叿缁戝畾褰撳墠 AI 娑堟伅锛坢essageId锛夛紝鍘嗗彶鍥炴斁鐏屽叆 store 鈥斺€?涓嶅啀鍏ㄥ爢棣栨潯娑堟伅銆佸洖鏀句篃鍙宸ュ叿
- 娴佸紡璺ㄤ細璇濇薄鏌擄細浜嬩欢鎸夊彂閫佹椂浼氳瘽闂ㄦ帶銆佸巻鍙查噸鏀捐姹傚簭鍙枫€佸乏鏍忓弻璺緞锛坙oadSession vs dsh_get_history锛夌粺涓€鍒?MainPanel
- Stop 鍚庤繜鍒?complete 涓嶅啀瑕嗙洊鍗婃垚鍝侊紙finalizedIds 瀹堝崼锛?
- 瀛愪唬鐞?finished 鎸?engineId 鍖归厤锛堜笉鍐嶆案杩?running锛?

**绋冲畾鎬э紙鍚庣锛?*
- abort 闃熷垪鍋滄憜锛氱珛鍗虫竻闃熷垪琛ュ彂鏀跺熬 + worker 閫€鍑虹画璺戯紙P0锛?
- runtime 宕╂簝鑷姩閲嶅惎锛坱ransport closed 閲嶅缓閲嶈瘯涓€娆★級
- sidecar 宕╂簝 Rust 鑷姩閲嶅缓锛堝惊鐜?respawn + ready 淇″皝缃綅 + pending 鍏ㄦ竻锛?
- 浼氳瘽缁亰锛歴essionMap 鎸佷箙鍖栧埌 `~/.hermes/dsh-sessions/session-map.json`锛堥噸鍚鐢ㄥ悓涓€ dsh 浼氳瘽锛宑ollision 鑷姩闄嶇骇鎹?id锛?
- 浜嬩欢 runId 闃插 prompt 娣锋挱锛沺ending 琛ㄨ秴鏃舵竻鐞?+ error 淇″皝 remove + get_models 鍞竴 id
- set_effort 鐧藉悕鍗曟牎楠岋紙闃?cordis.yml 娉ㄥ叆锛夛紱rpc 瓒呮椂 workflow 绫婚槻瀹?5 鍒嗛挓

**浣撻獙/灏忛」**锛歮inimal 閲嶈瘯淇銆乻croll rAF 鑺傛祦銆丏isclosureRow 鍘婚噸锛堢粺涓€ dsh-ui 鐗堬級銆乻endHandler 娓呴檮浠躲€乵ock messageId 涓€鑷淬€乻essions 瀛楁鍏滃簳绛?

**灏氭湭鍋氾紙鍚庣画鍊欓€夛級**
- O-2 缁熶竴浜嬩欢 parser锛圧ealClient/useDSHStream/鍥炴斁涓夊妗ユ帴瑙ｆ瀽鍘婚噸 鈥斺€?澶ч噸鏋勶紝椋庨櫓楂橈紝寤鸿鐙珛浠诲姟锛?
- zstd magic 鎵弿鍒囧抚璇垽锛堜綆姒傜巼锛夛紱get_history 鍚屾鍏ㄩ噺瑙ｆ瀽闃诲锛堝ぇ浼氳瘽缂撳瓨鑰冭檻寮傛锛?
- Rust 闃诲鍐?vs 娉ㄩ噴锛坰idecar 鍗℃鏃堕樆濉?tokio worker锛?
- env 鍏ㄩ噺閫忎紶 + providerKeyEnv 娑堟瘨纰版挒锛堝畨鍏ㄩ潰鏀剁獎椤癸紝娑夊強 dsh 鍗忚锛?

## 8. 閬楃暀 / 宸茬煡闄愬埗

1. **鍙嶉 RPC 绔埌绔?*锛歛dapter鈫掑墠绔?engineId 宸查獙璇侊紱"鐐瑰嚮鈫扲PC鈫抯torage 钀界洏"鍙?UI 鑷姩鍖栭檺鍒舵湭瀹屽叏瀹炴祴锛堜唬鐮佸畬鏁达紝UI 鏈夌粨鏋滄彁绀猴紝闇€浜洪獙璇佷竴娆★級
2. **Workflow 杩愯瑙嗗浘**锛氬紩鎿?workflow 宸ュ叿鍚敤锛屽璇濆唴鏃犱笓闂ㄨ繍琛岃繘搴?UI锛堝伐鍏疯閫氱敤灞曠ず锛?
3. **鏋勫缓閾?*锛歞sh 浠撳簱 tsdown 鍦ㄦ湰鏈烘棤娉曡繍琛岋紱lib 琛ヤ竵 vs src 鍚屾闇€娉ㄦ剰
4. **zosma锛坢inimal锛夋彁闂崱**锛氬凡鎺ワ紙useDSHStream 娑堣垂 + MainPanel 灞傛覆鏌擄級锛屾湭鍦?zosma 椋庢牸瀹炴祴鐐瑰嚮鍥炵瓟
5. **闄勪欢浜岃繘鍒?*锛氬彧甯︽枃浠跺悕锛涜瑙夋ā鍨嬫帴鍏ュ悗闇€鍋?dsh attachment 鍥剧墖涓婁紶
6. **瀛愪唬鐞嗗璇濆唴璇︾粏琛?*锛坉sh ui-subagent锛夛細鍙湁鐘舵€佸崱鐗?+ 宸ュ叿琛?
7. 绌轰細璇濇暟鎹畫鐣?localStorage锛堜粎闅愯棌锛屾湭鍒犻櫎锛夛紱鏃?dsh 瀛ゅ効浼氳瘽鐩綍鍙墜鍔ㄦ竻鐞?
8. `scripts/` 涓?UI 鑷姩鍖栬剼鏈紙ui_*.ps1锛変緷璧栫獥鍙ｅ潗鏍?鍓嶅彴锛岀幆澧冧笉绋筹紝浠呰皟璇曠敤

## 9. 娴嬭瘯鑴氭湰锛坰cripts/锛?

- `dump_session.mjs`锛氳В鏋愭渶鏂?dsh 浼氳瘽鏃ュ織锛坺std 澶氬抚锛夋墦鍗?user/assistant/宸ュ叿
- `inspect_log.mjs`锛氭棩蹇椾簨浠剁骇妫€鏌ワ紙鍚?assistant 娑堟伅 id锛?
- `ui_unlock.ps1`/`ui_click.ps1`/`ui_send_test.ps1`锛歎IA 瑙ｉ攣/鐐瑰嚮/鍙戞秷鎭紙瀵嗙爜 test1234锛?
- `ui_answer_question.ps1`锛氬洖绛旀彁闂崱
- 娉ㄦ剰锛歎IA 渚濊禆绐楀彛鐘舵€侊紝榧犳爣娉ㄥ叆鍦ㄦ湰鐜涓嶇ǔ锛圛nvokePattern 鐩稿鍙潬锛?

## 10. 鐜鍑嵁锛堝嬁澶栨硠锛?

- API Key锛歚sk_tr_ftCIa7YYi-bBslizYzZBMPM5MJeMOBNVKplyzkVkaJs`
- Base URL锛歚https://tokenrhythm.studio/v1`
- 寮曟搸榛樿妯″瀷锛歚deepseek-v4-flash-0731`锛堟棤瑙嗚鑳藉姏锛?
- 鍚姩瀵嗙爜锛歚test1234`
- Gitee锛欻ANQINGZHOU/mirach锛堝嚟鎹凡缂撳瓨锛

---

# 交接清单（2026-08-30）：未完成工作与新架构迁移

## 当前架构摘要

- 引擎：dsh 0.1.0-rc.5 checkout（D:\deepseek-harness-master，pnpm 结构）+ sidecar 动态
  cordis.yml（已对齐官方 dsh-base 全树约 60 插件，含沙箱/审批/搜索/目标/查询等）。
- 双远程：Gitee https://gitee.com/HANQINGZHOU/mirach（公开，Release v0.1.0 = 便携包 2 分卷
  144MB）+ GitHub https://github.com/HQZ1111/MIRACH（公开，源码已推；Release 附件未传）。
- 官方 0.1.1-rc.2 npm CLI 已全局安装（dsh 命令）；其 web 启动有回归（自举写 flat 布局
  又自拒），待官方修复。

## 未完成工作（按优先级）

### P0 架构迁移（方向已定：Mirach 放进 dsh 包里组合，不再逐个移植）
1. 等待用户下载官方完整源码（新 zip/仓库），位置确认后：
   a. 新源码跑通 `dsh --profile web`（验证 rc.2 flat 布局 bug 是否已修）
   b. Mirach 前端构建产物接入 host-frontend-static（官方自定义前端插件）
   c. Tauri WebView 改为加载 host-webserver 地址（sidecar 常驻提供 webserver）
   d. 多环境 = 多 profile/实例（Hermes 式目录即环境，见 docs/research-isolation.md）
   e. Mirach 自制对话 UI 逐步退役（官方 ui-conversation 自带定位器/轨迹/JobPanel/
      统计/附件/审批全套）
2. 迁移期间保留现有 sidecar cordis 链路（已对齐官方 dsh-base 全树）作为回退。

### P1 功能收尾
3. GitHub Release 附件：dist-portable\Mirach-portable.zip（268MB）网页上传
   （Releases → Draft new release → tag v0.1.0）或提供 repo 权限 token 自动传。
4. dsh 社区帖：文案在聊天记录（Mirach（奎木狼）多 Agent 智能体系统介绍 +
   Gitee/GitHub 链接），发到 github.com/deepseek-ai/deepseek-harness/discussions
   （Show and tell）。
5. 画廊最终验证：文件夹大小/项目名显示/弧形居中/侧边栏联动（ResizeObserver 已修）。
6. 成员对话接引擎：成员 systemPrompt 已就位（agents store），经 set_env.systemPrompt
   注入（链路已通）；成员级独立会话（每成员一个 dsh 会话）待接。

### P2 隔离补齐（见 docs/research-isolation.md）
7. 记忆接入：mcp-memory 或 Hermes 式 MEMORY.md/USER.md（per-env root，冻结快照注入）。
8. 定时任务隔离：Rust cron 单表加 envId 列 + 按环境过滤（现状全局单表）。
9. 会话级 persona 快照（sessions 行持久化 system_prompt，resume 稳定）。
10. 成员模板导入/导出（+ dsh-tavern 角色卡导入：V2/V3 JSON 卡 → 成员人设）。

### 关键凭据/路径（勿外泄）
- Gitee PAT：scripts/_gitee_pat.txt（已 gitignore）
- API Key：本机 providerConfig（localStorage），代码中无硬编码
- 便携包产物：dist-portable\（已 gitignore）
- 引擎：D:\deepseek-harness-master（0.1.0-rc.5）；官方 npm：@deepseek-ai/dsh@0.1.1-rc.2
- 社区插件目录：C:\Users\Administrator\.hermes\dsh-plugins（workgroup/realtime-voice/
  multi-model-provider，NODE_PATH 已追加）
- 官方源码 clone：C:\dsh-src\deepseek-harness（sparse，packages/client 部分；网络对
  GitHub 大 blob 不稳，重试或换网）

---

# 架构迁移完成（2026-08-30）：apps/mirach 并入官方 workspace

- **新位置**：G:\\deepseek-harness-master\\apps\\mirach（官方 0.1.2-alpha.1 workspace 成员，apps/* glob 自动收录）
- **形态**：桌面版（Tauri + stdio JSON-RPC sidecar），对话区三种 UI 保持 Mirach 形式
- **插件树**：对齐官方 dsh-base 全树（约 60 运行时插件，含沙箱/审批/搜索/目标/查询/自动命名等）
- **仓库**：apps/mirach 独立 git（本仓库），双远程 Gitee/GitHub force 基线 74fd7f8；旧历史在 G:\\mirach\\.git 与远程 tag 备份（old-g-mirach-backup 本地 tag）
- **数据目录**：C:UsersAdministrator\\.mirach（会话/插件/存储；原 .hermes 已随迁）

## 迁移后待验证清单

1. 新对话发消息：persona（奎木狼）+ 联网搜索 + 全部插件行为
2. 侧边栏成员 8 人（奎木狼+社区七身份）、环境切换单独团队
3. 沙箱：写工作区外路径被拒（DSH_PERMISSION_MODE 可调）
4. 画廊：弧形/拖拽/选中放大（WebGL）
5. 登录流程：密码跳过/保存→模型页(仅首次)→主页

## 后续大件（评估见 docs/research-isolation.md 第五节）

- 官方 0.1.1 新装配体系（消息定位器/轨迹/JobPanel 底座）——事件溯源层移植（分阶段路线已写）
- 记忆接入（per-env root）、定时任务 envId 隔离、成员模板导入（+tavern 角色卡）

---

# ⚠️ 仓库位置变更（2026-08-30）：统一在 apps/mirach

- **唯一工作目录**：G:\\deepseek-harness-master\\apps\\mirach（官方 0.1.2-alpha.1 workspace 内）
- 旧 G:\\mirach 目录已归档停用（其 git 历史保留在本地 .git；远程已 force 对齐新基线）
- **双远程**：origin=Gitee HANQINGZHOU/mirach、github=git@github.com:HQZ1111/MIRACH.git（SSH）
- 若有其他窗口/会话在旧目录工作，请全部关闭，避免再次分叉

---

# 交接文档（最终版）：新会话继续指南

## 项目位置

- **唯一工作目录**：`G:\deepseek-harness-master\apps\mirach`
- 这是官方 dsh 0.1.2-alpha.1 workspace（`G:\deepseek-harness-master`）内的一个 app
- 双远程：origin = Gitee `HANQINGZHOU/mirach`、github = `git@github.com:HQZ1111/MIRACH.git`
- 数据目录：`%USERPROFILE%\.mirach\`（会话/插件/存储，原 .hermes 已随迁）

## 三种对话风格

| 风格 | chatStyle 值 | 渲染方式 | 状态 |
|---|---|---|---|
| dsh | `"dsh"` | 紧凑行式 + ReasoningRow + DshToolRow + CompactionRow | ✅ 可用 |
| default | `""`（默认） | 气泡式（白底描边）| ✅ 可用 |
| minimal | `"minimal"` | 简约（ZosmaChat） | ✅ 可用 |

## 已完成的功能清单

### 后端（agent-sidecar）
- sidecar 已挂载官方 dsh-base 全树约 60 个插件（沙箱/审批/搜索/目标/查询/自动命名/pwsh/编辑器/溢出/超时/附件/反馈/提问/工作流/子代理全系）
- 社区插件已安装：dsh-workgroup（工作组协作）、dsh-realtime-voice（全双工语音）、dsh-multi-model-provider（多模型路由）——位置 `%USERPROFILE%\.mirach\dsh-plugins\`
- 原始 SessionEvent 透传链路：sidecar 把 `session.event`（含 seq）原样发给前端（`raw_session_event` 事件）
- 数据目录：`%USERPROFILE%\.mirach\`（dsh-sessions/dsh-plugins/cron 等）
- PATH 展开：`~/` 前缀由 sidecar 展开（`~/.mirach/chat` 等）
- 工具：bash/pwsh/持久 bash/文件/搜索/编辑器/todo/goal/ralph/skill/ask_user/web_search/subagent 全系/fork/workflow

### 前端（React 19）
- StatsLine（真实 token 计量 + 缓存命中 + `|` 分组格式）
- DshToolRow（工具行，可展开 IN/OUT）
- ReasoningRow（思考过程展开）
- CompactionRow（压缩标记）
- 项目画廊（WebGL 弧形，项目名在文件夹上，拖拽旋转，点击选中固定）
- 登录页（MIRACH/HARNESS 品牌字 + 密码/跳过 + 窗口三圆点 + 整页拖动）
- 设置关于（Mirach Harness / 奎木狼全能个人助理 / v0.1.0）
- 插件管理三标签（已安装/目录/引擎插件清单）
- 成员列表（奎木狼+规划师+工程师+调试员+审查员+研究员+评论家+写手，8 人）
- 环境隔离（会话/成员/perssona 按环境分片，chat 环境专属工作区 `~/.mirach/chat`）

### 基础设施
- 便携包：dist-portable\Mirach-portable.zip（268MB 单文件，解压即用）
- Gitee Release v0.1.0 已上传（144MB 双卷 7z）
- GitHub Release 附件：待上传（用户网页操作或 token）
- cordis.yml 生成已对齐官方 dsh-base 全树

## 下一个会话需要做的工作

### P0：对话区换官方装配层

三种 UI 风格共享同一数据层，只是渲染外壳不同：

1. 前端引入 `@deepseek-ai/dsh-client-runtime` + `@deepseek-ai/dsh-client-ui-conversation`
2. sidecar 已透传原始 SessionEvent（`raw_session_event` 事件含 seq/type/data）→ 前端 `session-events.ts` store 按 seq 排序存储
3. 用官方 ConversationLocationIndex（475 行，可从 `G:\deepseek-harness-master\packages\client\ui-conversation\src\client\conversation\location-index.ts` 直接复制）构建 Turn/Step timeline
4. 三种风格的对话区都从 timeline 读取数据渲染（dsh 风格 = DshToolRow 行式；default = 气泡；minimal = ZosmaChat）
5. 官方装配层的 projection（tokenUsage/sessionStats/contextPressure）替代手写统计

### P1：ContextMeter（上下文占用环）
- 数据：`usage.lastInputTokens`（含 cacheRead/cacheWrite）÷ contextWindow（1M）
- UI：圆环显示占用百分比，压缩后自动缩小
- 位置：Composer 输入框旁边

### P2：轨迹视图对齐官方 ui-trajectory
- 从 SessionEvent timeline 构建：Turn 分组 → Step 列表 → 事件详情展开
- 每个 Step 显示：耗时、token 用量、工具调用结果

### P3：JobPanel（引擎级任务面板）
- 数据源：`dsh-tool-jobs` / `jobs-local`（引擎 jobs-local 插件已挂载）
- UI：任务列表 + 状态 + 启停 + 日志

### P4：成员对话接引擎
- 当前成员对话是 mock（RightSidebar TempMsg）
- 每成员一个独立 dsh 会话，persona 从 agents store 的 systemPrompt 注入（set_env.systemPrompt）
- workgroup 插件提供跨成员消息（workgroup_create/send）

### P5：完善项
- 定时任务加 envId 隔离（当前 Rust 全局单表）
- 会话级 persona 快照持久化（sessions 表加 system_prompt 列）
- 成员模板导入/导出（+ dsh-tavern 角色卡 V2/V3 JSON 导入）
- ContextMeter（上下文占用环）

## 关键决策记录

1. **对话区三种 UI 保持**：dsh（紧凑行式）/default（气泡）/minimal（简约），数据层统一
2. **沙箱部署语义**：workspace-write + approval never（直接执行，不出工作区）
3. **品牌**：Mirach（奎木狼），不用 Desktop/Agent 字样
4. **环境即目录**：每环境独立工作区 + 会话持久化 + 成员（Hermes profile 模式）
5. **插件管理**：引擎插件经 dsh-plugins 目录 + NODE_PATH，社区插件 npm 安装即可

## 关键文件速查

| 文件 | 用途 |
|---|---|
| `agent-sidecar/src/index.ts` | sidecar 命令循环（JSON-RPC 面向 Tauri） |
| `agent-sidecar/src/dsh.ts` | 引擎运行时生命周期/环境隔离 |
| `agent-sidecar/src/adapter.ts` | 引擎事件→前端事件适配 |
| `agent-sidecar/src/history.ts` | 会话日志解析（按 turn 合并回放） |
| `agent-sidecar/src/runtime.ts` | 运行时路径解析/cordis.yml 生成 |
| `src/store/chat.ts` | 消息 store（delta 合帧缓冲/工具挂载） |
| `src/store/agents.ts` | 团队成员（8 人种子 + 环境分片） |
| `src/store/environments.ts` | 环境定义与切换 |
| `src/store/session-events.ts` | 原始 SessionEvent 日志 |
| `src/components/layout/MainPanel.tsx` | 主面板（对话区/画廊/统计/工具行） |
| `agent-sidecar/package.json` | sidecar 依赖（workspace:* 链接官方包） |
| `docs/research-isolation.md` | 隔离设计调研（Hermes vs Mirach） |

---

# B 阶段 1 完成：核心双面（2026-08-30 深夜）

> 定案（同日）：Tauri 不变、mirach UI 不变；核心仍是 dsh；桌面/浏览器/手机三端
> 互通、同时登录。架构 = 官方 profile 机制把 stdio JSON-RPC（sdk 面）与 HTTP/WS
> （web 面）合进同一个引擎进程，B 评估的三条硬事实（网关多客户端/每客户端游标/
> PWA 清单）均已在本机实测。

## 已完成

1. **G 盘 checkout（0.1.2-alpha.1）构建链修复**——此前"tsdown 本机无法运行"的真因
   是鸡生蛋：根 `tsdown.config.ts` import 的 typert 插件产物
   （`packages/typert/generator/lib/types/tsdown-plugin.js`）本身要靠构建产生。
   修复 = `scripts/bootstrap-typert-plugin.mjs`（ts.transpileModule 剥类型 +
   .ts 说明符改写 .js，一次性落盘该产物）。之后 `build:lib:host` 与
   `build:lib:client` 全量构建均通过（exit 0），G 盘 host+client 两面 lib 齐备。
2. **mirach profile**（`~/.mirach/profiles/mirach/`）：
   - `package.json`：bundles = `[dsh-base, dsh-sdk-app, dsh-web-app]`（stdio+HTTP 双面）、
     patchReload live；
   - `cordis.patch.yml`：llm-pi-ai providers（env DSH_LLM_PROVIDERS 注入）、
     llm-deepseek effort（env DSH_EFFORT）、permission 自定义预设
     `mirach-auto`（workspace-write + approval never；approval 单独改 never
     会"组合匹配不到预设"报错——必须显式 defaultPreset）、insert
     time-context/schedule/社区插件、webserver host/port（env
     MIRACH_WEB_HOST/MIRACH_WEB_PORT）、web-runtime openBrowser:false。
   - 社区插件解析：ESM 不认 NODE_PATH——在
     `~/.mirach/dsh-plugins/node_modules/` 下补 junction（@deepseek-ai 全闭包
     ← apps/cli + bundle/base 的 node_modules、zod ← packages/llm/llm、
     cordis ← vendor/cordis）。
3. **sidecar profile 模式**（env `MIRACH_PROFILE=1`，默认关=老链路不变）：
   - `runtime.ts`：entry → `apps/cli/src/bin.ts`；`writeRuntimeConfig` 跳过生成；
   - `dsh.ts`：launch args = `bin.ts --profile mirach`，env 增 DSH_HOME
     （=~/.mirach，profiles/sessions/storages 同住）、MIRACH_WEB_PORT、DSH_EFFORT；
   - **验收 PASS**（`agent-sidecar/verify-stage1.mjs`）：stdio 面握手 UP +
     web 面 HTTP 401（鉴权闸门）。浏览器 `http://127.0.0.1:3212/?token=<URL行>`
     出官方 UI（正式前端 dist 已构建）。

## 已知项 / 阶段 2 待做

- 会话持久化位置在 profile 模式下变为 `~/.mirach/sessions`（dshHomePath），
  旧 `~/.mirach/dsh-sessions` 历史迁移待做；`get_history` 读旧位置，回放空。
- 阶段 2（读侧过桥）：mirach 前端加 workspace 依赖（cordis/connection/
  gateway client/session-controller client），dsh-kernel boot + ctx.sessions
  → nanostores 镜像层，UI 组件零改动；dev 期 vite 代理 /api → 127.0.0.1:3212。
- 阶段 3（写侧换轨 + 三端）：`session.prompt`（回声协议）、sidecar 对话职责
  退役、手机 PWA + LAN 信任（--trusted-host 语义在 web-startup）。

## 阶段 2 激活配方（考古已完成，2026-08-30 深夜；下会话照此执行）

官方客户端内核 = 四个 cordis apply,按序激活（均已读签名）：

1. `@deepseek-ai/dsh-typert-registry/client` — `inject: []`，install TypertRegistry（客户端反射根；
   packages/typert/registry/src/client/index.ts）
2. `@deepseek-ai/dsh-client-connection/client` — 无必需服务；读 `location.origin` +
   可选 `window.__DSH_TRANSPORT__`；提供 ctx.connection + generation + 'connection/reset'
3. `@deepseek-ai/dsh-api-gateway/client` — `inject = ['typert','connection']`；
   ClientRemoteService 提供 ctx.remote 与 `remote.<ns>`（packages/api/gateway/src/client/index.ts:117）
4. `@deepseek-ai/dsh-api-session-controller/client` — `inject = ['connection','typert','remote',
   'remote.commands','remote.session','remote.subagents']`；apply 建 ClientSessions + control 流 +
   `$on('api-session/*')`（packages/api/session-controller/src/client/index.ts:92）

**唯一开放问题**：`remote.commands/session/subagents` 三个命名空间面的提供者。
浏览器名册（G: web-app patch 152-290 行）里无独立行 → 由 `api-remotes`（双面）或
`client-runtime` 的 client half `$mount` 生成描述符（见 session-controller/src/client/remotes.ts
"生成的命名空间面"）。执行时先 rg `remote.session` 的 set/mount 点确认，再决定
apply 顺序。内核激活不必经 modules bundle 系统——直接四个 apply 即可
（vite 从 lib/ 构建产物打包，全部包有 lib）。

镜像层设计（UI 零改动）：kernel 的 SessionEventLikeEntry 形状 == sidecar
raw_session_event 的 event 形状 → **复用 sidecar adapter**（agent-sidecar/src/adapter.ts，
392 行，唯一 node 依赖 = protocol.js 的 logDebug → 拷贝进 src/dsh-kernel/ 换
前端 logger）喂 $chat；projections 走 ctx.sessions 的 projection store →
$assembly*/$usage。dev 期 vite proxy `/api → http://127.0.0.1:3212`（同源化），
发布期 dist 锚点指向 mirach dist（frontend-static 配置项）。开关 VITE_KERNEL=1。

## 阶段 2 状态：代码完成 + 编译验收通过（2026-08-30 深夜）

- **依赖已接**：mirach package.json 增 7 个 workspace:^ 依赖（cordis/connection/
  gateway/api-remotes/session-controller/typert-registry/client-store），pnpm install 通过。
- **vite**：`/api`（含 WS）代理 → `MIRACH_CORE_URL ?? 127.0.0.1:3212`；
  adapter 的 protocol.js 经 alias 重定向到 `src/dsh-kernel/protocol-shim.ts`。
- **内核 + 镜像**：`src/dsh-kernel/boot.ts` + `module-loader-shim.ts`。
- **验收门**：tsc 干净 + `vite build` 成功（内核 graph 完整打包）。
- **回滚**：所有改动 = 新文件（src/dsh-kernel/*）+ 三处小改（package.json 依赖、
  vite.config 代理/alias、main.tsx 动态 import）+ pnpm-lock。git checkout 这三处
  + 删 src/dsh-kernel 即完全回滚；默认路径（VITE_KERNEL 未设）行为不变。

## 阶段 2 e2e 完成记录（2026-08-30 深夜）

实机 e2e 已跑到：`MIRACH_PROFILE=1`+`VITE_KERNEL=1` 的 tauri dev 起来了
（vite 1420 + 核心 3212 双面都 LISTENING），dev 实例的 VITE_KERNEL 确认进了
bundle（抓 /src/main.tsx 转换产物验证），登录页无 overlay（内核 import 已解析）。
DevTools console 抓到首个运行时错误并已修复：

- **发现 1（已修）**：`@deepseek-ai/dsh-api-remotes/client` 是 modules 系统
  bundle 格式（首行 `window.__ModuleLoader__.load({id,factory})`），直接 import
  即抛 `Cannot read properties of undefined (reading 'load')`。
  **修复 = `src/dsh-kernel/module-loader-shim.ts`**：提供 mini `__ModuleLoader__`
  （收集工厂），boot.ts 顶部先 import shim 再静态 import 各 bundle，
  `bundleRequire(id)` 实例化（平台外部依赖 react/cordis/store 从 vite 静态导入
  映射；跨 bundle 引用经 factories 递归），五个插件逐个 `ctx.plugin(mod)`。
- **发现 2（当前卡点）**：mini-loader 上线后标题标记未出现——boot 仍未完成或
  dev 页面未重载。续诊（按序）：
  1. 聚焦 mirach dev 窗口按 F12 开 DevTools（或 `http://localhost:1420` 在浏览器
     直接开更稳），Console 找 `[dsh-kernel]` 行：
     - `kernel booted: sessions=N` = **通了**；
     - `unresolved module require: X` = 把 X 加进 module-loader-shim 的
       PLATFORM 表（已知候选：`@deepseek-ai/dsh-typert-protocol`、
       `@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-client-ui-slots`、
       `@deepseek-ai/dsh-client-ui-primitives`、`react-dom/client`）；
     - `KERNEL BOOT FAIL`（title）= 查堆栈里的 apply。
  2. 通了之后：StatsLine 应显示全格式统计（第 N 轮·M 步 | LLM·工具 | 首字·tok/s |
     缓存命中 | 输入/输出）——本会话已在 dev 实例实测该格式端到端渲染
     （数据来自 sidecar 管道；内核镜像与之双馈同 seq 合流）。
  3. 临时验收信号：bootKernelMirror 会设 `document.title`（KERNEL OK sessions=N /
     KERNEL BOOT FAIL）——Tauri 窗口标题默认不随 document.title 变，用 DevTools
     console 或任务栏预览观察；稳定后移除。
- 附带实证：dev 实例的装配层端到端已工作（真实会话 StatsLine：第 2 轮·6 步 |
  LLM 1m0s · 工具 5m0s | 首字 1.7s · 89.4 tok/s | 缓存命中 77% | 输入 33.1K ·
  输出 4.4K）。
- **遗留小项**：profile 模式下 sidecar 启动会打一条无害错误
  "cordis config not found ... examples/jsonrpc-agent/cordis.yml"（resolveRuntimePaths
  的存在性检查在 profile 模式应跳过 config 项——探测循环已改但可再收敛）。

## 阶段 2 e2e ✅ PASS（实机）+ 阶段 3 精确步骤

e2e 结果（实机）：**角标 `KERNEL OK sessions=0`**——五插件经 mini-loader 全部
激活，内核连上核心（vite 代理同源）、鉴权、拿到会话列表。三端互通架构成立：
一个核心进程，sidecar stdio 客户端 + UI 官方内核客户端并行。同实例实测装配层
端到端渲染（StatsLine 全格式：第 2 轮·6 步 | LLM 1m0s · 工具 5m0s | 首字 1.7s ·
89.4 tok/s | 缓存命中 77% | 输入 33.1K · 输出 4.4K，数据来自 sidecar 管道；
内核镜像同 seq 双馈合流不冲突）。

阶段 3 剩两步（照做）：
1. **prompt 换轨**（VITE_KERNEL 开关内）：
   a. 把 useStreamingReply 内联的 onEvent switch 抽到 `src/store/chat-events.ts`
      （handleMirachEvent），sidecar 与内核两管道共用（顺带收敛 O-2）；
   b. 内核发送位：`sessions.open(核心会话id)` → `session.prompt(content,'queue')`
      （回声 beginSubmission + durable 事件按 rpcId retire，见
      session-controller/src/client/sessions/session.ts）；内核模式首次发送先
      `sessions.create()` 建核心侧会话；
   c. 内核镜像层把事件窗口条目过 adapter（vite alias 已接
      agent-sidecar/src/adapter.ts）喂同一 handler → $chat 渲染。
2. **手机端**：核心 `--host 0.0.0.0 --trusted-host <LAN-IP>`（web-startup 现成
   旗标，profile patch 可改 webserver host）；手机浏览器/PWA（apps/web 已有
   manifest）访问 `http://<LAN-IP>:<port>`；配对鉴权（hermes pairing.py 思路）远期。
3. **收尾**：移除 bootKernelMirror 的临时角标/title 调试信号；处理会话持久化
   位置差异（profile 模式 ~/.mirach/sessions vs 旧 ~/.mirach/dsh-sessions 的
   get_history 迁移）。

---

## 阶段 3b 手机端（配置已备，按此启用）

1. 启动环境加 MIRACH_WEB_HOST=0.0.0.0（profile patch 的 webserver host 表达式已读此 env）；
2. LAN 信任自动派生：webRuntime 采样活动绑定的 LAN IP 字面量（resolveLanTrust），手机访问 http://LAN-IP:port 即过栅栏；特殊域名才需 --trusted-host；
3. 手机浏览器打开即用（apps/web PWA manifest 已有）；内核链在手机端同样生效（同一核心同一 /api）；配对鉴权（hermes pairing 思路）为远期增强；
4. 安全边界：仅限可信局域网；公网需隧道+HTTPS（未做，勿直接暴露）。

## 环境插件（2026-08-31 完成）

文件：
- src/plugins/icon-library.tsx — 图标库（40 项 Phosphor 面性精选 + registerIcon 开放扩展；旧 lucide: id 按裸名兼容解析，无需迁移）
- src/plugins/plugin-environments.tsx — 环境插件主体（sidebarNav 贡献）
- src/components/settings/IconPicker.tsx — 图标选择弹窗
- src/components/settings/EnvSettingsSection.tsx — 设置页环境分区
- src/store/environments.ts — 扩展 icon/visible/builtIn + actions
- src/components/layout/LeftToolbar.tsx — 环境区改为读 store(visible 过滤)
- src/components/layout/AppLayout.tsx — mirach:switch-view 监听(隐藏→切回主环境)
- src/components/layout/MainPanel.tsx — 隐藏环境正激活自动切回主环境 effect

数据：EnvProfile {id,name,cwd,icon,visible,builtIn}；main 锁定(builtIn=true，
store 层 enforceMain 回填)；可见性开关 = 左栏按钮显隐 + 隐藏正激活自动切回。
拔插 = 禁用插件注册 → 左栏环境区消失，引擎对接不受影响。

# 第四批：记忆系统 + cron 环境标记 + 模板导入导出（2026-08-31 深夜）

1. **记忆系统 ✅（P2 大件落地）**：
   - 位置 = 每环境工作区的 `.mirach/MEMORY.md`（环境记忆）+ `.mirach/USER.md`
     （用户档案）；cwd 即环境边界 → 天然按环境隔离，且在引擎沙箱（workspace-write）
     内，AI 可用文件工具自行维护。
   - 注入：sidecar set_env 时读两文件拼进 systemPrompt（`memoryBlock()` +
     MEMORY_MAINTAIN_HINT 维护约定），主对话与成员私聊共享（都走 set_env）。
     **需重启应用生效**（sidecar 变更）。
   - 设置页新分区「记忆」（SECTIONS + MemorySection）：环境标签切换，双 textarea
     编辑 + 保存（read_file / write_user_file 既有命令；write_user_file 已补
     create_dir_all）。工作区未设置的环境回退用户主目录（userHomeDir，
     新 src/lib/paths.ts，tavern.ts 同步复用）。
2. **定时任务环境标记 ✅（约定式隔离）**：cron 名称加 "[envId] " 前缀；排程面板
   默认只显示当前环境（+未标记旧任务），可切"全部环境"。引擎侧 job 模型无环境
   字段，真字段级隔离需引擎支持（已注明）。
3. **成员模板导入导出 ✅**：智能体团队标签行右侧「导出团队/导入团队」——导出 =
   save 对话框 + write_user_file（{version,env,members} JSON）；导入 = 按 id
   合并进当前标签环境（不覆盖已有）。

# 第三批收尾（2026-08-31 晚；用户反馈驱动）

- **Mirach-harness GitHub 推送取消**（用户决定不做）：父仓库 github remote 已移除，
  Gitee gitee.com/HANQINGZHOU/mirach-harness 保留（提交 385cca0，mirach 为子模块）。
- **智能体团队按环境管理 ✅**：设置页「智能体团队」加环境标签页（聊天/代码/写作…），
  逐环境查看/编辑；store 新增 loadAgentsOf/saveAgentsOf/addAgentIn/updateAgentIn/
  removeAgentIn（写指定环境分片；写当前分片时同步 $agents，左栏实时刷新）。
  默认标签 = 当前激活环境（$engineEnv）。
- **酒馆成员固定聊天环境 ✅**（用户约定）：upsertTavernMember 固定写 TAVERN_MEMBER_ENV
  = "chat" 分片；成员卡带「酒馆」角标；导入弹窗的已导入标记也从 chat 分片读取。
- **成员会话记录持久化 ✅**（用户问"每个成员的会话记录没有吗"）：成员线程写
  localStorage（mirach.member-threads.v1，每成员留最近 200 条），重启恢复；
  打开面板时的引擎历史回放加守卫（本地已有记录则不覆盖）。引擎侧 member-<id>
  会话日志本就持久化（续聊上下文不丢）。
- **成员记忆现状**：会话内记忆 = dsh 会话上下文（续聊有效，已接引擎）；跨会话
  长期记忆（MEMORY.md 式 per-env 记忆系统）仍是 P2 待做。

# 零散收尾完成（2026-08-31 第二批）

1. **成员私聊接引擎 ✅（原 P1 #6 待办落地）**：
   - `src/store/engine-session.ts`：$engineEnv/$mainPersona（MainPanel 流水线写入）+
     bindEngineSession(sessionId, persona) = dsh_set_env + load_dsh_session 两连。
     **persona 是运行时全局的**——主对话与成员私聊共享 runtime，故每次发送前各自
     绑定（useStreamingReply 主发送前重绑主 persona；成员发送前绑成员人设）。
   - 成员会话 id = `member-<成员id>`，sessionMap 键 "<envId>::member-<id>" 持久化
     → **每成员独立 dsh 会话**，上下文互不可见（结构性隔离），重启续聊。
   - AppLayout：openMember 时 dsh_get_history 回放成员历史（替换种子消息）；
     sendMemberMessage 真实路径 = 绑定 → submitPromptStream → routeMemberEvent
     （MirachEvent → memberThreads，thinking 阶段 "…" 占位、complete 权威定稿、
     error 落 ⚠️）；mock 模式保留演示回复池。MemberChatPanel 加 busy 提示。
   - 已知边界：成员线程 UI 记录仍在内存（重启后靠引擎历史回放补全）；并发绑定
     窗口（成员绑定 in-flight 时主发送）理论上可交错，引擎串行队列兜底。
2. **FileChangesRow 审查入口 ✅（原产品清单 #4 收尾）**：行头新增「审查」按钮 →
   `mirach:open-git-review` 事件 → RightToolbar 打开 GitReviewOverlay（diff 审查）。
3. **等待指示头像动态化 ✅**：WaitingIndicator 头像/名字取 $defaultAgent 对应成员
   （未设置回退奎木狼），不再写死。
4. **JobsAction 轮询统一 ✅**：对话区后台任务徽标改 5s 轮询（对齐 JobsOverlay）。

# 酒馆角色接入成员体系（2026-08-31 完成）

> 用户问"之前装的三个插件有个酒馆的，能合进聊天的成员里吗"。实况：本机只装过
> dsh-workgroup + dsh-realtime-voice（~/.mirach/dsh-plugins），酒馆从未装过/已丢失
> ——本次新装 dsh-tavern@2.2.2（PolyForm-NC，个人使用 OK）并做两层接入。

**引擎侧**（需重启应用生效）：
- dsh-tavern@2.2.2 npm 装进 ~/.mirach/dsh-plugins（连带 dsh-muv-table/engine）；
- junction：profiles/mirach/node_modules/dsh-tavern → dsh-plugins/node_modules/dsh-tavern
  （与 workgroup/voice 同模式）；cordis.patch.yml insert `- id: tavern, name: 'dsh-tavern'`；
- 酒馆数据根：**~/.dsh/.agent-presets**（插件 index.js 硬编码 homedir，不随 DSH_HOME），
  每预设目录含 preset.yml（name/description）+ agent.cordis.yml（persona 块标量=角色卡注入文本）。

**成员侧**（纯前端，tsc 通过）：
- src/lib/tavern.ts：listTavernPresets（Tauri read_dir/read_file 扫预设目录；
  主目录从 get_config().data_dir 上溯三级推得，不加 Rust 命令）+ extractPersonaText
  （agent.cordis.yml text 块标量解析）+ parseCharacterCard/cardToPersona（SillyTavern
  V2/V3 JSON 直导）；
- agents store：ConvItem.source?: "tavern" + upsertTavernMember（id=tavern-<key> 幂等，
  重导只更新）；人设走既有成员管线（set_env.systemPrompt 注入），零引擎耦合；
- 设置页 → 智能体团队 → 「导入酒馆角色」：预设列表（空态给路径提示）+ 角色卡
  JSON 多选直导。成员卡显示 source；删除走原 removeAgent。

08-31 补充（用户反馈修正）：
- 图标全量换 Phosphor weight="fill"（面性）——曾误用 lucide 线性，左工具栏环境按钮
  风格跑偏；现与左工具栏固定项一致（size 24 + var(--tool-icon-*) 色）。
- 工作区改「默认 / 自定义」双档：默认=跟随系统（cwd 空串）；自定义走
  tauri-plugin-dialog 原生文件夹选择对话框（文件管理器式点选，不手输路径）。
  Rust 侧三处已接：Cargo.toml 依赖、lib.rs 插件注册、capabilities dialog:default。
  **需重启应用（Rust 重编译）后生效**；未重启前点选会提示"无法打开系统文件夹选择器"。

# 产品层需求清单（2026-08-31 用户提出；2/5/6 + 阶段3a 已做，3/4/7 待做）

> **08-31 会话体验二次修正（用户实测反馈）**：
> ① **busy 按会话分桶**（store/agent $busyMap）：A 会话回复中切到 B 会话立即可发送，
>    不再全局"回复中"卡死；$agentBusy = computed(任一忙)，auto-drain 语义不变。
> ② **切会话后事件降级后台簿记**（useStreamingReply + chat-events background 标志）：
>    原来整流丢弃 → busy 永久卡死 + 欠费等错误提示丢失；现在转录写入跳过（防串台），
>    busy 释放/定稿复位/重试条照常。内核桥同步（dsh-bridge boundSid，kernelSend 绑定）。
> ③ **发送按钮状态机重排**：busy+有文字=发送（连续发送 #6 落地，不再排队图标）；
>    busy+无文字=停止（发送后即出现停止图标，等首包/思考中/流式中全程可中断）。
>    Enter 繁忙时默认直接连续发送（steer 设置仍可转向；Ctrl+Enter 仍入队）。
> ④ **等待指示移入 Virtuoso Footer**（MessageList footer prop + WaitingIndicator）：
>    原来 Important 列表外的块被 overflow-hidden 裁剪（用户看"放在输入框背面"）；
>    现在渲染在对话区消息流末尾 = AI 回复将出现的位置，流式第一步显示、内容出来接替。
>    FileChangesRow 同入 Footer（原来同样被裁剪看不见）。计时器内置于指示器，
>    MessageList memo 不被每秒击穿。
> ⑤ 已知残留（内核单会话绑定，阶段 3a 限制）：内核管道 B 会话排队后 A 的回合收尾
>    事件会短暂清掉 B 的 busy（B 的 turn 事件到达后恢复）；每个 mirach 会话绑定
>    独立核心会话后在阶段 3b 解决。

> **内核链就绪问题已修（08-31 深夜）**：① 403 根因 = 信任栅栏要求 Origin===Host，
> vite 代理已重写 Origin（HTTP+WS）；② typert bundle 注册不稳定 → 改为直接实例化
> TypertRegistry 主类（boot.ts，不走 bundle）；③ 内核链提前就绪 = sync_provider_config
> 在 MIRACH_PROFILE=1 时顺带 ensureRuntime（profile warmup，sidecar index.ts）；
> ④ 发送瞬间 setAgentBusy(true)（思考指示即时出现，不等 message.start）；
> ⑤ 等待指示升级为 AI 消息样式（头像+名字+思考气泡+工作中 X 秒计时，MainPanel）；
> ⑥ 成员列表时间/状态钉在行最右（Info flex-1 + Right pr-3）。以上均 tsc 通过。
> **验证**：dev10 实测 runtime ready + 3212 LISTENING 随启动即有；发消息应不再出现
> ℹ️ 内核链未就绪。若再现，新括号内容发我。

0. ✅ **阶段 3a prompt 换轨已落码**（VITE_KERNEL=1 时启用）：
   - `src/store/chat-events.ts` = 统一事件处理器（自 useStreamingReply 抽出；
     sidecar 与内核两管道共用，收敛 O-2）；
   - `src/dsh-kernel/pi-bridge.ts` = 内核 dsh 事件 → adapter → MirachEvent →
     handleMirachEvent（user/message 跳过防双气泡；usage/todos/subagents 同步）；
   - `src/dsh-kernel/boot.ts` 增 `kernelSend(text)`（sessions.create/open →
     `session.prompt(text,'queue')`，桥接水位防历史重放）与 `kernelStop()`；
   - Composer：VITE_KERNEL=1 时发送走 kernelSend、停止走 kernelStop；
     busy 但未流式时主按钮保持"发送"（不再被停止顶掉）。
   - **待运行时验证**：VITE_KERNEL=1 下发一条消息，回复应经内核事件链渲染。
1. ✅ **切换会话丢历史（已修）**：profile 模式下引擎持久化在
   `~/.mirach/sessions`（dshHomePath），sidecar get_history/list_sessions 却读旧
   `~/.mirach/dsh-sessions` → 回放为空。修复 = resolveRuntimePaths 在 profile
   模式下 sessionRoot 对齐到 `~/.mirach/sessions` + 一次性迁移旧 session-map.json。
   **需重启 dev 生效**。旧历史日志（dsh-sessions）如需保留访问，手动把
   `<cwd编码>/<sessionId>` 目录搬到新 root（结构相同）。
2. ✅ **StatsLine 移到输入框下方**：MainPanel 主渲染的对话区改为 relative 容器，
   StatsLine 绝对定位 bottom-0 居中（h-5 内、pointer-events-none），不挤输入框。
3. ✅ **统计扩展（已落码）**：工作总时长(durationMs)+思考用时(thinkingMs)已加进 sessionStats 折叠与 StatsLine 显示;：加"工作总时长"（会话首末事件墙钟跨度）与"思考用时"
   （每步 reasoning 首 chunk → 首个非 reasoning chunk 的跨度合计）。改
   src/dsh-assembly/projections.ts 的 sessionStats 折叠（自有两份拷贝之一）+
   StatsLine 显示组。
4. ⏳ **文件更改汇总组件**：回合结束时显示"改了 N 个文件（+X/-Y）"，可展开
   列出所有更改文件（文件名/类型/路径），点击可审查（GitReviewPanel）与打开
   （FileViewerPanel）。数据源：$toolCalls 里 write/edit 类工具按 file_path
   聚合（src/lib/tool-summary.ts 已有雏形）+ git status/diff。
5. ✅ **思考中动画**：ChatSection 消息列表尾部——agentBusy && !streaming &&
   末条为 user 时渲染三点跳动 + "正在思考…"（MainPanel MessageList 之后）。
6. ✅ **连续发送不排队**：Composer handleSend 不再被 busy 阻塞；主按钮仅在
   busy && streaming 时变"停止"（busy && !streaming = 已发等首包，保持发送）；
   用户气泡乐观上屏，sidecar 队列串行消化。
7. ⏳ **团队列表布局**：成员状态与时间未右对齐（右侧栏成员卡），修正排版
   ——需要先截图确认现状再改（MemberChatPanel/LeftSidebar 团队卡）。
8. ✅ **KERNEL 调试角标已移除**（boot.ts 的 showKernelBadge/标题标记全清）。

---

# 零件库落地与阶段 3 方案（2026-08-30，来源：D:\hermes-agent-main 参考件）

> 定案：Tauri 不变、mirach UI 不变；核心仍是 dsh。Hermes Agent（Nous Research）只作
> 架构参考书和零件库——它是"B 族自托管核心 + 多接入面（TUI/web/Electron/聊天平台/
> ACP/MCP）"的已验证开源先例。B 三阶段方案与架构论证见会话记录；关键事实：
> dsh 网关原生多客户端（remoteEventClients Map）、每客户端 journal 游标、web PWA 清单、
> frontend-static 的 dist 锚点是插件配置项（可指向 mirach 产物）。

## 已落地（本次）

1. **Turn lease**（`agent-sidecar/src/turn-lease.ts`，对应 hermes `gateway/turn_lease.py` #64934）：
   按【解析后 dsh session id】串行回合——路由键(前端会话 id)与转录所有者多对一，
   只按路由键串行不足以保护同一份持久日志。代际令牌 + 身份校验释放（stale 释放被忽略）
   + 争用超时 fail-open（宁可退化不可楔死）+ registry 有界。已接线 `runIn`
   （碰撞重试双 runIn / 未来成员会话并行 / B 桥接层共用此原语）。四条安全属性冒烟 ALL PASS。
   现状进程内全局串行使争用不可达（租约=不变式 enforcement）；跨进程保护仍由引擎
   持久日志身份守卫（id collision → 换新 id）承担。
2. **Restart loop guard**（`src-tauri/src/dsh_relay.rs` setup_sidecar，对照 hermes
   restart_loop_guard）：600s 窗口内崩溃 ≥5 次 → 进入响亮失败态（emit
   `dsh_sidecar_suspended`，冷却拉长到 300s），健康长跑（ready 且存活 >60s）清零窗口
   恢复快自愈。修复两处旧缺陷：spawn 成功即重置退避（秒退型崩溃退化成 ~1s 无限循环）、
   崩溃永不封顶（用户只见"连接中"无终态）。前端可选 listen `dsh_sidecar_suspended`
   显示横幅（resumed:false=进入抑制 / resumed:true=恢复）。

## 阶段 3（手机端 / B 后期）待用零件（hermes 对照清单）

- **鉴权**：官方 token→cookie 为基本盘；手机首次接入用 hermes `pairing.py` 思路做
  短码配对（桌面显示一次性配对码 → 手机输入交换设备令牌），避免手拷长 token。
- **投递可靠性**：`delivery_ledger.py` + `rich_sent_store`——跨平台投递按账本重试；
  与 B 的 journal 游标互补（游标管会话流一致性，账本管平台投递）。
- **跨平台连续性**：`mirror.py`——转录所有权唯一（session id），多端只是同一日志的
  视图；任何端不得自持会话状态。
- **并发**：turn lease 在 B 桥接层复用（教训原样适用：守卫必须键在"解析后的会话 id"
  上，路由键会多对一）；同时发消息 = 排队 + 先答先赢。
- **常驻化**：`scale_to_zero.py` 思路——核心空闲休眠、按需唤醒，支撑低成本 VPS 部署
  （远期出公网还需隧道/反代 + HTTPS，官方不管这层）。
- **可选**：`shutdown_forensics`（崩溃取证落盘）对照 sidecar 的 stderr 转发增强。
