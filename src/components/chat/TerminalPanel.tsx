/**
 * TerminalPanel — 终端页（标签栏 + 终端内容，无边框包裹）
 *
 * ┌────────────────────────────────────────────────┐
 * │ 终端  [Powershell01 ✕]        [＋] [●]        │  ← 标签栏
 * ├────────────────────────────────────────────────┤
 * │  PowerShell 终端（内容直接落底）                │
 * └────────────────────────────────────────────────┘
 *
 * - 标签栏左侧："终端" 文字 + 终端标签（Powershell01…，每个标签可单独关闭）
 * - 右侧：＋ 新增终端标签；红色圆点关闭终端页
 * - 每个标签对应一个独立 pty 会话（id 由全局分配器保证跨面板唯一），
 *   切换标签时卸载旧会话、挂载新会话（Rust 侧按 id 管理多实例）
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { TerminalSection } from "@/components/chat/Terminal";
import { allocateTerminalId, releaseTerminalId } from "@/lib/terminalIds";

export function TerminalPanel({
  height,
  onClose,
}: {
  height: number;
  onClose: () => void;
}) {
  const [tabs, setTabs] = useState<string[]>(() => [allocateTerminalId()]);
  const [active, setActive] = useState<string>(() => tabs[0]);
  // 卸载时释放全部标签 id：成员对话关闭/切换视图等路径不经过 closeTab，
  // 不释放会让分配器 used 集合泄漏，序号持续攀升、命名跳号
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => () => tabsRef.current.forEach(releaseTerminalId), []);
  // 右键菜单：目标标签 + 光标位置（viewport 坐标）
  const [menuTab, setMenuTab] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const addTab = () => {
    const name = allocateTerminalId();
    setTabs((t) => [...t, name]);
    setActive(name);
  };

  // 关闭指定标签；最后一个标签关闭则收起终端页
  const closeTab = (name: string) => {
    releaseTerminalId(name);
    const next = tabs.filter((t) => t !== name);
    if (next.length === 0) {
      onClose();
      return;
    }
    if (active === name) {
      const idx = tabs.indexOf(name);
      setActive(next[Math.min(idx, next.length - 1)]);
    }
    setTabs(next);
  };

  // 右键菜单打开（阻止浏览器默认菜单；菜单贴右/下边缘时收拢避免溢出）
  // 菜单 fixed 定位在面板内（面板 translateZ 使其成为 fixed 包含块），坐标需换算成
  // 面板相对值并按面板尺寸钳制——窗口有 40px 透明边距，按窗口/视口钳制会截断或越界
  const openContextMenu = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    setMenuTab(name);
    const pr = document.querySelector("[data-panel]")?.getBoundingClientRect();
    const left = pr ? e.clientX - pr.left : e.clientX;
    const top = pr ? e.clientY - pr.top : e.clientY;
    setMenuPos({
      x: Math.min(Math.max(left, 0), (pr?.width ?? window.innerWidth) - 152),
      y: Math.min(Math.max(top, 0), (pr?.height ?? window.innerHeight) - 110),
    });
  };

  // 关闭其他标签（保留目标标签并激活）
  const closeOthers = (keep: string) => {
    tabs.forEach((t) => { if (t !== keep) releaseTerminalId(t); });
    setActive(keep);
    setTabs([keep]);
    setMenuTab(null);
  };

  // 关闭全部标签（最后一个关闭即收起终端页）
  const closeAllTabs = () => {
    tabs.forEach((t) => releaseTerminalId(t));
    setTabs([]);
    setMenuTab(null);
    onClose();
  };

  return (
    <div className="flex shrink-0 flex-col px-5 pb-[20px]" style={{ height, minHeight: 150 }}>
      {/* ---- 标签栏 ---- */}
      <div className="flex shrink-0 items-center gap-1 px-1">
        {/* 终端标题（运行状态已移至顶栏显示） */}
        <span className="mr-2 flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground">
          终端
        </span>
        {tabs.map((t) => (
          <span
            key={t}
            className={cn(
              "group flex items-center gap-1 rounded-md px-1.5 py-0.5 text-body-sm transition-colors",
              active === t
                ? "bg-muted text-[#303030]"
                : "text-muted-foreground hover:bg-muted hover:text-[#303030]",
            )}
            onContextMenu={(e) => openContextMenu(e, t)}
            onAuxClick={(e) => {
              // 中键直接关闭标签
              if (e.button === 1) {
                e.preventDefault();
                closeTab(t);
              }
            }}
          >
            <button
              onClick={() => setActive(t)}
              className="flex items-center"
            >
              {t}
            </button>
            <button
              className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-border hover:text-[#303030]"
              title={`关闭 ${t}`}
              onClick={() => closeTab(t)}
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          </span>
        ))}

        <div className="ml-auto flex items-center gap-1">
          {/* 新增终端 */}
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
            title="新增终端"
            onClick={addTab}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
          </button>
          {/* 关闭（正常关闭图标） */}
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
            title="关闭终端"
            onClick={onClose}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ---- 终端内容（每个标签挂载独立 pty 会话，切换即卸载/重挂） ---- */}
      <div className="min-h-0 flex-1">
        <TerminalSection terminalId={active} />
      </div>

      {/* ---- 标签右键菜单（关闭 / 关闭其他 / 关闭全部；点击空白处关闭） ---- */}
      {menuTab !== null && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuTab(null)} />
          <div
            className="panel-glass menu-anim fixed z-50 w-36 rounded-xl py-1"
            style={{ left: menuPos.x, top: menuPos.y }}
          >
            <button
              className="flex w-full items-center px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              onClick={() => { closeTab(menuTab); setMenuTab(null); }}
            >
              关闭
            </button>
            <button
              className="flex w-full items-center px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              onClick={() => closeOthers(menuTab)}
            >
              关闭其他
            </button>
            <button
              className="flex w-full items-center px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              onClick={closeAllTabs}
            >
              关闭全部
            </button>
          </div>
        </>
      )}
    </div>
  );
}
