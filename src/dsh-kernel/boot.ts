/**
 * dsh-kernel/boot — 官方客户端内核激活（B 阶段 2）
 * 多个 cordis apply 按依赖序激活（跳过 modules bundle 系统；vite 直接打包
 * 各包的 lib 产物）：
 *   1. typert-registry/client — 客户端反射根（inject: []）
 *   2. client-connection/client — ctx.connection（HTTP POST + /api/remote.mux WS；
 *      dev 期经 vite 代理同源化）
 *   3. api-gateway/client — ctx.remote 与 remote.<ns>（inject: typert+connection）
 *   4. api-session-controller/client — ctx.sessions（ISessions：列表/事件源/投影/
 *      prompt/cancel），inject 后 remote.commands/session/subagents（网关 apply 提供）
 * 镜像策略（增量接管，回滚安全）：内核事件与 sidecar raw_session_event 同一
 * seq 空间 → 全部进 $rawEvents（seq 去重），sidecar 管道照常并行；UI 组件
 * （StatsLine/轨迹/占用环）因此开始消费内核数据，消息管道切换留给阶段 3。
 * 开关：VITE_KERNEL=1（main.tsx 判定；VITE_MOCK=0 真实模式默认开启）。
 */

import "./module-loader-shim";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import "@deepseek-ai/dsh-client-connection/client";
import "@deepseek-ai/dsh-api-gateway/client";
import "@deepseek-ai/dsh-api-remotes/client";
// ── 官方附件上传（ctx.fileUpload）：0.1.5 起 api-session-controller 的 inject
//    含 'fileUpload'——缺它 ctx.sessions 永不注册（内核"未连接"的根因）。──
import "@deepseek-ai/dsh-client-file-upload/client";
import "@deepseek-ai/dsh-api-session-controller/client";
// ── 官方 workspace 服务（ctx.workspaces）：ui-workspace/ui-conversation 的
//    inject 依赖（uiWorkspace / workspaces）——缺它 ui-conversation 整插件
//    pending，官方 composer 链（模型 seat / 权限 / 计划）全部不注册。 ──
import "@deepseek-ai/dsh-api-workspace-controller/client";
// ── 官方 client UI 栈（完整加载，dsh 风格渲染 + 原生面板全走官方组件） ──
import "@deepseek-ai/dsh-client-ui-renderer/client";
import "@deepseek-ai/dsh-client-ui-settings/client";
import "@deepseek-ai/dsh-client-locale/client";
// ── 官方设置分区包（settings.section 条目注册者：通用/模型/插件/插件清单/预设） ──
// 注意：只有 ui-settings 框架包不注册任何分区；这些包才注册条目——此前
// KERNEL_PLUGINS 缺这 4 包，官方设置分区从未出现过（用户"官方设置项呢"）。
import "@deepseek-ai/dsh-client-ui-settings-general/client";
import "@deepseek-ai/dsh-client-ui-settings-models/client";
import "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import "@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client";
import "@deepseek-ai/dsh-client-ui-agent-preset/client";
import "@deepseek-ai/dsh-client-ui-session/client";
import "@deepseek-ai/dsh-client-ui-workspace/client";
import "@deepseek-ai/dsh-client-ui-theme/client";
// 官方布局包（CJS bundle，经 shim 注册工厂；bundleRequire 实例化）。
// 固定面板桌面布局适配：官方 narrow 自动折叠（帧宽 < 1024 → 侧栏缩成
// 56 窄轨）只该服务网页版响应式布局。mirach 的官方帧宽度随宿主列拖拽
// 变化——快速拖动右栏把手跨过 1024 阈值时会在窄轨/展开之间来回切换
// （左侧栏闪烁消失）。关闭该断点：侧栏仅随 ⌘B/折叠按钮显式开关变化。
// 注意：不能静态 import 具名导出（bundle 是 CJS，ESM 具名导入直接崩），
// 开关只能经 bundleRequire（与插件循环同一实例）在 boot 里设置。
import "@deepseek-ai/dsh-client-ui-layout/client";
// ui-sidebar：声明 sidebar 槽位链（sidebar.settings 声明在此）——ui-settings
// 分区包的 inject 是 lazy 的（key 未声明不执行），缺它官方设置分区不注册
import "@deepseek-ai/dsh-client-ui-sidebar/client";
import "@deepseek-ai/dsh-client-ui-conversation/client";
import "@deepseek-ai/dsh-client-ui-chat/client";
// ── 官方右侧栏栈（0.1.5 新增）：ctx.sidebarRight 导航控制器 +
//    ctx.sidebarRightTabs 标签类型注册表（多标签/分栏/全屏的官方实现）；
//    resources 是其声明的前置注入面。必须激活：0.1.5 起 ui-chat 的 inject
//    含 'sidebarRight'（文件从对话侧栏打开），缺它 ui-chat 整插件 pending
//    → conversation.view 无 'chat' 条目 → 对话区 viewArea 恒空（消息不渲染）。 ──
import "@deepseek-ai/dsh-client-resources/client";
import "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import "@deepseek-ai/dsh-client-ui-sidebar-files/client";
import "@deepseek-ai/dsh-client-ui-sidebar-textpreview/client";
// 工作区文件资源提供者（dsh-resource://file/... 地址解析；官方 web-app 同款）
import "@deepseek-ai/dsh-api-workspace-files/client";
// ── 输入框 composer seat 官方栈（模型选型/斜杠命令/计划模式/权限预设） ──
// ui-commands 依赖 inputTriggers（ui-input-trigger 提供）；
// ui-model-selection 注册 'model' 词典 + ModelSelect seat 组件；
// ui-plan 注册 'plan' 词典；ui-permission-presets 注册 /permission 弹出选择。
import "@deepseek-ai/dsh-client-ui-input-trigger/client";
import "@deepseek-ai/dsh-client-ui-commands/client";
import "@deepseek-ai/dsh-client-ui-model-selection/client";
import "@deepseek-ai/dsh-client-ui-plan/client";
import "@deepseek-ai/dsh-client-ui-permission-presets/client";
// ── 对话区专属官方栈（dsh 风格官方树内原生提供：目标栏/消息反馈/轨迹/任务） ──
import "@deepseek-ai/dsh-client-ui-goal/client";
import "@deepseek-ai/dsh-client-ui-message-feedback/client";
import "@deepseek-ai/dsh-client-ui-trajectory/client";
import "@deepseek-ai/dsh-client-ui-jobs/client";
import "@deepseek-ai/dsh-client-ui-schedule/client";
// 工具行/附件/会话引用：官方消息流节点（ToolRow/ToolCallTree/图片附件/引用）本体
import "@deepseek-ai/dsh-client-ui-tool/client";
import "@deepseek-ai/dsh-client-ui-attachment/client";
import "@deepseek-ai/dsh-client-ui-reference/client";
// ── 官方品牌标（sidebar.brand.mark / conversation.hero.brand.mark 的注册者） ──
import "@deepseek-ai/dsh-client-ui-brand-official/client";
// 官方工作区目录选择器：native 变体（系统原生目录选择框——官方 desktop 同款；
// browse 变体是应用内自绘浏览器）。引擎侧配套钉 dsh-host-directory-picker-native
// （~/.mirach/profiles/mirach/cordis.patch.yml）。
import "@deepseek-ai/dsh-client-ui-directory-picker-native/client";
// ── 能力包官方栈（skills/subagents/审批/用户提问/产物/工作流运行）──
// 之前因"设置页冻结"回退——根因实为 uSES 快照不稳定 + 内核未激活，与包无关
import "@deepseek-ai/dsh-client-ui-skill/client";
import "@deepseek-ai/dsh-client-ui-subagent/client";
import "@deepseek-ai/dsh-client-ui-approval/client";
import "@deepseek-ai/dsh-client-ui-user-questions/client";
import "@deepseek-ai/dsh-client-ui-deliverables/client";
import "@deepseek-ai/dsh-client-ui-workflow-run/client";
// 酒馆 client bundle（原生"酒馆管理"设置面板，vite 别名指向 dsh-plugins 绝对路径；
// 依赖 ctx.slots/ctx.locale —— 在 typert 实例化后由下方 shim 提供）
import "dsh-tavern/client";
// dsh-pocket client bundle（"手机访问"设置分区：局域网/公网扫码同步访问）
import "dsh-pocket/client";
import { Context } from "@deepseek-ai/cordis";
import type { ReactNode } from "react";
import { pushRawEvents, pushRawEvent } from "@/store/session-events";
import { recordUsage } from "@/store/usage";
import { $activeSessionId } from "@/store/session";
import { setKernelReady } from "@/store/kernel-ready";
import { setKernelConnection, $kernelConnection } from "@/store/kernel-connection";
import { bundleRequire } from "./module-loader-shim";
import { installKernelTransport } from "./transport";
import { createDshBridge, type KernelBridge } from "./dsh-bridge";
import { registerMirachSections } from "./mirach-sections";
import { registerComposerExtras } from "./composer-extras";
import { registerSidebarShell } from "./sidebar-shell";
import { logInfo, logWarn } from "./kernel-log";

