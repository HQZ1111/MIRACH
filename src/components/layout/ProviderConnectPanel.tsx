/**
 * ProviderConnectPanel — 保存密码后出现的「配置推理提供商」面板
 *
 * 表单结构参考 deepseek-harness-master（apps/web 的 ui-settings-models）的
 * 添加提供方 / 添加自定义提供方：
 * - 添加提供方（我有 API 密钥）：提供商 + API key + 折叠「自定义设置」
 *   （Base URL / 协议 / 模型列表；模型列表支持「获取模型」候选勾选 + 手动添加）
 * - 添加自定义提供方（自定义端点）：路由 id + 显示名 + Base URL + 协议
 *   + API key + 模型列表（至少一个模型）；路由 id 格式校验、禁止与已有重复
 *
 * 存储（mock 原型，密钥明文不落盘）：
 * - 提供商 API key → store/connectProvider（与设置页共享连接状态）
 * - 提供商 baseURL/协议/模型 → localStorage `mirach.providerProfiles.v1`
 * - 自定义提供方 → localStorage `mirach.customProviders.v1`
 *
 * 连接验证（设置完模型后）：
 * - 「测试连接」只测不存，「保存」先保存再测；成功后底部出现「进入主页」按钮
 *   （点击进入主界面；也可用登录页右下角 >> 跳过配置直接进入）
 * - mock 下走 getApi().getModels() 作成功探测；Base URL 含 invalid/bad 时模拟失败
 *
 * 下拉/折叠组件（2026-08-14 按 zosma 连接页校准）：
 * - 下拉 select：参考 zosma 连接页 Provider select —— 一体化内联原生 select
 *   （appearance-none 去掉 Windows 蓝色角伪影，自绘 ChevronDown 图标）
 * - 两个入口 + 自定义设置：参考 CustomProviderRow 卡片 —— 头部按钮 + 旋转
 *   ChevronDown + borderTop 内容区。外观全部走 index.css 的 .dropdown-card
 *   令牌（--color-dropdown-* / .dropdown-card-trigger 等）；以后换下拉栏
 *   只需改令牌，本组件与侧栏自动生效。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, ChevronRight, ChevronsRight, Key, Plus, RefreshCw, Server, Settings2, Trash2, X } from "lucide-react";
import { useStore } from "@nanostores/react";
import { invoke } from "@tauri-apps/api/core";
import { connectProvider } from "@/store/providers";
import { $providerConfig, saveProviderConfig, getProviderConfig, type ProviderConfig } from "@/store/providerConfig";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";

// ----------------------------------------------------------------
// 模型行 + 容量 K/M 文本
// ----------------------------------------------------------------

export interface ModelRow {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}

const K = 1000;

/** 容量显示：256000 → 256K / 2000000 → 2M / 2560 → 2560 */
function formatCapacity(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= K && n % K === 0) return `${n / K}K`;
  return String(n);
}

/** 容量解析："256K" → 256000、"2M" → 2000000、空/非法 → undefined */
function parseCapacity(s: string): number | undefined {
  const t = s.trim().toUpperCase();
  if (!t) return undefined;
  const m = /^(\d+(?:\.\d+)?)(K|M)?$/.exec(t);
  if (!m) return undefined;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return undefined;
  return m[2] === "M" ? num * 1_000_000 : m[2] === "K" ? num * K : num;
}

const CAPACITY_HINT: Record<"cw" | "mt", string> = { cw: "256K", mt: "32K" };

// ----------------------------------------------------------------
// dsh 内置模型目录（llm-deepseek 的 DEFAULT_MODELS，deepseek-official 路由）
// ----------------------------------------------------------------

/** dsh 官方目录：deepseek-v4-flash / deepseek-v4-pro（1M 上下文 / 256K 输出上限） */
const DSH_DEEPSEEK_MODELS: ModelRow[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", contextWindow: 1_000_000, maxTokens: 256_000 },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", contextWindow: 1_000_000, maxTokens: 256_000 },
];

// ----------------------------------------------------------------
// 模型列表编辑器（dsh ModelListEditor）
// ----------------------------------------------------------------

