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
