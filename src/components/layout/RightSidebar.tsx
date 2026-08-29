/**
 * RightSidebar — 右侧栏 (380px × 880px)
 *
 * ┌──────────────────────────────┐
 * │ 多标签页                     │  ← 顶栏标题（与左侧栏同款，位于透明顶栏下方，点击收起）
 * │ 可以打开多个页面同时工作      │
 * ├──────────────────────────────┤
 * │ [▾] [标签1 ×] [标签2 ×]       │  ← 标签栏（▾ 弹窗：搜索/打开/最近关闭）
 * ├──────────────────────────────┤
 * │        面板内容区             │  ← 无标签时显示入口列表
 * └──────────────────────────────┘
 *
 * 面板：辅助对话（临时会话）· 与其他项目对话（项目选择）
 *      · 审查（Git 改动）· 终端 · 浏览器
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HeaderRule } from "@/components/layout/HeaderRule";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { TerminalSection } from "@/components/chat/Terminal";
import { PreviewPanel } from "@/components/layout/PreviewPanel";
import { ConsolePanel } from "@/components/layout/ConsolePanel";
import { allocateTerminalId, releaseTerminalId } from "@/lib/terminalIds";
import { useAppConfig } from "@/hooks/useAppConfig";
import { GitReviewPanel } from "@/components/files/GitReviewPanel";
import { ArrowClockwise, ArrowLeft, ArrowRight, ArrowsOutSimple, CaretDown, ChatText, CursorClick, DotsThreeVertical, FolderSimple, Globe, MagnifyingGlass, Plus, PushPin, X } from "@phosphor-icons/react";
import { MarkdownText } from "@/components/chat/markdown/MarkdownText";
import { Composer } from "@/components/chat/Composer";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PANELS, PANEL_ICON, type TabItem } from "@/components/layout/rightTabs";
import {
  OVERLAY_PAD,
  POPUP_SIZES,
  type OverlayActionPayload,
  type OverlayPopupType,
  type OverlayShowPayload,
} from "@/components/overlay/events";

// ===== 面板定义（PANELS / PANEL_ICON / TabItem 在 rightTabs.ts，主应用与覆盖层共用） =====

// ===== 项目选择页数据（六个项目） =====

const PROJECT_GROUPS = ["mirach", "聊天", "代码", "办公", "金融", "写作"];

const PROJECT_SESSIONS: Record<string, { title: string; time: string }[]> = {
  mirach: [
    { title: "主项目会话", time: "09:12" },
    { title: "架构讨论", time: "昨天" },
    { title: "依赖升级", time: "周一" },
  ],
  聊天: [
    { title: "多模型协作方案", time: "10:05" },
    { title: "语音交互优化", time: "周二" },
  ],
  代码: [
    { title: "Rust 后端重构", time: "昨天" },
    { title: "前端组件库", time: "周三" },
  ],
  办公: [{ title: "周报自动化", time: "08:30" }],
  金融: [{ title: "行情数据面板", time: "周四" }],
  写作: [{ title: "文案生成器", time: "周五" }],
};

const PINNED_SESSIONS = [
  { title: "主项目会话", time: "09:12" },
  { title: "架构讨论", time: "昨天" },
];

// ===== 辅助对话（临时会话：无历史、不修改文件、不保存；气泡/输入框样式对齐主页面） =====

interface TempMsg {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
}

function AssistantPanel() {
  const [msgs, setMsgs] = useState<TempMsg[]>([]);
  const [seq, setSeq] = useState(0);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    setMsgs((m) => [...m, { id: seq, role: "user", text: trimmed, time }]);
    setSeq((s) => s + 1);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 消息区：限宽居中（与主对话区一致，参考 zosma 820px）——面板拖宽时内容不再撑满；
          气泡结构对齐主页面 MessageList：头像 + 名字 + 气泡 + MarkdownText */}
      <div className="mx-auto w-full max-w-[820px] flex-1 space-y-4 overflow-y-auto px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {msgs.length === 0 ? (
          <p className="pt-6 text-center text-body-sm text-muted-foreground">
            输入消息开始临时对话
          </p>
        ) : (
          msgs.map((m) =>
            m.role === "user" ? (
              /* 用户消息：右侧名字 + 气泡 + ME 头像（对齐主页面） */
              <div key={m.id} className="flex justify-end gap-3">
                <div className="max-w-[70%] min-w-0">
                  <div className="mb-2 flex items-center justify-end">
                    <span className="text-member font-medium text-[#303030]">用户01</span>
                  </div>
                  <div className="break-words rounded-lg rounded-tr-none border border-black/10 bg-[#D2DAEC] px-4 py-3">
                    <div className="text-body-sm leading-relaxed text-[#303030]">
                      <MarkdownText content={m.text} />
                    </div>
                  </div>
                </div>
                <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#303030] text-white text-sm font-bold">
                    ME
                  </div>
                  <span
                    className="absolute block rounded-full border-2 border-white"
                    style={{ width: 11, height: 11, bottom: -1, right: -1, backgroundColor: "#10B981" }}
                  />
                </div>
              </div>
            ) : (
              /* AI 消息：左侧 AI 头像 + 名字/时间 + 气泡（对齐主页面） */
              <div key={m.id} className="flex gap-3">
                <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#6366F1] text-white text-sm font-bold">
                    AI
                  </div>
                  <span
                    className="absolute block rounded-full border-2 border-white"
                    style={{ width: 11, height: 11, bottom: -1, right: -1, backgroundColor: "#10B981" }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-member font-medium text-[#303030]">Mirach Harness</span>
                    <span className="text-body-sm text-muted-foreground">{m.time}</span>
                  </div>
                  <div className="break-words rounded-lg rounded-tl-none border border-black/10 bg-white px-4 py-3">
                    <div className="text-body-sm leading-relaxed text-[#303030]">
                      <MarkdownText content={m.text} />
                    </div>
                  </div>
                </div>
              </div>
            ),
          )
        )}
      </div>
      {/* 输入框：直接复用主页面 Composer（standalone：发送走 onSend，不写主对话 store） */}
      <Composer standalone onSend={send} />
    </div>
  );
}

