/**
 * dsh-kernel/boot 鈥?瀹樻柟瀹㈡埛绔唴鏍告縺娲伙紙B 闃舵 2锛? *
 * 鍥涗釜 cordis apply 鎸変緷璧栧簭婵€娲伙紙璺宠繃 modules bundle 绯荤粺锛寁ite 鐩存帴鎵撳寘
 * 鍚勫寘鐨?lib 浜х墿锛夛細
 *   1. typert-registry/client  鈥?瀹㈡埛绔弽灏勬牴锛坕nject: []锛? *   2. client-connection/client 鈥?ctx.connection锛圚TTP POST + /api/remote.mux WS锛? *      dev 鏈熺粡 vite 浠ｇ悊鍚屾簮鍖栵級
 *   3. api-gateway/client       鈥?ctx.remote 涓?remote.<ns>锛坕nject: typert+connection锛? *   4. api-session-controller/client 鈥?ctx.sessions锛圛Sessions锛氬垪琛?浜嬩欢婧?鎶曞奖/
 *      prompt/cancel锛夛紝inject 鍚?remote.commands/session/subagents锛堢綉鍏?apply 鎻愪緵锛? *
 * 闀滃儚绛栫暐锛堝閲忔帴绠★紝鍥炴粴瀹夊叏锛夛細鍐呮牳浜嬩欢涓?sidecar raw_session_event 鍚屼竴
 * seq 绌洪棿 鈫?鍏ㄩ儴鍠?$rawEvents锛坰eq 鍘婚噸锛夛紝sidecar 绠￠亾鐓у父骞惰锛沀I 缁勪欢
 * 锛圫tatsLine/杞ㄨ抗/鍗犵敤鐜級鍥犳寮€濮嬫秷璐瑰唴鏍告暟鎹紝娑堟伅绠￠亾鍒囨崲鐣欑粰闃舵 3銆? * 寮€鍏筹細VITE_KERNEL=1锛坢ain.tsx 鍒ゅ畾锛夈€? */

import "./module-loader-shim";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import "@deepseek-ai/dsh-client-connection/client";
import "@deepseek-ai/dsh-api-gateway/client";
import "@deepseek-ai/dsh-api-remotes/client";
import "@deepseek-ai/dsh-api-session-controller/client";
// 酒馆 client bundle（原生"酒馆管理"设置面板，vite 别名指向 dsh-plugins 绝对路径；
// 依赖 ctx.slots/ctx.locale —— 在 typert 实例化后由下方 shim 提供）
import "dsh-tavern/client";
import { Context } from "@deepseek-ai/cordis";
import { pushRawEvents, pushRawEvent } from "@/store/session-events";
import { recordUsage } from "@/store/usage";
import { $activeSessionId } from "@/store/session";
import { bundleRequire } from "./module-loader-shim";
import { createDshBridge, type KernelBridge } from "./dsh-bridge";
import { logInfo, logWarn } from "./kernel-log";

/** 鍐呮牳鎻掍欢婵€娲婚『搴忥紙modules 绯荤粺 bundle id 鈫?瀹炰緥鍖?鈫?cordis plugin锛夈€?*/
const KERNEL_PLUGINS = [
  "@deepseek-ai/dsh-client-connection/client",
  "@deepseek-ai/dsh-api-gateway/client",
  "@deepseek-ai/dsh-api-remotes/client",
  "@deepseek-ai/dsh-api-session-controller/client",
];

/** 鍐呮牳 Cordis 涓婁笅鏂囷紙闀滃儚灞備笌闃舵 3 鍐欎晶鍏辩敤锛夈€?*/
let kernelCtx: Context | null = null;
/** pi 妗ワ紙鍐呮牳浜嬩欢 鈫?$chat锛夈€?*/
let bridge: KernelBridge | null = null;
/** 鍐呮牳鍙戦€佷娇鐢ㄧ殑鏍稿績浼氳瘽 id銆?*/
let activeCoreSessionId: string | null = null;

export function kernelContext(): Context | null {
  return kernelCtx;
}

// ── 酒馆原生面板（client bundle 的 settings.section 槽位） ──

interface NativeSlotEntry {
  meta: { id?: string; name?: string; label?: () => string };
  render: (props: unknown) => unknown;
}