/** 鍐呮牳鎻掍欢婵€娲婚『搴忥紙modules 绯荤粺 bundle id 鈫?瀹炰緥鍖?鈫?cordis plugin锛夈€?*/
const KERNEL_PLUGINS = [
  "@deepseek-ai/dsh-client-connection/client",
  "@deepseek-ai/dsh-api-gateway/client",
  "@deepseek-ai/dsh-api-remotes/client",
  // 0.1.5：session-controller 注入 fileUpload（附件上传）——必须先于它激活
  "@deepseek-ai/dsh-client-file-upload/client",
  "@deepseek-ai/dsh-api-session-controller/client",
  "@deepseek-ai/dsh-api-workspace-controller/client",
  // ── 官方 client UI 栈（slots/locale/uiSession/uiConversation/ChatView） ──
  "@deepseek-ai/dsh-client-ui-renderer/client",
  "@deepseek-ai/dsh-client-ui-settings/client",
  "@deepseek-ai/dsh-client-locale/client",
  // ── 官方设置分区（settings.section 条目：通用/模型/插件/插件清单/预设） ──
  "@deepseek-ai/dsh-client-ui-settings-general/client",
  "@deepseek-ai/dsh-client-ui-settings-models/client",
  "@deepseek-ai/dsh-client-ui-settings-plugins/client",
  "@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client",
  "@deepseek-ai/dsh-client-ui-agent-preset/client",
  "@deepseek-ai/dsh-client-ui-session/client",
  "@deepseek-ai/dsh-client-ui-workspace/client",
  "@deepseek-ai/dsh-client-ui-theme/client",
  "@deepseek-ai/dsh-client-ui-layout/client",
  // ui-sidebar 已从官方装配移除：sidebar 槽（含 5 个官方子槽声明：
  // brand.mark/brand.name/workspaces/settings/footer.action）由 mirach 的
  // registerSidebarShell 接管（sidebar-shell.tsx），官方 ui-workspace /
  // ui-settings-general / ui-brand-official 的 slots.inject 会跟随 mirach
  // 声明自动注册 — 每个子槽只允许一次声明，官方包保留会与 mirach 冲突。
  "@deepseek-ai/dsh-client-ui-conversation/client",
  "@deepseek-ai/dsh-client-ui-chat/client",
  // ── 官方右侧栏栈（0.1.5）：多标签/分栏/全屏的官方实现；ui-chat 的
  //    'sidebarRight' 注入依赖它（缺则 ChatView 不注册、对话区恒空）──
  "@deepseek-ai/dsh-client-resources/client",
  "@deepseek-ai/dsh-client-ui-sidebar-right/client",
  "@deepseek-ai/dsh-client-ui-sidebar-files/client",
  "@deepseek-ai/dsh-client-ui-sidebar-textpreview/client",
  "@deepseek-ai/dsh-api-workspace-files/client",
  // ── composer seat 官方栈（顺序：input-trigger → commands → 其余三个） ──
  "@deepseek-ai/dsh-client-ui-input-trigger/client",
  "@deepseek-ai/dsh-client-ui-commands/client",
  "@deepseek-ai/dsh-client-ui-model-selection/client",
  "@deepseek-ai/dsh-client-ui-plan/client",
  "@deepseek-ai/dsh-client-ui-permission-presets/client",
  // ── 对话区专属官方栈（目标栏/消息反馈/轨迹/任务/定时；失败仅降级该包） ──
  "@deepseek-ai/dsh-client-ui-goal/client",
  "@deepseek-ai/dsh-client-ui-message-feedback/client",
  "@deepseek-ai/dsh-client-ui-trajectory/client",
  "@deepseek-ai/dsh-client-ui-jobs/client",
  "@deepseek-ai/dsh-client-ui-schedule/client",
  // 工具行/附件/会话引用（官方消息流节点本体）+ 官方品牌标 + 目录选择器
  "@deepseek-ai/dsh-client-ui-tool/client",
  "@deepseek-ai/dsh-client-ui-attachment/client",
  "@deepseek-ai/dsh-client-ui-reference/client",
  "@deepseek-ai/dsh-client-ui-brand-official/client",
  "@deepseek-ai/dsh-client-ui-directory-picker-native/client",
  // ── 能力包官方栈（skills/subagents/审批/用户提问/产物/工作流运行） ──
  "@deepseek-ai/dsh-client-ui-skill/client",
  "@deepseek-ai/dsh-client-ui-subagent/client",
  "@deepseek-ai/dsh-client-ui-approval/client",
  "@deepseek-ai/dsh-client-ui-user-questions/client",
  "@deepseek-ai/dsh-client-ui-deliverables/client",
  "@deepseek-ai/dsh-client-ui-workflow-run/client",
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

/** 失败插件清单（仪表盘诊断） */
export function kernelPluginFails(): string[] {
  return lastPluginFails;
}
let lastPluginFails: string[] = [];
let deliveryLog = "";
/** 声明骨架交付结果（仪表盘读） */
export function kernelDeliveryLog(): string {
  return deliveryLog;
}

/** 声明骨架注册的 disposer（内核重载时释放） */
let slotDisposers: (() => void)[] = [];

/**
 * mirach 侧补登记官方 slot 声明骨架（sidebar → sidebar.settings →
 * settings.section）。必须在官方根树挂载之后调用（KernelMirrorHost）：
 * 官方 SlotCore 的 children 声明是嵌套 effect——父条目被渲染时声明才写入
 * ledger。官方 web 由 ui-sidebar 提供整套，但其 cordis inject 回调在
 * mirach 内核中静默未达。此处注册骨架条目，且占位组件渲染自己的子槽
 * （renderSlot）——子条目随之被渲染、声明链逐级 live，官方设置分区包
 * （settings-general/models/plugins/…）随即回应声明注册分区条目。
 *
 * 只在官方 sidebar 缺席时注册（register 时检查 entriesOfSlot），且用高
 * priority（100）占闲置位：official 在 0 位渲染、本骨架永不出场；官方缺失
 * 时才成为单元格头开始渲染、逐级激活声明链。sidebar.settings 不需要骨架——
 * single 槽位由官方 ui-settings-general 经 slots.inject 在声明落地时注册，
 * 再注册同 priority 直接撞车（"already has a registration at priority 0"）。
 */
export function deliverSlotDeclarations(ctx: Context): string {
  try {
    const slots = (ctx as unknown as { slots?: unknown }).slots as
      | {
          register?: (entry: Record<string, unknown>, component?: unknown) => (() => void) | unknown;
          entriesOfSlot?: (key: string) => unknown[];
        }
      | undefined;
    if (typeof slots?.register !== "function") {
      deliveryLog = "ERR: register missing";
      return deliveryLog;
    }
    function EmptySlot(props: { renderSlot?: (key: string, owner: object) => unknown }) {
      return typeof props.renderSlot === "function" ? props.renderSlot("sidebar.settings", {}) : null;
    }
    const occupied = slots.entriesOfSlot?.("sidebar")?.length ?? 0;
    if (occupied === 0) {
      const d = slots.register(
        {
          name: "sidebar",
          id: "mirach-sidebar",
          locale: "sidebar",
          priority: 100, // 官方在场时闲置；缺席才渲染激活声明链
          children: { "sidebar.settings": { kind: "single", scope: "root" } },
        },
        EmptySlot,
      );
      if (typeof d === "function") slotDisposers.push(d as () => void);
    }
    deliveryLog = `DONE (sidebar occupied=${occupied})`;
    logInfo("slot declarations delivered: %s", deliveryLog);
    return deliveryLog;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deliveryLog = `ERR: ${msg}`;
    logWarn("slot declarations failed: %s", msg);
    return deliveryLog;
  }
}

/** 空结果常量：uSES getSnapshot 必须返回稳定引用（[] 每次新建会触发重渲染循环） */
const EMPTY_SECTIONS: ReturnType<typeof nativeSettingsSections> = [];
const EMPTY_ENTRIES: ReturnType<typeof nativeSlotEntries> = [];

/** 槽位快照缓存：按 (pick:slotKey, version) 缓存，版本不变返回同一引用 */
let slotCache: { key: string; version: number; list: unknown } | null = null;

function cachedEntriesOf(slotKey: string, pick: "entries" | "entriesOfSlot"): { version: number; list: unknown[] } {
  const EMPTY: unknown[] = [];
  if (!kernelCtx) return { version: 0, list: EMPTY };
  try {
    const slots = (kernelCtx as unknown as Record<string, unknown>).slots as
      | {
          entries?: (name: string) => readonly unknown[];
          entriesOfSlot?: (name: string) => readonly unknown[];
          getVersion?: (name: string) => number;
        }
      | undefined;
    const version = slots?.getVersion?.(slotKey) ?? 0;
    const cacheKey = `${pick}:${slotKey}`;
    if (slotCache !== null && slotCache.key === cacheKey && slotCache.version === version) {
      return { version, list: slotCache.list as unknown[] };
    }
    const list = (pick === "entries" ? slots?.entries?.(slotKey) : slots?.entriesOfSlot?.(slotKey)) ?? [];
    slotCache = { key: cacheKey, version, list: list as unknown[] };
    return { version, list: list as unknown[] };
  } catch {
    return { version: 0, list: EMPTY };
  }
}

/** 读取官方 settings.section 槽位全量（含第三方插件注册的分区），按 order 排序 */
export function nativeSettingsSections(): {
  id: string;
  label: string;
  component: unknown;
  inject?: (...args: never[]) => unknown;
  locale?: string;
  options: Record<string, unknown>;
}[] {
  const { version, list } = cachedEntriesOf("settings.section", "entries");
  // 被调用方作为 uSES getSnapshot 使用：版本不变必须返回**同一引用**，
  // 否则每次渲染都新建数组 → "getSnapshot should be cached" 无限循环。
  if (sectionsCache !== null && sectionsCache.version === version) return sectionsCache.list;
  const entries = list as {
    options?: { id?: unknown; label?: unknown; order?: unknown; [k: string]: unknown };
    component?: unknown;
    inject?: (...args: never[]) => unknown;
    locale?: unknown;
  }[];
  const mapped = entries
    .filter((e) => typeof e.options?.id === "string")
    .map((e) => ({
      id: e.options!.id as string,
      label:
        typeof e.options!.label === "function"
          ? (e.options!.label as () => string)()
          : String(e.options!.label ?? e.options!.id),
      component: e.component,
      ...(typeof e.inject === "function" ? { inject: e.inject as (...args: never[]) => unknown } : {}),
      ...(typeof e.locale === "string" ? { locale: e.locale } : {}),
      options: e.options ?? {},
    }))
    .sort((a, b) => ((a.options.order as number) ?? 0) - ((b.options.order as number) ?? 0));
  const listOut = mapped.length === 0 ? (EMPTY_SECTIONS as ReturnType<typeof nativeSettingsSections>) : mapped;
  sectionsCache = { version, list: listOut };
  return listOut;
}

let sectionsCache: { version: number; list: ReturnType<typeof nativeSettingsSections> } | null = null;

/** 官方 settings.section 槽位版本（uSES 快照用） */
export function nativeSectionsVersion(): number {
  return cachedEntriesOf("settings.section", "entries").version;
}

/** 订阅任意槽位变更（官方 ledger subscribe；返回退订） */
export function nativeSlotSubscribe(key: string, fn: () => void): () => void {
  const ctx = kernelCtx;
  if (ctx === null) return () => {};
  try {
    const slots = (ctx as unknown as { slots?: { subscribe?: (k: string, f: () => void) => () => void } }).slots;
    return slots?.subscribe?.(key, fn) ?? (() => {});
  } catch {
    return () => {};
  }
}

/** 读取任意槽位的当前条目（winners 形态；官方组件 renderSlot shim 用） */
export function nativeSlotEntries(key: string): {
  id?: string;
  component: unknown;
  inject?: (...args: never[]) => unknown;
  locale?: string;
  options: Record<string, unknown>;
}[] {
  const { version, list } = cachedEntriesOf(key, "entriesOfSlot");
  // 同版同引用（SlotRow 的 useMemo 依赖 entry 引用；uSES 快照要求稳定）
  if (entriesCache !== null && entriesCache.key === key && entriesCache.version === version) {
    return entriesCache.list;
  }
  const entries = list as {
    options?: Record<string, unknown>;
    component?: unknown;
    inject?: (...args: never[]) => unknown;
    locale?: unknown;
  }[];
  const mapped = entries.map((e) => ({
    id: typeof e.options?.id === "string" ? (e.options.id as string) : undefined,
    component: e.component,
    ...(typeof e.inject === "function" ? { inject: e.inject as (...args: never[]) => unknown } : {}),
    // locale 是 StoredEntry 的顶层字段（官方渲染器经 entry.locale 合成 t 席位）
    ...(typeof e.locale === "string" ? { locale: e.locale } : {}),
    options: e.options ?? {},
  }));
  const listOut = mapped.length === 0 ? (EMPTY_ENTRIES as ReturnType<typeof nativeSlotEntries>) : mapped;
  entriesCache = { key, version, list: listOut };
  return listOut;
}

let entriesCache: { key: string; version: number; list: ReturnType<typeof nativeSlotEntries> } | null = null;

/** 酒馆原生面板入口（内核 slots 系统注册的 settings.section）；未加载返回 null */
export function nativeTavernSection(): Extract<ReturnType<typeof nativeSettingsSections>, unknown[]> extends infer T
  ? T extends (infer E)[] ? E | null : never
  : never {
  return nativeSettingsSections().find((s) => s.id === "tavern-manager") ?? null;
}

/**
 * 官方 locale 词典绑定（ctx.locale.bind(ns)）：输入框 seat 组件的 t 函数。
 * ns = 官方各插件注册的词典命名空间（'model'/'plan'/'command'…）。
 * 内核未 boot / 词典未注册时返回 null。
 */
export function nativeLocaleTranslate(ns: string): ((key: string, params?: Record<string, unknown>) => string) | null {
  const ctx = kernelCtx;
  if (!ctx) return null;
  try {
    // 规范读取是 ctx.get：reflect.provide 的服务在本 cordis 版本不保证暴露为
    // ctx 属性（ctx.locale 属性访问得到 undefined → t 落到 identity 兜底，
    // 官方行文案显示原始 key）。
    const ctxAny = ctx as unknown as { locale?: { bind?: (n: string) => unknown }; get?: (k: string) => unknown };
    const locale = (typeof ctxAny.get === "function" ? (ctxAny.get("locale") as { bind?: (n: string) => unknown } | undefined) : undefined)
      ?? ctxAny.locale;
    const t = locale?.bind?.(ns);
    return typeof t === "function" ? (t as (key: string, params?: Record<string, unknown>) => string) : null;
  } catch {
    return null;
  }
}

/**
 * 官方模型选型 seat：ui-model-selection 包的 ModelSelect 组件 + 'model' 词典。
 * 库产物不导出组件名（组件经 conversation.input.model 槽条目注入）——
 * 因此本函数只在官方树内可用（NativeChatArea / chatStyle=dsh 时由官方
 * ConversationRoot 以 slot 注入完整 props 渲染）；mirach 自家 Composer 用
 * bundleRequire 拿不到组件本体时返回 null，回退 mirach 自有模型菜单。
 * 不要从 entriesOfSlot 窃取组件：官方条目在无会话 context 时注入面为 null，
 * 单组件双份渲染会把整棵树拖崩。
 */
export function nativeModelSeat(): {
  ModelSelect: (props: Record<string, unknown>) => React.ReactElement | null;
} | null {
  try {
    const mod = bundleRequire("@deepseek-ai/dsh-client-ui-model-selection/client") as {
      ModelSelect?: (props: Record<string, unknown>) => React.ReactElement | null;
    };
    return mod?.ModelSelect ? { ModelSelect: mod.ModelSelect } : null;
  } catch {
    return null;
  }
}

// ---- 官方对话根树（dsh 风格原生融合：AppFrame/conversation/ChatView/Composer） ----

/** 官方根树是否可渲染（内核 slots + renderer 均就绪） */
export function nativeRootTree(): React.ReactNode | null {
  const ctx = kernelCtx;
  if (ctx === null) return null;
  try {
    const slots = (ctx as unknown as {
      slots?: { renderSlot?: (key: string, owner: object) => React.ReactNode };
    }).slots;
    const tree = slots?.renderSlot?.("root", {});
    return tree ?? null;
  } catch {
    return null; // renderer 未安装（boot 未完成/失败）→ 回退 mirach UI
  }
}

/** 内核 sessions 服务是否可用 */
export function nativeSessions(): KernelSessions | null {
  const ctx = kernelCtx;
  if (ctx === null) return null;
  const ctxAny = ctx as unknown as { sessions?: KernelSessions; get?: (k: string) => unknown };
  return (ctxAny.sessions ?? (typeof ctxAny.get === "function" ? (ctxAny.get("sessions") as KernelSessions | undefined) : undefined)) ?? null;
}

/** 官方渲染就绪检查（slots.renderSlot + sessions 服务存在；不含 build 树开销） */
export function nativeRenderReady(): boolean {
  const ctx = kernelCtx;
  if (ctx === null || nativeSessions() === null) return false;
  try {
    const slots = (ctx as unknown as { slots?: { renderSlot?: unknown } }).slots;
    return typeof slots?.renderSlot === "function";
  } catch {
    return false;
  }
}

/** 最近一次请求打开的会话（引擎未连时会话列表为空，open 会失败）——
 *  连接 open 后据此补一次对齐（nativeOpenSession 的延迟重试）。 */
let pendingOpenSessionId: string | null = null;

/**
 * 同步官方 current 会话到目标 dsh 会话：refresh 引擎列表后 open 目标。
 * 官方 ConversationRoot 按 current 渲染；打开即成为官方渲染对象。
 * 引擎未连（列表未到）时 open 会抛 unknown session——记下目标，连接
 * 就绪后由 watchConnectionState 补一次，避免对话区停在空占位。
 */
export async function nativeOpenSession(dshId: string): Promise<void> {
  const sessions = nativeSessions();
  if (sessions === null || !dshId) return;
  pendingOpenSessionId = dshId;
  await sessions.refresh().catch(() => {});
  try {
    sessions.open(dshId);
    pendingOpenSessionId = null;
  } catch (err) {
    logWarn("nativeOpenSession deferred (engine not ready): %s", err instanceof Error ? err.message : String(err));
  }
}

/** 连接就绪后补开上次请求的会话（列表已到，open 不会再 unknown session）。 */
function retryPendingOpenSession(): void {
  const dshId = pendingOpenSessionId;
  if (dshId === null) return;
  pendingOpenSessionId = null;
  void nativeOpenSession(dshId).catch(() => {});
}

/**
 * 官方 goal 投影面（binding.session.projections.faceOf('goal')）：
 * ObservableSnapshot<GoalProjection | null | undefined>，GoalBar 用。
 * 会话未打开/内核不可用 → null。
 */
export function nativeGoalProjection(dshId: string): {
  getSnapshot: () => unknown;
  subscribe: (fn: () => void) => () => void;
} | null {
  const sessions = nativeSessions();
  if (sessions === null) return null;
  try {
    const binding = sessions.binding(dshId) as
      | { session?: { projections?: { faceOf?: (key: string) => { getSnapshot: () => unknown; subscribe: (fn: () => void) => () => void } } } }
      | undefined;
    return binding?.session?.projections?.faceOf?.("goal") ?? null;
  } catch {
    return null;
  }
}

/** 官方 remote.goals 动词面（edit/pause/resume/clear；CAS ref 由调用方从投影取） */
export function nativeGoalsRemote(): Record<string, (...args: unknown[]) => Promise<unknown>> | null {
  const ctx = kernelCtx;
  if (ctx === null) return null;
  try {
    // 规范读取 ctx.get('remote')（属性访问不保证暴露，见 nativeLocaleTranslate）
    const ctxAny = ctx as unknown as { remote?: Record<string, unknown>; get?: (k: string) => unknown };
    const remote = (typeof ctxAny.get === "function" ? (ctxAny.get("remote") as Record<string, unknown> | undefined) : undefined)
      ?? ctxAny.remote;
    const goals = remote?.goals;
    return typeof goals === "object" && goals !== null ? (goals as Record<string, (...args: unknown[]) => Promise<unknown>>) : null;
  } catch {
    return null;
  }
}

/**
 * 折叠官方三栏的 details 列（侧栏列保留展开 —— 渲染 mirach 侧栏外壳）。
 * 走 ctx.layout.closeDetails（偏好归 0）。此前经 ctx.slots.storeOf 取
 * bound actions——该面只存在于渲染器内部 host，服务上没有，调用一直是
 * 静默 no-op（store 默认 details:0 恰好兜住了，未暴露）。
 */
export function nativeCollapsePanels(): void {
  try {
    nativeCloseDetails();
  } catch {
    /* 布局列折叠失败不阻塞渲染 */
  }
}

/**
 * ctx.layout（ILayout 公共面）获取。内核未 boot / 服务缺失返回 null。
 */
function nativeLayout(): {
  openDetails?: () => void;
  closeDetails?: () => void;
} | null {
  const ctx = kernelCtx;
  if (ctx === null) return null;
  try {
    const ctxAny = ctx as unknown as {
      layout?: { openDetails?: () => void; closeDetails?: () => void };
      get?: (k: string) => unknown;
    };
    const layout = ctxAny.layout
      ?? (typeof ctxAny.get === "function" ? (ctxAny.get("layout") as { openDetails?: () => void; closeDetails?: () => void } | undefined) : undefined);
    return layout ?? null;
  } catch {
    return null;
  }
}

type DetailsListener = (open: boolean) => void;
let detailsListener: DetailsListener | null = null;

/**
 * 官方"详情打开请求"监听。信号源是 ctx.layout 的 openDetails/closeDetails
 * （ILayout 公共面——官方工具行"详情"、面板 ✕ 全部经此面写布局 store）。
 * 不直接订阅布局 store：ctx.slots 服务不暴露 storeOf（实例解析是渲染器
 * 内部面），且 solvable 列宽（data-details-collapsed）与"是否请求打开"
 * 在 mirach 布局里是两件事（右栏展开压窄主区时官方让步链自动关列，但
 * 请求仍在）。实现为对 ctx.layout 的方法包装：openDetails 前先通知
 * （同步于 store 写入之前，React 可与官方重渲染同批提交），closeDetails
 * 同理。重复 watch 幂等（包装只打一层）。
 * @returns 解绑函数；内核/服务未就绪时返回 null（调用方轮询重试）。
 */
export function watchNativeDetails(onChange: DetailsListener): (() => void) | null {
  const layout = nativeLayout();
  if (layout === null || typeof layout.openDetails !== "function" || typeof layout.closeDetails !== "function") {
    return null;
  }
  const host = layout as { openDetails: () => void; closeDetails: () => void; __mirachDetailsHooked?: boolean };
  if (!host.__mirachDetailsHooked) {
    const origOpen = host.openDetails.bind(layout);
    const origClose = host.closeDetails.bind(layout);
    host.openDetails = () => { detailsListener?.(true); origOpen(); };
    host.closeDetails = () => { detailsListener?.(false); origClose(); };
    host.__mirachDetailsHooked = true;
  }
  detailsListener = onChange;
  return () => {
    if (detailsListener === onChange) detailsListener = null;
  };
}

/**
 * 关闭官方 details（官方面板 ✕ 同款 closeDetails；偏好归 0，让步链同时
 * 释放列宽）。mirach 右侧栏收起时联动调用——详情的宿主没了。
 */
export function nativeCloseDetails(): boolean {
  const layout = nativeLayout();
  if (layout === null || typeof layout.closeDetails !== "function") return false;
  try {
    layout.closeDetails();
    return true;
  } catch {
    return false;
  }
}

// ── 官方侧栏能力外露（mirach LeftSidebar 复用官方新任务/工作区/会话列表） ──

/**
 * 官方侧栏折叠/展开（⌘B 快捷键走官方 layout.toggleSidebar）：侧栏列宽
 * 由官方 layout store 管理（展开 280 / 折叠 56 rail，折叠态仍渲染 mirach
 * 侧栏外壳及其展开按钮）。
 */
export function nativeToggleSidebar(): boolean {
  const ctx = kernelCtx;
  if (ctx === null) return false;
  try {
    const ctxAny = ctx as unknown as {
      layout?: { toggleSidebar?: () => void };
      get?: (k: string) => unknown;
    };
    const layout = ctxAny.layout
      ?? (typeof ctxAny.get === "function" ? (ctxAny.get("layout") as { toggleSidebar?: () => void } | undefined) : undefined);
    if (typeof layout?.toggleSidebar !== "function") return false;
    layout.toggleSidebar();
    return true;
  } catch {
    return false;
  }
}

/**
 * 官方"新任务"行为（SidebarRoot 新任务按钮同款）：uiWorkspace.startSession
 * —— 继承当前会话工作区 → connectWorkspace（空白会话复用/新建）→ open。
 * 官方打开后由 LeftSidebar 的 OfficialWorkspaceBrowser 反向同步对齐 mirach
 * 活跃会话。fail-loud：内核未 boot / 服务缺失返回 false，调用方显式提示
 * "内核未就绪"，不静默回退 mirach 自有新建（无第二实现）。
 */
export function nativeOfficialStartSession(): boolean {
  const ctx = kernelCtx;
  if (ctx === null) return false;
  try {
    const ctxAny = ctx as unknown as {
      uiWorkspace?: { startSession?: (w?: string) => void };
      get?: (k: string) => unknown;
    };
    const uiWorkspace = ctxAny.uiWorkspace
      ?? (typeof ctxAny.get === "function" ? (ctxAny.get("uiWorkspace") as typeof ctxAny.uiWorkspace | undefined) : undefined);
    if (typeof uiWorkspace?.startSession !== "function") return false;
    uiWorkspace.startSession();
    return true;
  } catch {
    return false;
  }
}

/**
 * 官方工作区/会话浏览器渲染面：renderSlot("sidebar.workspaces", owner) 的
 * ReactNode。该槽为 root scope 单槽，条目由 ui-workspace 的 WorkspaceBrowser
 * 占据（含搜索 + 工作区树 + 全部会话）。mirach LeftSidebar 在自己的树里渲染
 * 该节点即可获得官方会话列表（槽位渲染器全局安装，跨树渲染与官方设置浮出
 * 同机制）。内核未 boot / 渲染失败返回 null（调用方回退 mirach 自有列表）。
 */
export function nativeWorkspaceBrowser(): ReactNode | null {
  const ctx = kernelCtx;
  if (ctx === null) return null;
  try {
    const slots = ctx as unknown as {
      slots?: { renderSlot?: (key: string, owner: object) => ReactNode };
    };
    // wide=true + expandSidebar no-op：mirach 侧栏恒为展开形态，无需回请求展开
    return slots.slots?.renderSlot?.("sidebar.workspaces", { wide: true, expandSidebar: () => {} }) ?? null;
  } catch {
    return null;
  }
}

/**
 * 官方"当前会话"列表订阅面（sessions.list observable）：反向同步用——
 * 用户在官方工作区列表点击会话（sessions.open）后，mirach 侧据此把活跃
 * 会话对齐到映射的前端会话。无内核/服务缺失返回 null。
 */
export function nativeSessionsList(): {
  getSnapshot: () => {
    current?: string;
    byId?: Record<string, { blank?: boolean; title?: string }>;
    jobsBySession?: Record<string, { id: string; status: string; label: string }[]>;
    subagentsByParent?: Record<string, unknown>;
  };
  subscribe: (fn: () => void) => () => void;
} | null {
  const sessions = nativeSessions();
  if (sessions === null) return null;
  const list = (sessions as unknown as {
    list?: {
      getSnapshot: () => {
        current?: string;
        jobsBySession?: Record<string, { id: string; status: string; label: string }[]>;
        subagentsByParent?: Record<string, unknown>;
      };
      subscribe: (fn: () => void) => () => void;
    };
  }).list;
  if (typeof list?.getSnapshot !== "function" || typeof list.subscribe !== "function") return null;
  return list;
}

/** 婵€娲诲畼鏂瑰鎴风鍐呮牳骞跺紑濮嬮暅鍍忥紱澶辫触鍙憡璀︿笉闃诲搴旂敤锛坰idecar 绠￠亾鍏滃簳锛夈€?*/
/** 并发/重复 boot 去重（kernelSend 惰性重试与首次 boot 可能并发） */
let bootPromise: Promise<void> | null = null;

export function bootKernelMirror(): Promise<void> {
  if (bootPromise !== null) return bootPromise;
  bootPromise = bootKernelMirrorOnce().finally(() => {
    bootPromise = null;
  });
  return bootPromise;
}

/** 引擎宿主就绪等待（官方桌面壳同序：宿主先就绪，再引导客户端内核）。
 *  冷启动期内核先行会把 session 控制流打成终态失败——官方流只对"载体故障"
 *  退避重试，宿主缺失属于启动顺序问题，不该让用户等一次终态失败再重试。 */
async function waitForEngineHost(timeoutMs: number): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await invoke<boolean>("dsh_engine_ready")) return;
    } catch {
      /* 命令尚未注册（Rust 启动中）→ 继续等 */
    }
    if (Date.now() >= deadline) {
      throw new Error("引擎未就绪（等待超时）——内核不在宿主离线状态下引导");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** 连接状态订阅世代：boot 重试会新建 ctx，旧 ctx 的状态变化不得覆盖新值。 */
let connectionEpoch = 0;

/**
 * 订阅官方 ctx.connection.state → $kernelConnection（真实连接状态）。
 * 官方取值：connected / connecting / disconnected；undefined = 尚无结论。
 * 映射：connected→open；connecting/undefined→connecting；disconnected→closed。
 */
function watchConnectionState(ctx: Context): void {
  const epoch = ++connectionEpoch;
  const ctxAny = ctx as unknown as {
    connection?: ConnectionStateCarrier;
    get?: (key: string) => unknown;
  };
  // reflect.provide 的服务属性访问不保证暴露（见 nativeLocaleTranslate）→ ctx.get 兜底
  const connection = (ctxAny.connection
    ?? (typeof ctxAny.get === "function" ? (ctxAny.get("connection") as ConnectionStateCarrier | undefined) : undefined)) as
    | ConnectionStateCarrier
    | undefined;
  const stateSource = connection?.state;
  if (stateSource === undefined || typeof stateSource.subscribe !== "function") {
    setKernelConnection("connecting");
    return;
  }
  const apply = (): void => {
    if (epoch !== connectionEpoch) return;
    const state = stateSource.getSnapshot();
    const next = state === "connected"
      ? "open"
      : state === "disconnected"
        ? "closed"
        : "connecting";
    const wasOpen = $kernelConnection.get() === "open";
    setKernelConnection(next);
    // 首次连上：补开 boot 期因列表未到而失败的 current 会话
    if (next === "open" && !wasOpen) retryPendingOpenSession();
  };
  apply();
  try {
    stateSource.subscribe(apply);
  } catch (err) {
    logWarn("kernel connection state subscribe failed: %s", err instanceof Error ? err.message : String(err));
    setKernelConnection("connecting");
  }
}

interface ConnectionStateCarrier {
  state?: {
    getSnapshot: () => "connected" | "connecting" | "disconnected" | undefined;
    subscribe: (fn: () => void) => () => void;
  };
}

async function bootKernelMirrorOnce(): Promise<void> {
  // 重跑前释放上一轮骨架注册与槽位缓存（失败重试路径上 slots 可能已在旧 ctx 里）
  for (const d of slotDisposers) {
    try {
      d();
    } catch {
      /* disposer 失败不阻塞 */
    }
  }
  slotDisposers = [];
  slotCache = null;
  sectionsCache = null;
  entriesCache = null;
  // 就绪门信号复位：本轮 boot 完成前内核视为未就绪（启动页/网关状态点消费）
  setKernelReady(false, null);
  setKernelConnection("idle");
  // 宿主传输桥必须先于任何官方插件 apply：connection/file-upload 在 apply
  // 时读页面全局（__DSH_TRANSPORT__ / __DSH_FILE_UPLOAD__）
  installKernelTransport();
  const pluginFails: string[] = [];
  try {
    // 宿主就绪门：引擎（sidecar + dsh runtime）在线才引导官方客户端栈。
    // 冷启动实测可达数分钟（会话日志多/机器忙），给足 5 分钟。
    await waitForEngineHost(300_000);
    const ctx = new Context();
    // typert 反射根必须先于插件循环：session-controller 的 inject 依赖
    // ['connection','typert','remote',...]，cordis 只在依赖就绪时才 apply
    // 插件——typert 后置会让 session-controller 永远挂起（"ctx.sessions
    // missing — kernel inactive"），整个会话/UI 内核变成半活。
    new (TypertRegistry as unknown as { new (ctx: Context): unknown })(ctx);
    for (const id of KERNEL_PLUGINS) {
      const mod = bundleRequire(id) as { inject?: string[]; apply: (c: Context) => unknown };
      if (mod?.apply === undefined) throw new Error(`plugin ${id} has no apply`);
      // 单插件失败只降级该插件（seat/词典缺失走回退 UI），不拖垮整个内核
      try {
        await ctx.plugin(mod);
      } catch (err) {
        pluginFails.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        logWarn("kernel plugin %s failed (degraded): %s", id, err instanceof Error ? err.message : String(err));
      }
    }
    // 诊断信号：失败插件清单（日志/仪表盘用）
    lastPluginFails = pluginFails;
    // 诊断信号：inject 未满足 → cordis 让整插件 pending（不报错、静默缺失）。
    // 这类"静默 pending"此前造成对话区恒空（0.1.5 ui-chat 需要 sidebarRight）。
    const pendingInjects: string[] = [];
    for (const id of KERNEL_PLUGINS) {
      try {
        const mod = bundleRequire(id) as { inject?: string[] };
        const missing = (mod.inject ?? []).filter((key) => (ctx as unknown as { get?: (k: string) => unknown }).get?.(key) === undefined);
        if (missing.length > 0) pendingInjects.push(`${id} ⇐ ${missing.join(",")}`);
      } catch {
        /* 诊断失败不影响启动 */
      }
    }
    if (pendingInjects.length > 0) {
      logWarn("kernel plugins pending (inject unsatisfied): %s", pendingInjects.join(" | "));
    }
    kernelCtx = ctx;
    // 官方连接状态 → $kernelConnection：ctx.connection.state 是 RPC 载体的
    // 真结论（$events 流 ready 帧后才 connected）。工具栏按钮/启动门/断联
    // 横幅只认它——sidecar 的 ready 标志在引擎冷启动期会假阳性。
    watchConnectionState(ctx);
    // dev 探针：自动化验证/诊断用（scripts/cdp-*.mjs），生产构建无副作用
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mirachCtx = ctx;
    }
    // ── 酒馆原生面板：ctx.slots/ctx.locale 由上面官方 ui-renderer/locale 提供，
    // 不再需要 shim。直接调 apply(ctx) 注册 settings.section。
    try {
      const tavern = bundleRequire("dsh-tavern") as { apply?: (c: Context) => void };
      tavern?.apply?.(ctx);
      logInfo("tavern native panel registered");
    } catch (err) {
      logWarn("tavern native panel mount failed: %s", err instanceof Error ? err.message : String(err));
    }
    // ── dsh-pocket 原生面板（"手机访问"分区；引擎侧代理经 profile bundles 加载）
    try {
      const pocket = bundleRequire("dsh-pocket") as { apply?: (c: Context) => void };
      pocket?.apply?.(ctx);
      logInfo("dsh-pocket native panel registered");
    } catch (err) {
      logWarn("dsh-pocket native panel mount failed: %s", err instanceof Error ? err.message : String(err));
    }
    // ── mirach 自有分区槽位化：注册进官方 settings.section（所有权移交后
    //    官方面板导航自动混排；slots.inject 等声明落地，时机安全）
    registerMirachSections(ctx);
    // ── mirach 输入框附加控件：注入官方 InputBar 子槽（朗读/终端等
    //    mirach 有、官方没有的控件，随官方工具行排布）
    registerComposerExtras(ctx);
    // ── 侧栏窄态断点关闭：官方 AppFrame 的模块级开关，与插件循环共用
    //    bundleRequire 缓存（同一实例）——必须先于树渲染设置。降级仅告警。
    try {
      const layoutBundle = bundleRequire("@deepseek-ai/dsh-client-ui-layout/client") as {
        setSidebarAutoCollapseEnabled?: (enabled: boolean) => void;
      };
      layoutBundle?.setSidebarAutoCollapseEnabled?.(false);
      logInfo("sidebar narrow auto-collapse disabled (fixed-panel layout)");
    } catch (err) {
      logWarn("ui-layout narrow switch unavailable: %s", err instanceof Error ? err.message : String(err));
    }
    // ── mirach 侧栏外壳：接管官方 sidebar 槽（官方 ui-sidebar 已移除，
    //    本注册自带 5 个官方子槽声明 + inject：官方 WorkspaceBrowser/设置
    //    入口经 slots.inject 跟随注册，mirach 自由重排搜索/工作区/会话列表）
    registerSidebarShell(ctx);
    bridge = createDshBridge();

    const sessions = (ctx as unknown as { sessions: KernelSessions }).sessions;
    if (!sessions) {
      // 内核未激活：明确标记未就绪 + 原因（启动页会显示；不再静默停在占位）
      const reason = pluginFails.length > 0
        ? `ctx.sessions 未注册（插件失败：${pluginFails.slice(0, 2).join("; ")}）`
        : "ctx.sessions 未注册（内核插件依赖未满足）";
      console.warn("[dsh-kernel] %s", reason);
      setKernelReady(false, reason);
      setKernelConnection("closed");
      return;
    }
    await sessions.refresh().catch(() => {});

    // 打开列表里的第一个会话（无会话则内核仍保持连接等 api-session/added）
    const first = firstSessionId(sessions);
    if (first) sessions.open(first);

    logInfo("kernel booted: sessions=%d", countSessions(sessions));
    // 内核就绪：ctx.sessions 可用 + 官方根树可渲染 → 放行主界面（启动门消费）
    if (nativeRootTree() !== null) {
      setKernelReady(true, null);
    } else {
      setKernelReady(false, "官方根树未渲染（slots.renderSlot('root') 为空）");
    }
  } catch (err) {
    console.warn("[dsh-kernel] boot failed (sidecar 管道继续兜底):", err);
    setKernelReady(false, err instanceof Error ? err.message : String(err));
    setKernelConnection("closed");
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