function ModelListEditor({
  models,
  onChange,
  disabled,
  neutral = false,
  endpoint,
}: {
  models: ModelRow[];
  onChange: (rows: ModelRow[]) => void;
  disabled?: boolean;
  /** 设置页内嵌场景：链接按钮去品牌蓝，用中性灰（登录页保留原蓝色） */
  neutral?: boolean;
  /** 表单当前连接信息：填了才允许真连拉模型（relay_probe 直连 {baseURL}/models） */
  endpoint?: { baseURL: string; apiKey: string; protocol: string };
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  // 容量输入缓冲：键 `${i}:cw` / `${i}:mt`，避免输入 "2560" 途中被重写成 "2.5K"
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; label: string }[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const patch = (i: number, next: Partial<ModelRow>): void => {
    onChange(models.map((m, at) => (at === i ? { ...m, ...next } : m)));
  };

  const capacityValue = (m: ModelRow, f: "cw" | "mt"): number | undefined =>
    f === "cw" ? m.contextWindow : m.maxTokens;

  const bufferOf = (i: number, f: "cw" | "mt"): string =>
    buffers[`${i}:${f}`] ?? (capacityValue(models[i], f) === undefined ? "" : formatCapacity(capacityValue(models[i], f) as number));

  const editCapacity = (i: number, f: "cw" | "mt", text: string): void => {
    setBuffers((b) => ({ ...b, [`${i}:${f}`]: text }));
    patch(i, { [f === "cw" ? "contextWindow" : "maxTokens"]: parseCapacity(text) });
  };

  const removeRow = (i: number): void => {
    onChange(models.filter((_, at) => at !== i));
    // 行号下移，缓冲键跟着挪；被删行的缓冲丢弃
    setBuffers((b) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(b)) {
        const at = Number(k.slice(0, k.indexOf(":")));
        if (at === i) continue;
        next[`${at > i ? at - 1 : at}${k.slice(k.indexOf(":"))}`] = v;
      }
      return next;
    });
    setExpanded((s) => {
      const next = new Set<number>();
      for (const at of s) {
        if (at < i) next.add(at);
        else if (at > i) next.add(at - 1);
      }
      return next;
    });
  };

  /**
   * 获取模型：真实直连——复用「测试连接」的 relay_probe（OpenAI 兼容 Bearer /
   * anthropic x-api-key，GET {baseURL}/models），返回的 models 直接进候选。
   * 没填地址/密钥时明确提示而非悄悄回落 mock。
   */
  const fetchModels = async (): Promise<void> => {
    if (!endpoint || !endpoint.baseURL.trim() || !endpoint.apiKey.trim()) {
      setFetchErr("先填写 API 地址和 API 密钥再获取");
      return;
    }
    setBusy(true);
    setFetchErr(null);
    try {
      const r = await invoke<{ ok?: boolean; models?: unknown[]; count?: number }>("relay_probe", {
        baseUrl: endpoint.baseURL.trim(),
        apiKey: endpoint.apiKey.trim(),
        protocol: endpoint.protocol || "openai",
      }).catch((e) => {
        // relay_probe 的 Err 是原始 HTTP/网络文案，翻译成人话（401=key 错、402/403=欠费/权限）
        const raw = String(e ?? "");
        if (/40[13]/.test(raw)) throw new Error("密钥无效或无权限（401/403）——检查 API 密钥是否正确");
        if (/402|quota|insufficient/i.test(raw)) throw new Error("账户余额不足或配额用尽（402）");
        if (/404/.test(raw)) throw new Error("端点路径不对——检查 API 地址是否需要以 /v1 结尾");
        throw new Error(raw || "连接失败");
      });
      const list = (r?.models ?? [])
        .map((m) => {
          const o = m as Record<string, unknown>;
          return {
            id: String(o.id ?? ""),
            label: String(o.name ?? o.id ?? ""),
          };
        })
        .filter((m) => m.id);
      if (list.length === 0) throw new Error("端点未返回模型列表");
      const known = new Set(models.map((m) => m.id));
      setCandidates(list);
      setPicked(new Set(list.filter((m) => !known.has(m.id)).map((m) => m.id)));
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : "获取模型失败");
    } finally {
      setBusy(false);
    }
  };

  const adoptPicked = (): void => {
    if (!candidates) return;
    const merged = [...models];
    for (const c of candidates) {
      if (!picked.has(c.id)) continue;
      if (!merged.some((m) => m.id === c.id)) merged.push({ id: c.id, name: c.label });
    }
    onChange(merged);
    setCandidates(null);
    setPicked(new Set());
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[#303030]">模型列表</span>
        <button
          type="button"
          onClick={() => void fetchModels()}
          disabled={disabled || busy}
          className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted disabled:opacity-40"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2} />
          {busy ? "获取中…" : "获取模型"}
        </button>
      </div>

      {models.length === 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">空列表 = 使用提供方内置目录；添加的行会替换内置目录。</p>
      )}

      <div className="mt-1 space-y-1.5">
        {models.map((m, i) => (
          <div key={i} className="rounded-lg border border-border p-1.5">
            <div className="flex items-center gap-1.5">
              <input
                value={m.id}
                onChange={(e) => patch(i, { id: e.target.value })}
                placeholder="模型 id"
                disabled={disabled}
                className="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#026CFE]"
              />
              <input
                value={m.name ?? ""}
                onChange={(e) => patch(i, { name: e.target.value || undefined })}
                placeholder="名称"
                disabled={disabled}
                className="w-20 rounded-md border border-border px-2 py-1 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#026CFE]"
              />
              <button
                type="button"
                onClick={() =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (!next.delete(i)) next.add(i);
                    return next;
                  })
                }
                title="容量设置"
                disabled={disabled}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
              >
                {expanded.has(i) ? <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} /> : <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />}
              </button>
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="删除该模型"
                disabled={disabled}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-50 hover:text-[#EF4444]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
            {expanded.has(i) && (
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 border-t border-border pt-1.5">
                {(["cw", "mt"] as const).map((f) => (
                  <label key={f} className="block">
                    <span className="text-[11px] text-muted-foreground">{f === "cw" ? "上下文长度" : "最大输出"}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={bufferOf(i, f)}
                      placeholder={CAPACITY_HINT[f]}
                      disabled={disabled}
                      onChange={(e) => editCapacity(i, f, e.target.value)}
                      onBlur={() => {
                        const v = capacityValue(models[i], f);
                        setBuffers((b) => {
                          const next = { ...b };
                          if (v === undefined) delete next[`${i}:${f}`];
                          else next[`${i}:${f}`] = formatCapacity(v);
                          return next;
                        });
                      }}
                      className="w-full rounded-md border border-border px-2 py-1 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#026CFE]"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...models, { id: "" }])}
        disabled={disabled}
        className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${neutral ? "text-[#464646]" : "text-[#026CFE]"}`}
      >
        <Plus className="h-3 w-3" strokeWidth={2.5} />
        添加模型
      </button>

      {fetchErr && <p className="mt-1 text-[11px] text-[#EF4444]">{fetchErr}</p>}

      {candidates && (
        <div className="mt-2 rounded-lg border border-border bg-muted/20 p-2">
          <p className="text-[11px] font-medium text-[#303030]">选择要添加的模型</p>
          <ul className="mt-1 space-y-0.5">
            {candidates.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-1.5 text-[11px] text-[#464646]">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={() =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (!next.delete(c.id)) next.add(c.id);
                        return next;
                      })
                    }
                  />
                  <span className="truncate">{c.id}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={adoptPicked}
              disabled={picked.size === 0}
              className="flex-1 rounded-md bg-[#026CFE] px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              采纳所选
            </button>
            <button
              type="button"
              onClick={() => {
                setCandidates(null);
                setPicked(new Set());
              }}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 通用：标签 + 输入框
// ----------------------------------------------------------------

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  hint,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  hint?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-[#303030]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={`mt-0.5 w-full rounded-md border px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground ${
          invalid ? "border-[#EF4444]" : "border-border focus:border-[#026CFE]"
        }`}
      />
      {hint && <span className={`mt-0.5 block text-[10px] ${invalid ? "text-[#EF4444]" : "text-muted-foreground"}`}>{hint}</span>}
    </label>
  );
}

// 协议 = dsh llm-pi-ai supportedProtocols() 的三种
const PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

/**
 * 下拉（一体卡片，与设置页 TokenSelect / zosma CustomProviderRow 同款）：
 * .dropdown-card 外壳包住头部按钮（当前选中值 + 旋转 ChevronDown）+ borderTop
 * 分隔的选项区，整个是一个圆角卡片在长高；非「按钮 + 独立边框阴影的分离浮层」。
 * 展开/收起走 motion 高度动画，切换选项时下方内容不跳动。
 * 外观走 .dropdown-card 系列令牌；点外部关闭
 */
function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  // 点击组件外部 → 收起
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <label className="block">
      <span className="text-[11px] font-medium text-[#303030]">{label}</span>
      <div ref={wrapRef} className="mt-0.5">
        <div className="dropdown-card">
          <button
            type="button"
            onClick={() => !disabled && setOpen((v) => !v)}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="dropdown-card-trigger dropdown-card-trigger-sm justify-between disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="min-w-0 truncate">{selected?.label ?? value}</span>
            <ChevronDown
              className={`dropdown-card-chevron shrink-0 ${open ? "rotate-180" : ""}`}
              strokeWidth={2}
            />
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="select-menu"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={{ overflow: "hidden" }}
              >
                <div className="dropdown-card-body">
                  {options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className="block w-full px-3.5 py-2 text-left text-body-sm transition-colors hover:bg-[var(--color-dropdown-hover)]"
                      style={{ color: "var(--color-dropdown-title)" }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </label>
  );
}

// ----------------------------------------------------------------
// 连接测试：配置完模型后验证连接是否成功
// ----------------------------------------------------------------

type TestState = "idle" | "testing" | "ok" | "fail";

/** 探测端点连通性（真实直连 AI 供应商，2026-08-14 起）。
 *  桌面（Tauri）：invoke("relay_probe") → Rust 真实 GET {baseURL}/v1/models 带 API key，
 *  成功返回模型目录数；失败返回后端真实错误（HTTP 状态 / 连接错误）。
 *  浏览器 preview：无 Tauri 运行时，降级模拟（endpoint 含 invalid/bad 模拟失败）。
 */
export async function probeConnection(opts: {
  baseURL: string;
  key?: string;
  protocol?: string;
}): Promise<{ ok: boolean; msg: string; models?: string[] }> {
  const baseURL = opts.baseURL.trim();
  const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isDesktop) {
    try {
      const r = await invoke<{ ok: boolean; count?: number; models?: string[] }>("relay_probe", {
        baseUrl: baseURL,
        apiKey: opts.key ?? "",
        protocol: opts.protocol ?? "openai-completions",
      });
      return {
        ok: r.ok === true,
        msg: `连接成功 · 模型目录 ${r.count ?? r.models?.length ?? 0} 个`,
        models: r.models,
      };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : "连接失败，请检查端点与密钥" };
    }
  }
  // 浏览器 preview：模拟演示（真实连接需在桌面应用中运行）
  if (MOCK && /(invalid|bad)/i.test(baseURL)) {
    return { ok: false, msg: `无法连接到 ${baseURL || "该端点"}` };
  }
  const list = await getApi().getModels();
  return {
    ok: true,
    msg: `连接成功 · 模型目录 ${list.length} 个（预览模拟）`,
    models: list.map((m) => m.id),
  };
}

/** 测试连接状态行 */
function TestStatus({ test, msg }: { test: TestState; msg: string | null }) {
  if (test === "testing") {
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2} /> 正在测试连接…
      </p>
    );
  }
  if (test === "ok") {
    return (
      <p className="flex items-center gap-1 text-[11px] font-medium text-[#10B981]">
        <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} /> {msg}
      </p>
    );
  }
  if (test === "fail") {
    return (
      <p className="flex items-center gap-1 text-[11px] text-[#EF4444]">
        <X className="h-3 w-3 shrink-0" strokeWidth={2.5} /> {msg}
      </p>
    );
  }
  return null;
}

/** 底部按钮组：测试连接 + 保存；保存成功（saved）后才出现「进入主页」。
 *  测试连接成功只显示成功状态，不进入（2026-08-14 需求：点保存后才能进入）。 */
function SaveAndEnter({
  onTest,
  onSave,
  testing,
  test,
  msg,
  saved,
  onEnter,
  enterLabel = "进入主页",
  neutral = false,
}: {
  onTest: () => void;
  onSave: () => void;
  testing: boolean;
  test: TestState;
  msg: string | null;
  saved: boolean;
  onEnter: () => void;
  enterLabel?: string;
  /** 设置页内嵌场景：主按钮去品牌蓝，用中性深灰（登录页保留原蓝色） */
  neutral?: boolean;
}) {
  return (
    <div className="space-y-2">
      <TestStatus test={test} msg={msg} />
      {test === "ok" && saved ? (
        <button
          onClick={onEnter}
          className="flex w-full items-center justify-center gap-1 rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          {enterLabel}
          <ChevronsRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      ) : (
        <div className="flex gap-1.5">
          <button
            onClick={onTest}
            disabled={testing}
            className="flex items-center justify-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[#464646] transition-colors hover:bg-muted disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${testing ? "animate-spin" : ""}`} strokeWidth={2} />
            测试连接
          </button>
          <button
            onClick={onSave}
            disabled={testing}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 ${neutral ? "bg-[#303030]" : "bg-[#026CFE]"}`}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}

/** 路由 id：小写字母/数字，可用连字符分段，字母开头（同 dsh ROUTE_PATTERN） */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// ----------------------------------------------------------------
// 添加提供方（我有 API 密钥）— dsh ProviderEditor
// ----------------------------------------------------------------

function AddProviderForm({ onDone, enterLabel, neutral = false }: { onDone: () => void; enterLabel?: string; neutral?: boolean }) {
  const savedConfigs = useStore($providerConfig);
  // 提供商选择源 = 已配置的 providerConfig（设置页保存过什么就有什么，含自定义
  // route）+ 内置目录兜底——不再用 providers.ts 的 7 条演示行（假 keyHint/假连接态，
  // 用户记忆中"对齐过 dsh"的那版就是被它顶掉的）
  const providerOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const c of savedConfigs) {
      if (c.id && !seen.has(c.id)) {
        seen.add(c.id);
        opts.push({ value: c.id, label: c.name || c.id });
      }
    }
    for (const b of [
      { value: "deepseek", label: "DeepSeek" },
      { value: "anthropic", label: "Anthropic" },
      { value: "openai", label: "OpenAI" },
      { value: "openrouter", label: "OpenRouter" },
      { value: "gemini", label: "Gemini" },
      { value: "xai", label: "xAI" },
    ]) {
      if (!seen.has(b.value)) {
        seen.add(b.value);
        opts.push(b);
      }
    }
    return opts;
  }, [savedConfigs]);
  const [providerId, setProviderId] = useState("deepseek");
  const [keyDraft, setKeyDraft] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [protocol, setProtocol] = useState<string>(PROTOCOLS[0]);
  // 预填 dsh 官方目录（deepseek-v4-flash / deepseek-v4-pro），与 dsh 模型完全对齐
  const [models, setModels] = useState<ModelRow[]>(DSH_DEEPSEEK_MODELS);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const key = keyDraft.trim();
  const provider = providerOptions.find((p) => p.value === providerId);
  const testing = test === "testing";

  const persist = (): void => {
    // key 走共享 store（设置页立即同步）；完整配置写统一配置源（设置页「模型」区读取）
    connectProvider(providerId, key);
    const cfg: ProviderConfig = {
      id: providerId,
      name: provider?.label ?? providerId,
      kind: "builtin",
      connected: true,
      baseURL: baseURL.trim(),
      protocol,
      apiKey: key,
      models,
      activeModelId: models[0]?.id,
    };
    saveProviderConfig(cfg);
    try {
      const all = JSON.parse(localStorage.getItem("mirach.providerProfiles.v1") ?? "{}") as Record<string, unknown>;
      all[providerId] = {
        ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
        api: protocol,
        models,
      };
      localStorage.setItem("mirach.providerProfiles.v1", JSON.stringify(all));
    } catch {
      /* 存储失败忽略 */
    }
  };

  /** 连接测试：保存按钮 = 先保存再测（成功 → 出现「进入主页」）；
   *  测试连接按钮 = 只测不存（成功只显示状态，不进入）。
   *  探测失败时回写 connected=false，避免设置页「模型」区显示假的「已连接」。 */
  const runTest = async (persistFirst: boolean): Promise<void> => {
    if (!key) {
      setErr("请输入 API key");
      return;
    }
    setErr(null);
    setTest("testing");
    setTestMsg(null);
    setSaved(false);
    if (persistFirst) persist();
    const r = await probeConnection({ baseURL: baseURL.trim(), key, protocol });
    setTest(r.ok ? "ok" : "fail");
    setTestMsg(r.msg);
    if (persistFirst && r.ok) setSaved(true);
    if (persistFirst && !r.ok) {
      // 配置已保存（key 保留），但连接未建立 → 回写未连接状态
      const cfg = getProviderConfig(providerId);
      if (cfg) saveProviderConfig({ ...cfg, connected: false });
    }
  };

  const resetTest = (): void => {
    if (test !== "idle" || saved) {
      setTest("idle");
      setTestMsg(null);
      setSaved(false);
    }
  };

  return (
    <div className="space-y-2">
      <SelectField
        label="提供商"
        value={providerId}
        onChange={(v) => {
          setProviderId(v);
          // 切到 DeepSeek 且模型列表为空 → 自动带上 dsh 内置目录
          if (v === "deepseek" && models.length === 0) {
            setModels(DSH_DEEPSEEK_MODELS);
          }
          resetTest();
        }}
        options={providerOptions}
      />

      <LabeledInput
        label="API 密钥"
        type="password"
        value={keyDraft}
        onChange={(v) => {
          setKeyDraft(v);
          setErr(null);
          resetTest();
        }}
        placeholder="粘贴 API key…"
      />

      {/* 自定义设置（dsh details/summary 折叠区；外壳/头部/chevron/内容区走 .dropdown-card 令牌） */}
      <details className="group dropdown-card">
        <summary className="dropdown-card-trigger list-none [&::-webkit-details-marker]:hidden">
          <Settings2 className="dropdown-card-icon" strokeWidth={2} />
          <span className="text-[11px] font-medium">自定义设置</span>
          <span className="ml-auto text-[10px] text-dropdown-sub">Base URL / 协议 / 模型</span>
          <ChevronDown className="dropdown-card-chevron group-open:rotate-180" strokeWidth={2} />
        </summary>
        <div className="dropdown-card-body space-y-2 p-2.5">
          <LabeledInput
            label="Base URL"
            value={baseURL}
            onChange={(v) => {
              setBaseURL(v);
              resetTest();
            }}
            placeholder={providerId === "deepseek" || providerId === "deepseek-official" ? "https://api.deepseek.com" : "留空使用官方默认"}
          />
          <SelectField
            label="协议（wire protocol）"
            value={protocol}
            onChange={(v) => {
              setProtocol(v);
              resetTest();
            }}
            options={PROTOCOLS.map((p) => ({ value: p, label: p }))}
          />
          <ModelListEditor models={models} onChange={(rows) => { setModels(rows); resetTest(); }} neutral={neutral} endpoint={{ baseURL, apiKey: keyDraft, protocol }} />
        </div>
      </details>

      {err && <p className="text-[11px] text-[#EF4444]">{err}</p>}

      <SaveAndEnter
        test={test}
        msg={testMsg}
        testing={testing}
        saved={saved}
        onTest={() => void runTest(false)}
        onSave={() => void runTest(true)}
        onEnter={onDone}
        enterLabel={enterLabel}
        neutral={neutral}
      />
    </div>
  );
}

// ----------------------------------------------------------------
// 编辑已设置提供商（设置页「已设置模型」卡片 → 编辑）
// 内容与 AddProviderForm 对齐（API 密钥 + Base URL/协议/模型列表），
// 但没有提供商下拉——顶部直接显示提供商名字。
// ----------------------------------------------------------------

export function EditProviderForm({ initial, onDone }: { initial: ProviderConfig; onDone: () => void }) {
  // key 直接回填真值（历史 bug：keyDraft 空初始化 + persist 回退 initial.apiKey，
  // 而 initial.apiKey 曾被写成 baseURL——用户看到的"key 没了"）。password 输入
  // 框里看得见位数可核对；仍允许覆盖输入。
  const [keyDraft, setKeyDraft] = useState(initial.apiKey ?? "");
  const [baseURL, setBaseURL] = useState(initial.baseURL ?? "");
  const [protocol, setProtocol] = useState<string>(initial.protocol || PROTOCOLS[0]);
  const [models, setModels] = useState<ModelRow[]>(initial.models ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const testing = test === "testing";
  const hasKey = initial.connected || Boolean(initial.apiKey);

  const persist = (): void => {
    // key 形状防御：URL 误粘进密钥框（历史 bug 正是 apiKey 存成了 baseURL）
    const cleanKey = (v: string): string => (/^https?:\/\//i.test(v.trim()) ? "" : v.trim());
    const key = cleanKey(keyDraft) || cleanKey(initial.apiKey ?? "");
    if (cleanKey(keyDraft)) connectProvider(initial.id, cleanKey(keyDraft));
    saveProviderConfig({
      ...initial,
      connected: Boolean(key),
      baseURL: baseURL.trim(),
      protocol,
      apiKey: key,
      models,
      activeModelId: models.some((m) => m.id === initial.activeModelId)
        ? initial.activeModelId
        : models[0]?.id,
    });
    try {
      const all = JSON.parse(localStorage.getItem("mirach.providerProfiles.v1") ?? "{}") as Record<string, unknown>;
      all[initial.id] = {
        ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
        api: protocol,
        models,
      };
      localStorage.setItem("mirach.providerProfiles.v1", JSON.stringify(all));
    } catch {
      /* 存储失败忽略 */
    }
  };

  const runTest = async (persistFirst: boolean): Promise<void> => {
    if (!hasKey && !keyDraft.trim()) {
      setErr("请输入 API key");
      return;
    }
    setErr(null);
    setTest("testing");
    setTestMsg(null);
    setSaved(false);
    if (persistFirst) persist();
    const r = await probeConnection({ baseURL: baseURL.trim(), key: keyDraft.trim() || initial.apiKey || undefined, protocol });
    setTest(r.ok ? "ok" : "fail");
    setTestMsg(r.msg);
    if (persistFirst && r.ok) {
      setSaved(true);
      onDone();
    }
  };

  return (
    <div className="space-y-2">
      {/* 提供商名（编辑场景无下拉，直接显示） */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[#303030]">提供商</span>
        <span className="text-body-sm font-medium text-[#303030]">{initial.name}</span>
        {initial.kind === "custom" && (
          <span className="rounded bg-[#6366F1]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#6366F1]">自定义</span>
        )}
      </div>

      <LabeledInput
        label="API 密钥"
        type="password"
        value={keyDraft}
        onChange={(v) => {
          setKeyDraft(v);
          setErr(null);
          resetTest();
        }}
        placeholder={hasKey ? "已连接，可覆盖" : "粘贴 API key…"}
      />

      {/* 自定义设置（同 AddProviderForm 折叠区） */}
      <details className="group dropdown-card">
        <summary className="dropdown-card-trigger list-none [&::-webkit-details-marker]:hidden">
          <Settings2 className="dropdown-card-icon" strokeWidth={2} />
          <span className="text-[11px] font-medium">自定义设置</span>
          <span className="ml-auto text-[10px] text-dropdown-sub">Base URL / 协议 / 模型</span>
          <ChevronDown className="dropdown-card-chevron group-open:rotate-180" strokeWidth={2} />
        </summary>
        <div className="dropdown-card-body space-y-2 p-2.5">
          <LabeledInput
            label="Base URL"
            value={baseURL}
            onChange={(v) => {
              setBaseURL(v);
              resetTest();
            }}
            placeholder={initial.id === "deepseek" || initial.id === "deepseek-official" ? "https://api.deepseek.com" : "留空使用官方默认"}
          />
          <SelectField
            label="协议（wire protocol）"
            value={protocol}
            onChange={(v) => {
              setProtocol(v);
              resetTest();
            }}
            options={PROTOCOLS.map((p) => ({ value: p, label: p }))}
          />
          <ModelListEditor models={models} onChange={(rows) => { setModels(rows); resetTest(); }} neutral endpoint={{ baseURL, apiKey: keyDraft, protocol }} />
        </div>
      </details>

      {err && <p className="text-[11px] text-[#EF4444]">{err}</p>}

      <div className="space-y-2">
        <TestStatus test={test} msg={testMsg} />
        <div className="flex gap-1.5">
          <button
            onClick={() => void runTest(false)}
            disabled={testing}
            className="flex items-center justify-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[#464646] transition-colors hover:bg-muted disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${testing ? "animate-spin" : ""}`} strokeWidth={2} />
            测试连接
          </button>
          <button
            onClick={() => void runTest(true)}
            disabled={testing}
            className="flex-1 rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );

  function resetTest(): void {
    if (test !== "idle" || saved) {
      setTest("idle");
      setTestMsg(null);
      setSaved(false);
    }
  }
}

// ----------------------------------------------------------------
// 添加自定义提供方（自定义端点）— dsh CustomProviderCard
// ----------------------------------------------------------------

function readCustomProviders(): { route: string }[] {
  try {
    return JSON.parse(localStorage.getItem("mirach.customProviders.v1") ?? "[]") as { route: string }[];
  } catch {
    return [];
  }
}

function AddCustomProviderForm({ onDone, enterLabel, neutral = false }: { onDone: () => void; enterLabel?: string; neutral?: boolean }) {
  const [route, setRoute] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [protocol, setProtocol] = useState<string>(PROTOCOLS[0]);
  const [keyDraft, setKeyDraft] = useState("");
  const [models, setModels] = useState<ModelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route);
  const routeTaken = readCustomProviders().some((p) => p.route === route);
  const hasBadModel = models.some((m) => !m.id.trim());
  const ready =
    route.length > 0 && !routeInvalid && !routeTaken &&
    baseURL.trim().length > 0 && models.length > 0 && !hasBadModel;
  const testing = test === "testing";

  const persist = (): void => {
    try {
      // 按 route 覆盖已有条目，避免重复点保存产生重复配置
      const list = JSON.parse(localStorage.getItem("mirach.customProviders.v1") ?? "[]") as Record<string, unknown>[];
      const entry: Record<string, unknown> = {
        route,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        baseURL: baseURL.trim(),
        api: protocol,
        ...(keyDraft.trim() ? { apiKeyHint: "••••" } : {}),
        models,
      };
      const idx = list.findIndex((p) => p.route === route);
      if (idx >= 0) list[idx] = entry;
      else list.push(entry);
      localStorage.setItem("mirach.customProviders.v1", JSON.stringify(list));
    } catch {
      /* 存储失败忽略 */
    }
    // 完整配置写统一配置源（设置页「模型」区读取；kind=custom 出现在自定义分组）
    saveProviderConfig({
      id: route,
      name: displayName.trim() || route,
      kind: "custom",
      connected: true,
      baseURL: baseURL.trim(),
      protocol,
      apiKey: keyDraft.trim(),
      models,
      activeModelId: models[0]?.id,
    });
  };

  /** 连接测试：保存按钮 = 先保存再测（成功 → 出现「进入主页」）；
   *  测试连接按钮 = 只测不存（成功只显示状态，不进入） */
  const runTest = async (persistFirst: boolean): Promise<void> => {
    if (!ready) {
      if (!route || routeInvalid || routeTaken) setErr("请填写有效的路由 id（小写字母开头，如 acme-gateway）");
      else if (!baseURL.trim()) setErr("请填写 Base URL");
      else setErr("请添加至少一个模型（模型 id 不能为空）");
      return;
    }
    setErr(null);
    setTest("testing");
    setTestMsg(null);
    setSaved(false);
    if (persistFirst) persist();
    const r = await probeConnection({ baseURL: baseURL.trim(), key: keyDraft.trim() || undefined, protocol });
    setTest(r.ok ? "ok" : "fail");
    setTestMsg(r.msg);
    if (persistFirst && r.ok) setSaved(true);
    if (persistFirst && !r.ok) {
      // 配置已保存但连接未建立 → 回写未连接状态（模型区不显示假的「已连接」）
      const cfg = getProviderConfig(route);
      if (cfg) saveProviderConfig({ ...cfg, connected: false });
    }
  };

  const resetTest = (): void => {
    if (test !== "idle" || saved) {
      setTest("idle");
      setTestMsg(null);
      setSaved(false);
    }
  };

  return (
    <div className="space-y-2">
      <LabeledInput
        label="路由 id（provider route）"
        value={route}
        onChange={(v) => {
          setRoute(v);
          resetTest();
        }}
        placeholder="acme-gateway"
        invalid={routeInvalid || routeTaken}
        hint={routeInvalid ? "只能小写字母/数字，连字符分段，字母开头" : routeTaken ? "该路由已存在" : "唯一标识，如 acme-gateway"}
      />
      <LabeledInput
        label="显示名"
        value={displayName}
        onChange={(v) => {
          setDisplayName(v);
          resetTest();
        }}
        placeholder={route || "显示名（可选）"}
      />
      <LabeledInput
        label="Base URL"
        value={baseURL}
        onChange={(v) => {
          setBaseURL(v);
          resetTest();
        }}
        placeholder="https://gateway.example/v1"
      />
      <SelectField
        label="协议（wire protocol）"
        value={protocol}
        onChange={(v) => {
          setProtocol(v);
          resetTest();
        }}
        options={PROTOCOLS.map((p) => ({ value: p, label: p }))}
      />
      <LabeledInput
        label="API 密钥（可选）"
        type="password"
        value={keyDraft}
        onChange={(v) => {
          setKeyDraft(v);
          resetTest();
        }}
        placeholder="留空则用提供方自身认证"
      />
      <div className="rounded-lg border border-border p-2.5">
        <ModelListEditor models={models} onChange={(rows) => { setModels(rows); resetTest(); }} neutral={neutral} endpoint={{ baseURL, apiKey: keyDraft, protocol }} />
      </div>

      {err && <p className="text-[11px] text-[#EF4444]">{err}</p>}

      <SaveAndEnter
        test={test}
        msg={testMsg}
        testing={testing}
        saved={saved}
        onTest={() => void runTest(false)}
        onSave={() => void runTest(true)}
        onEnter={onDone}
        enterLabel={enterLabel}
        neutral={neutral}
      />
    </div>
  );
}