const nativeSlotRegistry = new Map<string, NativeSlotEntry[]>();

/** 官方 client 侧 slots/locale 的最小 shim（酒馆 bundle 依赖这两个服务） */
function installClientShims(ctx: Context): void {
  const host = ctx as unknown as Record<string, unknown>;
  const dicts = new Map<string, Record<string, Record<string, string>>>();
  host.locale = {
    register: (ns: string, dict: Record<string, Record<string, string>>): void => {
      dicts.set(ns, dict);
    },
    bind: (ns: string) =>
      (key: string, vars?: Record<string, unknown>): string => {
        const lang = typeof localStorage !== "undefined" && localStorage.getItem("mirach.lang") === "en" ? "en" : "zh";
        const d = dicts.get(ns)?.[lang] ?? dicts.get(ns)?.zh ?? {};
        let s = d[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(String(v));
        return s;
      },
  };
  host.slots = {
    register: (meta: { name?: string }, render: (props: unknown) => unknown): unknown => {
      const keyName = meta?.name ?? "";
      const list = nativeSlotRegistry.get(keyName) ?? [];
      list.push({ meta: meta as NativeSlotEntry["meta"], render });
      nativeSlotRegistry.set(keyName, list);
      return { meta, render };
    },
    inject: (_name: string, factory: () => unknown): unknown => factory(),
  };
}

export interface NativeSection {
  id: string;
  label: string;
  render: (props: unknown) => unknown;
}

/** 酒馆原生"酒馆管理"设置面板（bundle 注册进 settings.section 槽位）；未加载返回 null */
export function nativeTavernSection(): NativeSection | null {
  const list = nativeSlotRegistry.get("settings.section");
  const hit = list?.find((e) => e.meta.id === "tavern-manager");
  if (!hit) return null;
  return { id: "tavern-manager", label: hit.meta.label?.() ?? "酒馆管理", render: hit.render };
}

/** 婵€娲诲畼鏂瑰鎴风鍐呮牳骞跺紑濮嬮暅鍍忥紱澶辫触鍙憡璀︿笉闃诲搴旂敤锛坰idecar 绠￠亾鍏滃簳锛夈€?*/
export async function bootKernelMirror(): Promise<void> {
  try {
    const ctx = new Context();
    for (const id of KERNEL_PLUGINS) {
      const mod = bundleRequire(id) as { inject?: string[]; apply: (c: Context) => unknown };
      if (mod?.apply === undefined) throw new Error(`plugin ${id} has no apply`);
      await ctx.plugin(mod);
    }
    // typert 客户端反射根：bundle 注册实测不稳定，直接实例化主类（与 client apply 等价）
    new (TypertRegistry as unknown as { new (ctx: Context): unknown })(ctx);
    kernelCtx = ctx;
    // ── 酒馆原生面板挂载 ──
    // 官方 client 侧 slots/locale 服务由 client-runtime 提供，mirach 内核镜像
    // 不加载完整 client-runtime —— 这里装最小 shim（register/inject、locale
    // 字典），让酒馆 client bundle 的 apply(ctx) 能注册 settings.section。
    installClientShims(ctx);
    try {
      const tavern = bundleRequire("dsh-tavern") as { apply?: (c: Context) => void };
      tavern?.apply?.(ctx);
      logInfo("tavern native panel registered");
    } catch (err) {
      logWarn("tavern native panel mount failed: %s", err instanceof Error ? err.message : String(err));
    }
    bridge = createDshBridge();

    const sessions = (ctx as unknown as { sessions: KernelSessions }).sessions;
    if (!sessions) {
      console.warn("[dsh-kernel] ctx.sessions missing 鈥?kernel inactive");
      return;
    }
    await sessions.refresh().catch(() => {});

    // 鎵撳紑鍒楄〃閲岀殑绗竴涓細璇濓紙鏃犱細璇濆垯鍐呮牳浠嶄繚鎸佽繛鎺ョ瓑寰?api-session/added锛?
    const first = firstSessionId(sessions);
    if (first) sessions.open(first);

    logInfo("kernel booted: sessions=%d", countSessions(sessions));
  } catch (err) {
    console.warn("[dsh-kernel] boot failed (sidecar 管道继续兜底):", err);
    // 向上抛：kernelSend 的回退路径会把原因写进聊天区（不再静默）
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ---- 鍐呮牳浼氳瘽闈紙ISessions 鐨勬渶灏忎娇鐢ㄥ垏鐗囷紱閬垮厤绫诲瀷娣变緷璧栵級 ----

interface KernelSessions {
  refresh(): Promise<void>;
  open(id: string): void;
  binding(id: string): KernelBinding | undefined;
  [key: string]: unknown;
}

interface KernelBinding {
  readonly eventSource: KernelEventSource;
  /** 瀹樻柟 SessionFace锛坧rompt/cancel/rename鈥︼級锛屽唴鏍稿彂閫佷綅浣跨敤銆?*/
  readonly session: {
    prompt(text: string, mode: "queue" | "steer"): Promise<void>;
    cancel?(): Promise<void>;
  };
}

/** 瀹樻柟 SessionEventSource锛氬揩鐓?+ 澧為噺绐楀彛锛坮eplace/prepend/append锛屽甫 revision锛夈€?*/
interface KernelEventSource {
  getSnapshot(): KernelEventWindow;
  subscribe(fn: () => void): () => void;
}

interface KernelEventWindow {
  readonly revision: number;
  readonly entries: readonly { readonly event: { type: string; seq: number; time: number; data: unknown } }[];
  readonly change?: { readonly kind: "replace" | "prepend" | "append"; readonly entries?: readonly unknown[] };
}

function firstSessionId(sessions: KernelSessions): string | null {
  const listState = (sessions as unknown as {
    list?: { getSnapshot?: () => { ids?: readonly string[] } };
  }).list;
  const ids = listState?.getSnapshot?.().ids;
  return ids && ids.length > 0 ? ids[0]! : null;
}

function countSessions(sessions: KernelSessions): number {
  const listState = (sessions as unknown as {
    list?: { getSnapshot?: () => { ids?: readonly string[] } };
  }).list;
  return listState?.getSnapshot?.().ids?.length ?? 0;
}

// ---- 浜嬩欢闀滃儚锛氬畼鏂逛簨浠剁獥鍙?鈫?mirach stores ----

/** 宸查暅鍍忕殑浼氳瘽闆嗙姸鎬侊紙鎸?sessionId 瀛橈紝闃?.eventSource 閲嶅缓澶辨晥锛夈€?*/
const mirrorState = new Map<
  string,
  { watermark: number; source: KernelEventSource; unsubscribe: () => void }
>();

/**
 * 璁㈤槄涓€涓細璇濈殑浜嬩欢绐楀彛骞舵妸浜嬩欢闀滃儚杩?mirach stores锛? *   - 鍏ㄩ噺鏉＄洰 鈫?pushRawEvents锛坰eq 鍘婚噸锛?rawEvents/$assembly 娑堣垂锛? *   - usage 浜嬩欢 鈫?recordUsage锛圕omposer 鐢ㄩ噺闈㈡澘锛? *   - 姘翠綅涔嬪悗鐨勬柊浜嬩欢 鈫?pi 妗?鈫?$chat
 * 棣栨鏆磋湰鏈熬浣滄按浣嶏紙鍘嗗彶宸辩 loadLiveHistory 涓婁睆锛屼笉閲嶆斁闃插弻姘旀场锛夈? * 涓?sidecar 鐨?raw_session_event 鍙岄瀹夊叏锛氬悓寮曟搸鍚?seq锛屽幓閲嶅嵆鍚堟祦銆? */
export function mirrorSessionEvents(sessions: KernelSessions, sessionId: string): void {
  const st = mirrorState.get(sessionId);
  if (st !== undefined) {
    // 事件源被重建（重连/重新 open）则退订旧实例并重挂
    if (sessions.binding(sessionId)?.eventSource === st.source) return;
    st.unsubscribe();
    mirrorState.delete(sessionId);
  }
  const binding = sessions.binding(sessionId);
  if (!binding) return;
  const source = binding.eventSource;

  // 首帧：水位置为快照最大 seq（历史已由 loadLiveHistory 上屏，不重放）
  const firstMax = source.getSnapshot().entries.reduce((m, e) => Math.max(m, e.event.seq), -1);
  pushRawEvents(source.getSnapshot().entries.map((e) => e.event));
  const state = { watermark: firstMax, source, unsubscribe: () => {} };
  mirrorState.set(sessionId, state);

  const ingest = (): void => {
    const win = source.getSnapshot();
    const events = win.entries.map((e) => e.event);
    if (events.length > 0) pushRawEvents(events);
    // $chat 桥接：只喂水位之后的新事件（历史不重放，usage 不倍增）
    const wm = state.watermark;
    let maxSeq = wm;
    for (const ev of events) {
      if (ev.seq > wm) {
        bridge?.handle(ev);
        const usage = extractUsage(ev.type, ev.data);
        if (usage) recordUsage(usage);
        if (ev.seq > maxSeq) maxSeq = ev.seq;
      }
    }
    state.watermark = maxSeq;
  };

  ingest();
  const unsubscribe = source.subscribe(ingest);
  state.unsubscribe = unsubscribe;
}

function extractUsage(type: string, data: unknown): Record<string, number> | null {
  if (type === "assistant/message") {
    const u = (data as { usage?: Record<string, number> }).usage;
    return u ?? null;
  }
  if (type === "assistant/chunk") {
    const c = (data as { chunk?: { type?: string; usage?: Record<string, number> } }).chunk;
    return c?.type === "usage" ? (c.usage ?? null) : null;
  }
  return null;
}

/**
 * 鍐呮牳鍙戦€侊紙闃舵 3a锛孷ITE_KERNEL=1 鏃舵浛浠?sidecar submitPromptStream锛夛細
 * 纭繚鏍稿績浼氳瘽锛堝鐢ㄥ凡鎵撳紑鐨勬垨鏂板缓锛夛紝session.prompt 鍏ラ槦锛? * 鍥炲缁忎簨浠舵簮璁㈤槄 鈫?pi 妗?鈫?handleMirachEvent 鍐?$chat銆? */
export async function kernelSend(text: string): Promise<void> {
  // 惰性启动：boot 失败/未完成时在首次发送时重试（对齐 sidecar 的惰性拉起语义）
  if (kernelCtx === null || bridge === null) {
    await bootKernelMirror();
  }
  const ctx = kernelCtx;
  if (ctx === null || bridge === null) throw new Error("kernel not booted");
  // reflect.provide 的规范读取是 ctx.get（属性访问在该 cordis 版本不保证暴露）
  const ctxAny = ctx as unknown as { sessions?: KernelSessions; get?: (k: string) => unknown };
  const sessions = (ctxAny.sessions ?? (typeof ctxAny.get === "function" ? (ctxAny.get("sessions") as KernelSessions | undefined) : undefined)) ?? null;
  if (!sessions) {
    const diag = (["sessions", "remote", "connection", "typert"] as const)
      .map((k) => k + "=" + typeof (ctx as unknown as Record<string, unknown>)[k])
      .join(",");
    throw new Error("kernel has no sessions (" + diag + ")");
  }

  if (activeCoreSessionId === null) {
    const first = firstSessionId(sessions);
    if (first !== null) {
      activeCoreSessionId = first;
    } else if (typeof (sessions as unknown as { create?: () => Promise<string> }).create === "function") {
      activeCoreSessionId = await (sessions as unknown as { create: () => Promise<string> }).create();
    } else {
      throw new Error("kernel: no session to prompt");
    }
    sessions.open(activeCoreSessionId);
  }
  // 纭繚鍙戦€佷細璇濈殑浜嬩欢妗ュ凡璁㈤槄
  mirrorSessionEvents(sessions, activeCoreSessionId);

  const binding = sessions.binding(activeCoreSessionId);
  if (!binding) throw new Error("kernel: binding missing");
  bridge.setSendText(text, $activeSessionId.get() ?? undefined);
  await binding.session.prompt(text, "queue");
}

/** 鍐呮牳鍋滄锛堝綋鍓嶅洖鍚堜腑鏂級銆?*/
export async function kernelStop(): Promise<void> {
  const ctx = kernelCtx;
  if (ctx === null || activeCoreSessionId === null) return;
  const sessions = (ctx as unknown as { sessions: KernelSessions }).sessions;
  const binding = sessions?.binding(activeCoreSessionId);
  const face = binding?.session as { cancel?: () => Promise<void> } | undefined;
  if (face && typeof face.cancel === "function") await face.cancel();
}

export { pushRawEvent };