// ===== 与其他项目对话（项目选择页） =====

function ProjectsPanel() {
  const [search, setSearch] = useState("");

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-3">
        <h3 className="text-member font-medium text-[#303030]">选择要工作的会话</h3>
        {/* 搜索框 */}
        <div className="relative mt-2.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索会话..."
            className="w-full rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
          />
          <MagnifyingGlass className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 已置顶会话 */}
        <Collapsible defaultOpen className="mb-3">
          <CollapsibleTrigger className="flex w-full items-center gap-2 py-0.5 cursor-pointer group/pin">
            <PushPin className="h-3.5 w-3.5 text-muted-foreground" weight="fill" />
            <span className="flex-1 text-left text-member">已置顶会话</span>
            <CaretDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]/pin:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 space-y-0.5">
              {PINNED_SESSIONS.map((s) => (
                <div
                  key={s.title}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted"
                >
                  <PushPin className="h-3 w-3 shrink-0 text-[#F59E0B]" weight="fill" />
                  <span className="flex-1 truncate text-body-sm text-[#303030]">{s.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{s.time}</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 六个项目树形文件夹 */}
        <div className="mb-3">
          <p className="mb-1 flex items-center gap-2 text-member text-muted-foreground">
            <FolderSimple className="h-3.5 w-3.5" weight="fill" />
            项目
          </p>
          <div className="space-y-0.5">
            {PROJECT_GROUPS.map((name) => (
              <Collapsible key={name}>
                <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted group/proj">
                  <CaretDown className="h-3.5 w-3.5 text-muted-foreground -rotate-90 transition-transform duration-200 group-data-[state=open]/proj:rotate-0" />
                  <FolderSimple className="h-4 w-4 text-muted-foreground" weight="fill" />
                  <span className="flex-1 text-left text-body-sm text-[#303030]">{name}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-6 space-y-0.5 pl-3">
                    {(PROJECT_SESSIONS[name] ?? []).map((s) => (
                      <div
                        key={s.title}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-muted"
                      >
                        <span className="flex-1 truncate text-body-sm text-[#303030]">{s.title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{s.time}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>

        {/* 所有会话和成员（六项标签，默认收起） */}
        <p className="mb-1 text-member text-muted-foreground">所有会话和成员</p>
        <div className="space-y-0.5">
          {PROJECT_GROUPS.map((name) => (
            <Collapsible key={name}>
              <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted group/all">
                <CaretDown className="h-3.5 w-3.5 text-muted-foreground -rotate-90 transition-transform duration-200 group-data-[state=open]/all:rotate-0" />
                <ChatText className="h-4 w-4 text-muted-foreground" weight="fill" />
                <span className="flex-1 text-left text-body-sm text-[#303030]">{name}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-6 space-y-0.5 pl-3">
                  {(PROJECT_SESSIONS[name] ?? []).map((s) => (
                    <div
                      key={s.title}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-muted"
                    >
                      <span className="flex-1 truncate text-body-sm text-[#303030]">{s.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{s.time}</span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </div>
    </div>
  );
}


// ===== 浏览器（内嵌 child webview：地址栏 + 导航 + 自由尺寸菜单 + 元素选择 + 更多操作） =====

const BROWSER_TOOLBAR_H = 40;
// 打开面板时加载的默认页（输入框初始为空，导航后回填真实地址）
// 浏览器默认首页（优先取 Rust 配置 browserHome，此处为回退值）
const BROWSER_HOME_FALLBACK = "https://www.bing.com";
// 尺寸控制条高度（自由尺寸展开时显示）
const BROWSER_SIZE_BAR_H = 34;
// 画布与可用区边缘的留白（画布缩放居中显示）
const BROWSER_CANVAS_PAD = 12;
// 分辨率输入范围
const RESOLUTION_W_MIN = 320;
const RESOLUTION_W_MAX = 3840;
const RESOLUTION_H_MIN = 320;
const RESOLUTION_H_MAX = 2160;

function BrowserPanel({ visible = true }: { visible?: boolean }) {
  const { config } = useAppConfig();
  const browserHome = config.browserHome || BROWSER_HOME_FALLBACK;
  const containerRef = useRef<HTMLDivElement>(null);
  // 内容区 ref（画布框 DOM 定位换算基准）
  const contentRef = useRef<HTMLDivElement>(null);
  // 地址栏输入（初始为空，导航事件回填）
  const [input, setInput] = useState("");
  const [currentUrl, setCurrentUrl] = useState(browserHome);
  const [loading, setLoading] = useState(false);
  // 非 Tauri 环境（invoke 失败）时显示占位
  const [supported, setSupported] = useState(true);
  // 自由尺寸：控制条显示/隐藏 + 分辨率输入
  const [sizeBarOpen, setSizeBarOpen] = useState(false);
  // 适应窗口百分比（100 = 适应窗口；50~200 缩放页面渲染）
  const [percent, setPercent] = useState(100);
  // 百分比最新值 ref（syncCanvas 闭包里读，避免过期）
  const percentRef = useRef(100);
  // 适应窗口菜单是否打开（菜单本体渲染在覆盖层 webview 里，这里只维护按钮高亮）
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  // 覆盖层页面就绪（overlay:ready）时重发 zoom 内容的闭包（防首次加载竞态）
  const reshowZoomRef = useRef<(() => void) | null>(null);
  // 分辨率（虚拟视口；输入范围 320-3840 × 320-2160）
  const [resolution, setResolution] = useState({ w: 380, h: 713 });
  // 分辨率最新值 ref（同步/缩放回调里读，避免闭包过期）
  const resolutionRef = useRef({ w: 380, h: 713 });
  // 本地编辑中的输入值（Enter 应用前不提交）
  const [editW, setEditW] = useState("380");
  const [editH, setEditH] = useState("713");
  // 画布显示尺寸 + 缩放（scale = 显示宽 ÷ 分辨率宽，≤1）
  const [canvas, setCanvas] = useState<{ x: number; y: number; w: number; h: number; scale: number } | null>(null);
  // 画布框在内容区内的 DOM 偏移（由 canvas 视口坐标换算，渲染边框用）
  const [frame, setFrame] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  // 当前实际应用的 zoom（跨导航重注入用）
  const zoomRef = useRef(1);
  // 更多操作菜单（fixed 定位向上弹出）
  const [moreMenuPos, setMoreMenuPos] = useState<{ right: number; bottom: number } | null>(null);
  // 元素选择模式
  const [picking, setPicking] = useState(false);
  const pickTimer = useRef<number | null>(null);

  // 打开更多操作菜单：记录按钮位置（fixed 坐标）
  const openMoreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMoreMenuPos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top });
  };

  // 面板内容区坐标（含工具栏；webview 起点随控制条偏移）
  // barOpen 参数显式传入，避免 setState 回调里读到旧值
  const measure = (barOpen = sizeBarOpen) => {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const barH = barOpen ? BROWSER_SIZE_BAR_H : 0;
    return {
      x: r.left,
      y: r.top + BROWSER_TOOLBAR_H + barH,
      w: r.width,
      h: Math.max(0, r.height - BROWSER_TOOLBAR_H - barH),
    };
  };

  // 画布布局：分辨率（虚拟视口）→ 居中等比缩放显示
  // scale = min(1, 可用宽/分辨率宽, 可用高/分辨率高)：放不下则缩小适应，比可用区小则 1:1 居中（不放大避免模糊）
  const computeCanvas = (rw: number, rh: number) => {
    const avail = measure();
    if (!avail) return null;
    const aw = Math.max(0, avail.w - BROWSER_CANVAS_PAD * 2);
    const ah = Math.max(0, avail.h - BROWSER_CANVAS_PAD * 2);
    if (aw <= 0 || ah <= 0 || rw <= 0 || rh <= 0) return null;
    const scale = Math.min(1, aw / rw, ah / rh);
    const dw = Math.max(1, Math.round(rw * scale));
    const dh = Math.max(1, Math.round(rh * scale));
    return {
      x: avail.x + Math.round((avail.w - dw) / 2),
      y: avail.y + Math.round((avail.h - dh) / 2),
      w: dw,
      h: dh,
      scale,
    };
  };

  // 按分辨率重算画布并同步 webview（bounds + zoom）；zoom 仅在变化时下发
  const syncCanvas = (rw?: number, rh?: number) => {
    const w = rw ?? resolutionRef.current.w;
    const h = rh ?? resolutionRef.current.h;
    const c = computeCanvas(w, h);
    if (!c) return;
    setCanvas(c);
    void invoke("browser_set_bounds", { x: c.x, y: c.y, w: c.w, h: c.h }).catch(() => {});
    // zoom = 适应缩放 × 百分比：100% 页面填满画布；>100% 页面放大（页内滚动条），<100% 缩小
    const zoom = c.scale * (percentRef.current / 100);
    if (Math.abs(zoom - zoomRef.current) > 0.0001) {
      zoomRef.current = zoom;
      void invoke("browser_set_zoom", { scale: zoom }).catch(() => {});
    }
  };

  // 应用分辨率（clamp 到输入范围）
  const applyResolution = (rw: number, rh: number) => {
    const w = Math.min(RESOLUTION_W_MAX, Math.max(RESOLUTION_W_MIN, Math.round(rw)));
    const h = Math.min(RESOLUTION_H_MAX, Math.max(RESOLUTION_H_MIN, Math.round(rh)));
    resolutionRef.current = { w, h };
    setResolution({ w, h });
    setEditW(String(w));
    setEditH(String(h));
    syncCanvas(w, h);
  };

  // 重置分辨率 = 可用区实际大小（1:1 铺满画布）
  const resetResolution = () => {
    const avail = measure();
    if (!avail) return;
    applyResolution(Math.round(avail.w), Math.round(avail.h));
  };

  // 应用适应百分比（100 = 适应窗口；其余按比例缩放页面渲染）
  const applyPercent = (p: number) => {
    setPercent(p);
    percentRef.current = p;
    syncCanvas();
  };

  // 打开适应百分比菜单：菜单本体渲染在覆盖层 webview 里（真正盖住浏览器），主应用只负责定位
  const showZoomOverlay = (r: DOMRect) => {
    const { w, h } = POPUP_SIZES.zoom;
    const x = r.right - w - OVERLAY_PAD;
    const y = r.bottom + 4 - OVERLAY_PAD;
    setZoomMenuOpen(true);
    void invoke("overlay_show", {
      x,
      y,
      w: w + OVERLAY_PAD * 2,
      h: h + OVERLAY_PAD * 2,
    }).catch(() => {});
    void emit("overlay:show", { type: "zoom", zoom: { percent: percentRef.current } });
    // 记录重发闭包：覆盖层页面就绪（overlay:ready）时若菜单仍开着则重发内容
    reshowZoomRef.current = () => showZoomOverlay(r);
  };

  const openZoomMenu = (e: React.MouseEvent) => {
    showZoomOverlay((e.currentTarget as HTMLElement).getBoundingClientRect());
  };

  // 关闭适应窗口菜单（覆盖层 webview 隐藏 + 主应用状态复位）
  const closeZoomOverlay = () => {
    setZoomMenuOpen(false);
    reshowZoomRef.current = null;
    void invoke("overlay_hide").catch(() => {});
    void emit("overlay:hide");
  };

  // 监听覆盖层：zoom 动作回传 + 关闭请求（Esc / 失焦 / 点卡片外）
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    void listen<OverlayActionPayload>("overlay:action", (e) => {
      const { type, action, percent: p } = e.payload;
      if (type === "zoom" && action === "set" && typeof p === "number") {
        applyPercent(p);
      }
      closeZoomOverlay();
    }).then((u) => unsubs.push(u));
    void listen("overlay:close", () => closeZoomOverlay()).then((u) => unsubs.push(u));
    // 覆盖层页面就绪（overlay:ready）：若菜单仍开着则重发 zoom 内容
    void listen("overlay:ready", () => reshowZoomRef.current?.()).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画布框 DOM 位置：canvas 是视口坐标，换算为相对内容区的偏移（外扩 1px 露出边框）
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || !canvas) {
      setFrame(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setFrame({
      left: Math.round(canvas.x - r.left) - 1,
      top: Math.round(canvas.y - r.top) - 1,
      w: canvas.w + 2,
      h: canvas.h + 2,
    });
  }, [canvas]);

  // 挂载时打开：优先显示已有 webview（保留状态），否则创建；初始化分辨率 = 容器实测
  useEffect(() => {
    const b = measure();
    if (!b) return;
    const rw = Math.round(b.w);
    const rh = Math.round(b.h);
    resolutionRef.current = { w: rw, h: rh };
    setResolution({ w: rw, h: rh });
    setEditW(String(rw));
    setEditH(String(rh));
    const c = computeCanvas(rw, rh);
    if (!c) return;
    zoomRef.current = c.scale * (percentRef.current / 100);
    void (async () => {
      try {
        await invoke("browser_show", { x: c.x, y: c.y, w: c.w, h: c.h });
      } catch {
        try {
          await invoke("browser_open", { url: browserHome, x: c.x, y: c.y, w: c.w, h: c.h });
          setSupported(true);
          return;
        } catch {
          setSupported(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 侧栏从收起恢复 → 重建浏览器 webview + 覆盖层（收起时 browser_close 会销毁两者）
  // 跳过首次渲染（首次由上面的挂载 effect 处理）
  const visibleFirst = useRef(true);
  useEffect(() => {
    if (visibleFirst.current) {
      visibleFirst.current = false;
      return;
    }
    if (!visible) return;
    const c = computeCanvas(resolutionRef.current.w, resolutionRef.current.h);
    if (!c) return;
    void (async () => {
      try {
        await invoke("browser_show", { x: c.x, y: c.y, w: c.w, h: c.h });
      } catch {
        try {
          await invoke("browser_open", { url: currentUrl, x: c.x, y: c.y, w: c.w, h: c.h });
          setSupported(true);
        } catch {
          setSupported(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 跨导航保持缩放：页面加载完成后重注入当前 zoom
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    void listen<string>("browser-load", () => {
      const zoom = zoomRef.current;
      if (zoom !== 1) {
        void invoke("browser_set_zoom", { scale: zoom }).catch(() => {});
      }
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, []);

  // 尺寸控制条开合 → 可用区高度变化 → 重算画布
  useEffect(() => {
    if (!supported) return;
    syncCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeBarOpen, supported]);

  // 窗口缩放/滚动/容器尺寸变化 → 重算画布同步 child webview（贴合画布区）
  useEffect(() => {
    if (!supported) return;
    const el = containerRef.current;
    const sync = () => syncCanvas();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    // ResizeObserver：容器尺寸变化（如未来右侧栏调宽）时同步 webview
    const ro = new ResizeObserver(sync);
    if (el) ro.observe(el);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // 导航事件回填地址栏
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    void listen<string>("browser-nav", (e) => {
      setInput(e.payload);
      setCurrentUrl(e.payload);
      setLoading(true);
    }).then((u) => unsubs.push(u));
    void listen<string>("browser-load", (e) => {
      setInput(e.payload);
      setCurrentUrl(e.payload);
      setLoading(false);
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, []);

  // 元素选择轮询：点击元素后（脚本写入 __hermesPicked）取回结果 → 直接发到 Composer 输入框
  useEffect(() => {
    if (!picking) return;
    const poll = async () => {
      try {
        const res = await invoke<string | null>("browser_pick_result");
        if (res) {
          window.dispatchEvent(
            new CustomEvent("mirach:composer-attach", {
              detail: { label: "网页元素", detail: currentUrl, content: res },
            }),
          );
          setPicking(false);
          return;
        }
        pickTimer.current = window.setTimeout(() => void poll(), 400);
      } catch {
        setPicking(false);
      }
    };
    void poll();
    return () => {
      if (pickTimer.current) window.clearTimeout(pickTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  const normalize = (raw: string) => {
    let target = raw.trim();
    if (!target) return null;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    return target;
  };

  const navigate = async (raw: string) => {
    const target = normalize(raw);
    if (!target) return;
    setInput(target);
    setLoading(true);
    try {
      await invoke("browser_navigate", { url: target });
    } catch {
      setSupported(false);
    }
  };

  const go = (fn: () => Promise<unknown>) => {
    void fn().catch(() => setSupported(false));
  };

  // 自由尺寸：展开/收起尺寸控制条（可用区高度随之变化，画布由 effect 重算）
  const toggleSizeBar = () => {
    setSizeBarOpen((v) => !v);
  };

  // ---- 元素选择 ----
  const togglePick = () => {
    if (picking) {
      setPicking(false);
      return;
    }
    setPicking(true);
    void invoke("browser_pick_start").catch(() => setPicking(false));
  };

  // ---- 更多操作 ----
  const openInDefaultBrowser = async () => {
    setMoreMenuPos(null);
    try {
      await openUrl(currentUrl);
    } catch {
      /* 非 Tauri 环境忽略 */
    }
  };
  const openDevtools = () => {
    setMoreMenuPos(null);
    go(() => invoke("browser_devtools"));
  };

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {/* 地址栏 */}
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5"
        style={{ height: BROWSER_TOOLBAR_H }}
      >
        <button
          onClick={() => go(() => invoke("browser_back"))}
          title="后退"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" weight="bold" />
        </button>
        <button
          onClick={() => go(() => invoke("browser_forward"))}
          title="前进"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
        >
          <ArrowRight className="h-4 w-4" weight="bold" />
        </button>
        <button
          onClick={() => go(() => invoke("browser_reload"))}
          title="刷新"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
        >
          <ArrowClockwise className={cn("h-4 w-4", loading && "animate-spin")} weight="bold" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void navigate(input)}
          placeholder="输入网址…"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-white px-2.5 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
        />
        {/* 自由尺寸（展开尺寸控制条） */}
        <div className="relative shrink-0">
          <button
            onClick={toggleSizeBar}
            title="自由尺寸"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              sizeBarOpen ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted",
            )}
          >
            <ArrowsOutSimple className="h-4 w-4" weight="bold" />
          </button>
        </div>
        {/* 选择网页元素加入聊天（选中后直接发送到输入框） */}
        <button
          onClick={togglePick}
          title="选择网页元素加入聊天"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
            picking ? "bg-[#6366F1] text-white" : "text-[#464646] hover:bg-muted",
          )}
        >
          <CursorClick className="h-4 w-4" weight="bold" />
        </button>
        {/* 更多浏览器操作（fixed 向上弹出） */}
        <div className="relative shrink-0">
          <button
            onClick={openMoreMenu}
            title="更多浏览器操作"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              moreMenuPos ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted",
            )}
          >
            <DotsThreeVertical className="h-4 w-4" weight="bold" />
          </button>
          {moreMenuPos && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreMenuPos(null)} />
              <div
                className="panel-glass menu-anim fixed z-50 w-44 rounded-xl py-1"
                style={{ right: moreMenuPos.right, bottom: moreMenuPos.bottom + 4 }}
              >
                <button
                  onClick={() => void openInDefaultBrowser()}
                  className="block w-full px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
                >
                  在默认浏览器中打开
                </button>
                <button
                  onClick={openDevtools}
                  className="block w-full px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
                >
                  打开调试工具
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 尺寸控制条（自由尺寸展开：中间 宽×高 输入，右侧 适应比例 + 重置） */}
      {sizeBarOpen && (
        <div
          className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-white px-2"
          style={{ height: BROWSER_SIZE_BAR_H }}
        >
          <span className="text-[11px] text-muted-foreground">宽</span>
          <input
            type="number"
            value={editW}
            onChange={(e) => setEditW(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = Number(editW);
                if (!Number.isNaN(v)) applyResolution(v, resolution.h);
              }
            }}
            onBlur={() => {
              const v = Number(editW);
              if (!Number.isNaN(v)) applyResolution(v, resolution.h);
            }}
            min={RESOLUTION_W_MIN}
            max={RESOLUTION_W_MAX}
            className="h-6 w-16 rounded-md border border-border bg-white px-1.5 text-center text-[11px] text-[#303030] focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
          />
          <span className="text-[11px] text-muted-foreground">×</span>
          <input
            type="number"
            value={editH}
            onChange={(e) => setEditH(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = Number(editH);
                if (!Number.isNaN(v)) applyResolution(resolution.w, v);
              }
            }}
            onBlur={() => {
              const v = Number(editH);
              if (!Number.isNaN(v)) applyResolution(resolution.w, v);
            }}
            min={RESOLUTION_H_MIN}
            max={RESOLUTION_H_MAX}
            className="h-6 w-16 rounded-md border border-border bg-white px-1.5 text-center text-[11px] text-[#303030] focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
          />
          <span className="text-[11px] text-muted-foreground">高</span>
          {/* 适应窗口（菜单渲染在覆盖层 webview 里，真正盖住浏览器；点击主应用区域 → 关闭） */}
          <div className="relative ml-1">
            <button
              onClick={openZoomMenu}
              title="适应窗口"
              className={cn(
                "flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors",
                zoomMenuOpen ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted",
              )}
            >
              适应窗口
              <CaretDown className="h-3 w-3" weight="bold" />
            </button>
            {zoomMenuOpen && (
              <div className="fixed inset-0 z-40" onClick={() => closeZoomOverlay()} />
            )}
          </div>
          <button
            onClick={resetResolution}
            title="重置为面板实际大小"
            className="flex h-6 items-center rounded-md px-1.5 text-[11px] text-[#464646] transition-colors hover:bg-muted"
          >
            重置
          </button>
        </div>
      )}

      {/* 内容：画布区（child webview 覆盖画布区域，等比缩放居中显示） */}
      <div ref={contentRef} className="relative min-h-0 flex-1 overflow-hidden">
        {/* 画布底板（干净浅灰设计台面） */}
        <div className="absolute inset-0" style={{ backgroundColor: "#F1F2F5" }} />
        {supported ? (
          <>
            {/* 画布框（边框略大于 webview，圆角 + 阴影） */}
            {frame && (
              <div
                className="pointer-events-none absolute rounded-lg border border-black/10 bg-white shadow-[0_6px_24px_rgba(0,0,0,0.10)]"
                style={{ left: frame.left, top: frame.top, width: frame.w, height: frame.h }}
              />
            )}
            {/* 分辨率标签（画布下方） */}
            {canvas && (
              <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center">
              <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                {resolution.w} × {resolution.h} · {percent}%
              </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Globe className="h-8 w-8 text-muted-foreground" weight="fill" />
            <p className="text-body-sm leading-relaxed text-[#303030]">
              内嵌浏览器仅在桌面应用中可用
              <br />
              （请运行 npm run tauri dev）
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 标签页 =====

const MAX_RECENT = 9;

// ===== 右侧栏主体 =====

interface RightSidebarProps {
  className?: string;
  style?: React.CSSProperties;
  /** 外部请求打开的面板（工具栏按钮/命令面板；seq 递增，每次点击都重新打开标签） */
  openReq?: { id: string; seq: number } | null;
  /** 真实激活标签上报（AppLayout 用做 toggle 判断 / 工具栏高亮） */
  onActiveTabChange?: (id: string | null) => void;
  /** 右侧栏是否可见（隐藏时关闭浏览器 webview，避免残留盖住页面） */
  showRight?: boolean;
  /** 顶栏标题的收起按钮回调（隐藏右侧栏） */
  onCollapse?: () => void;
}

export function RightSidebar({
  className,
  style,
  openReq,
  onActiveTabChange,
  showRight = true,
  onCollapse,
}: RightSidebarProps) {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // 终端面板的 pty 实例 id（全局唯一，避免与主终端/成员终端互相打断）。
  // 惰性分配：仅在终端面板激活时占号、失活即释放——若在挂载时就固定占一个号，
  // 会把主终端/成员终端的编号顶高（第一个就变成 02 而非 01）
  const [terminalId, setTerminalId] = useState<string | null>(null);
  // 激活标签的面板类型：activeTab 是实例 id（形如 "terminal-3"），面板类型才是 "terminal"
  const activePanelId = tabs.find((t) => t.id === activeTab)?.panelId ?? null;
  useEffect(() => {
    if (activePanelId !== "terminal") {
      if (terminalId !== null) {
        releaseTerminalId(terminalId);
        setTerminalId(null);
      }
      return;
    }
    if (terminalId === null) setTerminalId(allocateTerminalId());
  }, [activePanelId, terminalId]);
  // 组件卸载时兜底释放（正常路径失活已释放，这里只防未失活直接卸载）
  const termIdRef = useRef<string | null>(null);
  termIdRef.current = terminalId;
  useEffect(() => () => {
    if (termIdRef.current !== null) releaseTerminalId(termIdRef.current);
  }, []);
  const [recentClosed, setRecentClosed] = useState<TabItem[]>([]);
  const [popupOpen, setPopupOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // 最近一次弹窗打开闭包（覆盖层页面就绪 overlay:ready 时重发内容，防首次弹窗竞态）
  const reshowRef = useRef<(() => void) | null>(null);
  // 标签实例 id 计数器 + tabs 最新引用（事件/effect 里读最新，避免闭包过期）
  const tabSeq = useRef(0);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // 可多开的面板（+号快速打开时总是新开实例）；其余面板共享资源（浏览器 webview 等）走去重
  const MULTI_OPEN = ["assistant", "projects"];

  // 外部（工具栏/命令面板）请求打开面板 → 去重激活（已有该面板标签则激活，否则新开）
  useEffect(() => {
    if (!openReq) return;
    openTab(openReq.id, "dedupe");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReq]);

  // 真实激活标签上报（AppLayout 用做 toggle 判断 / 工具栏高亮）
  useEffect(() => {
    onActiveTabChange?.(activeTab);
  }, [activeTab, onActiveTabChange]);

  /** 打开面板标签。mode:
   *  - "dedupe"：已有同面板标签则激活它（工具栏/默认界面入口）
   *  - "new"：总是新开一个实例（+号快速打开，多开同面板） */
  const openTab = (panelId: string, mode: "dedupe" | "new" = "dedupe") => {
    const panel = PANELS.find((p) => p.id === panelId);
    if (!panel) return;
    if (mode === "dedupe") {
      const existing = tabsRef.current.find((t) => t.panelId === panelId);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }
    }
    tabSeq.current += 1;
    // 可多开面板的实例带序号：辅助对话1 / 辅助对话2 …（按当前实例数排序）
    const n = tabsRef.current.filter((t) => t.panelId === panelId).length + 1;
    const label = MULTI_OPEN.includes(panelId) ? `${panel.label}${n}` : panel.label;
    const item: TabItem = { id: `${panelId}-${tabSeq.current}`, panelId, label };
    setTabs((t) => [...t, item]);
    setActiveTab(item.id);
  };

  const closeTab = (id: string) => {
    // 关闭浏览器标签 → 销毁 child webview
    const closing = tabsRef.current.find((x) => x.id === id);
    if (closing?.panelId === "browser") {
      void invoke("browser_close").catch(() => {});
    }
    setTabs((t) => {
      const item = t.find((x) => x.id === id);
      if (item) {
        setRecentClosed((r) => [item, ...r.filter((x) => x.id !== id)].slice(0, MAX_RECENT));
      }
      return t.filter((x) => x.id !== id);
    });
    setActiveTab((a) => {
      if (a !== id) return a;
      const remaining = tabsRef.current.filter((x) => x.id !== id);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  };

  // 浏览器标签存在但非激活 → 隐藏 child webview（保留页面状态）
  // 同时隐藏覆盖层：切标签前的点击已被遮罩关闭弹窗，此处为防御性保证——浏览器隐藏时覆盖层不残留
  useEffect(() => {
    const activeItem = tabs.find((t) => t.id === activeTab);
    const hasBrowser = tabs.some((t) => t.panelId === "browser");
    if (activeItem?.panelId !== "browser" && hasBrowser) {
      void invoke("browser_hide").catch(() => {});
      void invoke("overlay_hide").catch(() => {});
    }
  }, [activeTab, tabs]);

  // 右侧栏隐藏（顶栏收起）→ 关闭 child webview，避免残留盖住页面（组件不卸载，标签状态保留）
  useEffect(() => {
    if (!showRight) {
      void invoke("browser_close").catch(() => {});
      void invoke("overlay_hide").catch(() => {});
    }
  }, [showRight]);

  // ---- 覆盖层弹窗桥接 ----
  // 浏览器区域弹窗（标签下拉 ▾ / 快速打开 +）渲染在透明覆盖层 webview 里，真正盖住浏览器。
  // 打开：overlay_show 定位到弹窗矩形 + emit("overlay:show") 传内容；
  // 关闭：overlay_hide 隐藏 + emit("overlay:hide") 让覆盖层清空。
  const openOverlayPopup = (
    type: OverlayPopupType,
    anchor: DOMRect,
    w: number,
    h: number,
    payload: Omit<OverlayShowPayload, "type">,
    align: "left" | "right" = "left",
  ) => {
    const x = (align === "right" ? anchor.right - w : anchor.left) - OVERLAY_PAD;
    const y = anchor.bottom + 6 - OVERLAY_PAD;
    setPopupOpen(type === "tabs");
    setQuickOpen(type === "quick");
    void invoke("overlay_show", {
      x,
      y,
      w: w + OVERLAY_PAD * 2,
      h: h + OVERLAY_PAD * 2,
    }).catch(() => {});
    void emit("overlay:show", { type, ...payload });
    // 记录重发闭包：覆盖层页面就绪（overlay:ready）时若弹窗仍开着则重发内容
    reshowRef.current = () => openOverlayPopup(type, anchor, w, h, payload, align);
  };

  const closeOverlay = () => {
    setPopupOpen(false);
    setQuickOpen(false);
    reshowRef.current = null;
    void invoke("overlay_hide").catch(() => {});
    void emit("overlay:hide");
  };

  const reopenTab = (id: string) => {
    const item = recentClosed.find((x) => x.id === id);
    setRecentClosed((r) => r.filter((x) => x.id !== id));
    if (!item) return;
    // 恢复为全新实例 id（避免与现有标签 id 冲突），序号按当前实例数重排
    tabSeq.current += 1;
    const n = tabsRef.current.filter((t) => t.panelId === item.panelId).length + 1;
    const label = MULTI_OPEN.includes(item.panelId)
      ? `${item.label.replace(/\d+$/, "")}${n}`
      : item.label;
    const fresh: TabItem = { ...item, id: `${item.panelId}-${tabSeq.current}`, label };
    setTabs((t) => [...t, fresh]);
    setActiveTab(fresh.id);
  };

  // 监听覆盖层：动作回传（tabs/quick）+ 关闭请求（Esc / 失焦 / 点卡片外）
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    void listen<OverlayActionPayload>("overlay:action", (e) => {
      const { type, action, id } = e.payload;
      if (type === "tabs") {
        if (action === "switch" && id) setActiveTab(id);
        if (action === "close" && id) closeTab(id);
        if (action === "reopen" && id) reopenTab(id);
      } else if (type === "quick" && action === "open" && id) {
        // +号快速打开：可多开面板（辅助对话/与其他项目对话）总是新开实例，其余去重
        openTab(id, MULTI_OPEN.includes(id) ? "new" : "dedupe");
      }
      closeOverlay();
    }).then((u) => unsubs.push(u));
    void listen("overlay:close", () => closeOverlay()).then((u) => unsubs.push(u));
    // 覆盖层页面就绪（overlay:ready）：若弹窗仍开着则重发内容（防首次加载竞态）
    void listen("overlay:ready", () => reshowRef.current?.()).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeTab]);

  return (
    <aside
      // 与主页面一致：占满容器高度
      className={cn("relative flex flex-col bg-white", className)}
      style={style}
    >
      {/* 左侧虚线描边：垂直中点与软件（面板 900px）中心 450px 对齐（长度 495px） */}
      <div
        className="pointer-events-none absolute left-0 border-l border-dashed border-border"
        style={{ top: 202.5, bottom: 202.5 }}
      />
      {/* ---- 顶栏标题（与左侧栏/主对话页同款，位于透明顶栏下方；仅点击标题文字收起右侧栏） ---- */}
      <div className="relative flex shrink-0 items-center px-4" style={{ height: 85 }}>
        <HeaderRule />
        <div className="flex min-w-0 flex-col gap-1">
          <button
            onClick={onCollapse}
            title="多标签页（点击收起侧栏）"
            // relative z-20 高于透明 TopBar 的 z-10：Tauri 下 TopBar 是可拖拽区，
            // 不抬高会被它拦截点击（与 MainPanel 展开按钮同款处理）
            className="relative z-20 self-start text-heading font-bold text-[#303030] leading-[1.4] text-left hover:opacity-80 transition-opacity"
          >
            多标签页
          </button>
          <span className="truncate text-body-sm text-muted-foreground leading-none">
            可以打开多个页面同时工作
          </span>
        </div>
      </div>

      {/* ---- 标签栏（无标签时隐藏）：底部描边与顶栏同款（HeaderRule：两端留 15px 空隙） ---- */}
      {tabs.length > 0 && (
        <div className="relative flex shrink-0 min-w-0 items-center gap-1 overflow-x-auto px-2 py-1.5">
          <HeaderRule />
          {/* 下拉弹窗按钮：弹窗内容渲染在透明覆盖层 webview 里（真正盖住浏览器），主应用只负责定位与状态 */}
          <div className="relative">
            <button
              onClick={(e) => {
                setQuickOpen(false);
                if (popupOpen) {
                  closeOverlay();
                  return;
                }
                const { w, h } = POPUP_SIZES.tabs;
                openOverlayPopup("tabs", e.currentTarget.getBoundingClientRect(), w, h, {
                  tabs: { tabs, recent: recentClosed, activeTab },
                });
              }}
              title="标签页"
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md text-[#464646] transition-colors",
                popupOpen ? "bg-muted" : "hover:bg-muted",
              )}
            >
              <CaretDown className="h-4 w-4" weight="bold" />
            </button>

            {/* 点击主应用区域 → 关闭覆盖层弹窗（弹窗本体在覆盖层 webview 中） */}
            {popupOpen && <div className="fixed inset-0 z-30" onClick={() => closeOverlay()} />}
          </div>

        {/* 打开的标签 */}
        {tabs.map((t) => {
          const Icon = PANEL_ICON[t.panelId];
          return (
            <span
              key={t.id}
              className={cn(
                "group flex min-w-0 max-w-[150px] cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-body-sm transition-colors",
                activeTab === t.id
                  ? "bg-muted text-[#303030]"
                  : "text-muted-foreground hover:bg-muted hover:text-[#303030]",
              )}
            >
              {/* 点击标签：切换激活（不关闭页面） */}
              <button
                onClick={() => setActiveTab(t.id)}
                title={`切换到 ${t.label}`}
                className="flex min-w-0 items-center gap-1.5"
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" weight="fill" />}
                <span className="truncate">{t.label}</span>
              </button>
              <button
                onClick={() => closeTab(t.id)}
                title={`关闭 ${t.label}`}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-border hover:text-[#303030]"
              >
                <X className="h-3 w-3" weight="bold" />
              </button>
            </span>
          );
        })}

        {/* 快速打开（+）：弹窗渲染在覆盖层 webview 里 */}
        <div className="relative ml-auto">
          <button
            onClick={(e) => {
              setPopupOpen(false);
              if (quickOpen) {
                closeOverlay();
                return;
              }
              const { w, h } = POPUP_SIZES.quick;
              openOverlayPopup("quick", e.currentTarget.getBoundingClientRect(), w, h, {}, "right");
            }}
            title="快速打开"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md text-[#464646] transition-colors",
              quickOpen ? "bg-muted" : "hover:bg-muted",
            )}
          >
            <Plus className="h-4 w-4" weight="bold" />
          </button>
          {quickOpen && <div className="fixed inset-0 z-40" onClick={() => closeOverlay()} />}
        </div>
      </div>
      )}

      {/* ---- 内容区（按激活标签的面板类型渲染；同面板可多开，各实例独立）：
           底部留 26px（= 子对话栏的 6px 拖拽条 + 20px 留白）：输入框最底部与子对话栏输入框对齐 ---- */}
      <div className="relative min-h-0 flex-1 overflow-hidden pb-[26px]">
        {(() => {
          const activeItem = tabs.find((t) => t.id === activeTab);
          const panelId = activeItem?.panelId ?? null;
          if (panelId === null) {
            return (
              /* 无标签：标题 + 入口列表（内容整体上移 43px） */
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 -mt-[43px]">
                <div className="mb-4 text-center">
                  <h2 className="text-heading font-bold text-[#303030] leading-[1.4]">打开多标签页</h2>
                  <p className="mt-2 text-body-sm leading-snug text-muted-foreground">
                    选择要在侧边面板中打开的标签
                  </p>
                </div>
                {PANELS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openTab(p.id)}
                    className="relative flex w-full max-w-56 items-center justify-center rounded-lg px-3 py-2 text-[#303030] transition-colors hover:bg-muted"
                  >
                    <p.icon
                      className="absolute left-3"
                      weight="fill"
                      size={20}
                      color="#464646"
                    />
                    <span className="text-member">{p.label}</span>
                  </button>
                ))}
              </div>
            );
          }
          if (panelId === "assistant") return <AssistantPanel />;
          if (panelId === "projects") return <ProjectsPanel />;
          if (panelId === "review") return <GitReviewPanel />;
          if (panelId === "terminal")
            return terminalId ? (
              <div className="flex h-full flex-col">
                <div className="shrink-0 border-b border-border px-4 py-2 text-body-sm font-medium text-[#303030]">
                  终端
                </div>
                <div className="min-h-0 flex-1">
                  <TerminalSection terminalId={terminalId} />
                </div>
              </div>
            ) : null;
          if (panelId === "preview") return <PreviewPanel />;
          if (panelId === "console") return <ConsolePanel />;
          if (panelId === "browser") return <BrowserPanel visible={showRight} />;
          return null;
        })()}
      </div>
    </aside>
  );
}