// ----------------------------------------------------------------
// 面板主体：标题 + 两个入口
// ----------------------------------------------------------------

export function ProviderConnectPanel({ onDone, embedded = false }: { onDone: () => void; embedded?: boolean }) {
  const [open, setOpen] = useState<"provider" | "custom" | null>(null);

  return (
    <div className={embedded ? "" : "mt-28"}>
      {!embedded && (
        <>
          <h3 className="text-lg font-bold leading-tight text-[#303030]">让我们配置 Mirach Harness</h3>
          <p className="mt-1 text-xs text-muted-foreground">连接推理提供商以开始对话</p>
        </>
      )}

      {/* 我有 API 密钥（添加提供方）— 参考 zosma CustomProviderRow：
          一张卡片 = 头部按钮（图标+标题+旋转 ChevronDown）+ borderTop 内容区，一体展开。
          外观走 index.css 的 .dropdown-card 令牌（改令牌即全局换下拉栏样式） */}
      <div className="dropdown-card mt-5">
        <button
          onClick={() => setOpen(open === "provider" ? null : "provider")}
          className="dropdown-card-trigger"
        >
          <Key className={`dropdown-card-icon ${embedded ? "" : "text-dropdown-accent"}`} strokeWidth={2} />
          <span className="flex-1 text-body-sm font-medium">我有 API 密钥</span>
          <ChevronDown
            className={`dropdown-card-chevron ${open === "provider" ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </button>
        {open === "provider" && (
          <div className="dropdown-card-body p-3">
            <AddProviderForm onDone={onDone} enterLabel={embedded ? "完成" : undefined} neutral={embedded} />
          </div>
        )}
      </div>

      {/* 自定义端点（添加自定义提供方） */}
      <div className="dropdown-card mt-3">
        <button
          onClick={() => setOpen(open === "custom" ? null : "custom")}
          className="dropdown-card-trigger"
        >
          <Server className={`dropdown-card-icon ${embedded ? "" : "text-dropdown-accent"}`} strokeWidth={2} />
          <span className="flex-1 text-body-sm font-medium">自定义端点</span>
          <ChevronDown
            className={`dropdown-card-chevron ${open === "custom" ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </button>
        {open === "custom" && (
          <div className="dropdown-card-body p-3">
            <AddCustomProviderForm onDone={onDone} enterLabel={embedded ? "完成" : undefined} neutral={embedded} />
          </div>
        )}
      </div>
    </div>
  );
}
