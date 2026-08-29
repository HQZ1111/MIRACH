/**
 * CommandPalette — 顶部命令搜索下拉（对齐原型 command-palette）
 *
 * 搜索框在外部（主栏顶部命令搜索框），本组件只负责过滤后的结果下拉：
 * 分组（跳转 / 右侧面板 / 外观 / 设置），↑↓ + Enter 选择执行，Esc 关闭。
 * 查询由外部受控（query）；键盘导航绑定到外部搜索输入框（bindInput），
 * 搜索框隐藏的窄宽度场景降级绑定 window（⌘K 仍可用）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface CommandPaletteAction {
  id: string;
  label: string;
  group: string;
  /** 右侧灰字提示（快捷键/说明） */
  hint?: string;
  /** 额外搜索关键词 */
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
  /** 外部受控查询（主栏顶部搜索框输入值） */
  query: string;
  /** 绑定的搜索输入框：键盘导航绑定在它上面（未提供时降级 window） */
  bindInput?: React.RefObject<HTMLInputElement | null>;
  /** 下拉面板定位类 */
  panelClassName?: string;
  /** 一体模式：不渲染遮罩/悬浮层，只输出结果列表（嵌入外层 dropdown-card 的 body，
      与左侧栏「已置顶会话」同款一体展开，无弹窗感） */
  inline?: boolean;
}

// ---- 打分模糊匹配（参考 zosma commandFilter） ----

function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (const ch of s) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return i === q.length;
}

function scoreAction(a: CommandPaletteAction, q: string): number {
  const label = a.label.toLowerCase();
  const hay = `${a.label} ${a.keywords ?? ""} ${a.hint ?? ""} ${a.group}`
    .toLowerCase()
    .replace(/\s+/g, "");
  if (label === q) return 100;
  if (label.startsWith(q)) return 75;
  if (isSubsequence(q, label)) return 50;
  if (hay.includes(q)) return 20;
  return 0;
}

/** 把 label 按命中切成 [{text, hit}] 分段（子序列匹配逐字高亮） */
function highlightSegments(label: string, q: string): { text: string; hit: boolean }[] {
  if (!q) return [{ text: label, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let qi = 0;
  let buf = "";
  for (const ch of label) {
    if (qi < q.length && ch.toLowerCase() === q[qi]) {
      if (buf) {
        out.push({ text: buf, hit: false });
        buf = "";
      }
      out.push({ text: ch, hit: true });
      qi += 1;
    } else {
      buf += ch;
    }
  }
  if (buf) out.push({ text: buf, hit: false });
  return out;
}

export function CommandPalette({
  open,
  onClose,
  actions,
  query,
  bindInput,
  panelClassName,
  inline = false,
}: CommandPaletteProps) {
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 打分模糊匹配（参考 zosma commandFilter）：exact > 前缀 > 子序列 > 描述包含
  const { groups, flat } = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) {
      const gs: { name: string; items: CommandPaletteAction[] }[] = [];
      const seen = new Map<string, CommandPaletteAction[]>();
      for (const a of actions) {
        const arr = seen.get(a.group) ?? [];
        if (arr.length === 0) gs.push({ name: a.group, items: arr });
        arr.push(a);
        seen.set(a.group, arr);
      }
      return { groups: gs, flat: actions };
    }
    const scored = actions
      .map((a) => ({ a, s: scoreAction(a, q) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s);
    const matches = scored.map((x) => x.a);
    const gs: { name: string; items: CommandPaletteAction[] }[] = [];
    const seen = new Map<string, CommandPaletteAction[]>();
    for (const a of matches) {
      const arr = seen.get(a.group) ?? [];
      if (arr.length === 0) gs.push({ name: a.group, items: arr });
      arr.push(a);
      seen.set(a.group, arr);
    }
    return { groups: gs, flat: matches };
  }, [actions, query]);

  // 查询变化时回到第一项；列表收缩时修正越界
  useEffect(() => {
    setSel(0);
  }, [query]);
  useEffect(() => {
    if (flat.length === 0) setSel(0);
    else if (sel >= flat.length) setSel(flat.length - 1);
  }, [flat.length, sel]);

  // 选中项滚动到可见区域
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // 键盘导航：绑定到外部搜索框（或 window），ref 引用最新值避免重复绑定
  const latest = useRef({ flat, sel, onClose });
  latest.current = { flat, sel, onClose };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const { flat: list, sel: i, onClose: close } = latest.current;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, list.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const a = list[i];
        if (a) {
          a.run();
          close();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const el = bindInput?.current;
    if (el) {
      el.addEventListener("keydown", onKeyDown);
      return () => el.removeEventListener("keydown", onKeyDown);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, bindInput]);

  if (!open) return null;

  let flatIdx = 0;

  // 列表内容（分组 + 选项；两个渲染分支共用）
  const listContent = (
    <>
      {flat.length === 0 && (
        <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">无匹配结果</p>
      )}
      {groups.map((g) => (
        <div key={g.name}>
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {g.name}
          </p>
          {g.items.map((a) => {
            const idx = flatIdx++;
            return (
              <button
                key={a.id}
                data-idx={idx}
                onMouseEnter={() => setSel(idx)}
                onClick={() => {
                  a.run();
                  onClose();
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left transition-colors",
                  // bg-dropdown-hover = @theme --color-dropdown-hover 生成的 utilities（暗色自动跟随令牌）
                  idx === sel ? "bg-dropdown-hover" : "hover:bg-dropdown-hover",
                )}
              >
                <span className="flex-1 truncate text-body-sm text-[#303030]">
                  {highlightSegments(a.label, query.trim().replace(/\s+/g, "")).map((s, i) =>
                    s.hit ? (
                      <mark key={i} className="rounded-sm bg-yellow-200/80 text-inherit">
                        {s.text}
                      </mark>
                    ) : (
                      <span key={i}>{s.text}</span>
                    ),
                  )}
                </span>
                {a.hint && (
                  <span className="shrink-0 text-body-sm text-muted-foreground">{a.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );

  // 一体模式：纯结果区（由外层 dropdown-card 提供卡片外壳 + borderTop 分隔）
  if (inline) {
    return (
      <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1 border-t border-dropdown-border">
        {listContent}
      </div>
    );
  }

  // 悬浮模式（窄宽度 ⌘K 兜底）：遮罩 + 卡片下拉
  return (
    <>
      {/* 透明遮罩：点击关闭，不调暗背景 */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* 结果下拉：一体卡片式（.dropdown-card 令牌，与左侧栏「已置顶会话」同款） */}
      <div
        ref={listRef}
        className={cn(
          "dropdown-card panel-glass menu-anim absolute z-50 overflow-hidden",
          panelClassName ?? "right-0 top-full mt-1 w-[440px]",
        )}
      >
        <div className="max-h-[360px] overflow-y-auto p-1">{listContent}</div>
      </div>
    </>
  );
}
