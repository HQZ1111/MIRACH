/**
 * HUD slot 映射：把**官方对话面**的 DOM 翻译成 hermes 的 HUD 契约。
 *
 * 为什么需要这一层（2026-09-11 查明，见 hud-styles.css 顶部说明）：
 * mirach 的 HUD 外壳（HudShell + 7 个 hook + 741 行 CSS）是从 hermes 逐字搬来的
 * （hook 89–100%、CSS 100% 行级相同），但**里面渲染的对话面不是 hermes 自建的那套**：
 *   - hermes 的 HUD 里是她自己的 composer（`app/chat/composer/*`，slot `composer-dock` /
 *     `composer-surface` / `composer-rich-input`…）和她自己打包的 assistant-ui 线程
 *     （`components/assistant-ui/thread/*`，slot `aui_thread-viewport` / `aui_thread-content`…）；
 *   - mirach 按项目规则用**官方 dsh 原生树**，slot 名是 `conversation.*`。
 * 两边词表交集为空 → 741 行 CSS 里"往对话面里看"的规则全部空转（外壳那层仍然生效）。
 *
 * 这里做两件事：
 *  1. `data-hud-slot="<hermes 名>"`：把官方元素打上 hermes 的名字，CSS/hook 就能照旧用；
 *  2. `data-hud-*` 结构标签：官方把 **thread 与 composer 放在同一个滚动列**里
 *     （`scrollBody` 里先 session 后 composerSeat），而 hermes 的契约是
 *     "bar 钉在窗口底部 + 上方一条可淡出的 band"。不搬 DOM（官方 React 会把它搬回去），
 *     改用样式把那列改成 flex：view 区自己滚、composer 区钉底。
 *
 * 官方内部类名是 CSS-module 哈希（`Lo6CbW_*` / `DmD_pa_*`），版本升级会变 ——
 * 所以一律用 `[class*="_xxx"]` 前缀匹配（mirach 的 index.css 已有同样做法），
 * 匹配不到时只是皮肤失效，不会白屏；并在标签函数里对每个映射显式判空。
 */

function tag(el: Element | null | undefined, name: string, attr = 'data-hud-slot'): void {
  if (!(el instanceof HTMLElement)) return;
  // 一个元素可能同时是好几个 hermes 名（官方结构里"band 的盒子"同时是线程视口，
  // "bar 的最外层"同时是 dock）→ 用**空格分隔的列表**，CSS 侧用 [attr~='name'] 匹配。
  // （早期版本直接 setAttribute 覆盖：后写的名字把先写的吃掉，dock/bounds 就是这么丢的。）
  if (attr === 'data-hud-slot') {
    const cur = (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean);
    if (!cur.includes(name)) {
      cur.push(name);
      el.setAttribute(attr, cur.join(' '));
    }
    return;
  }
  el.setAttribute(attr, name);
}

function untag(root: HTMLElement, attrs: string[]): void {
  for (const a of attrs) {
    root.querySelectorAll<HTMLElement>(`[${a}]`).forEach((el) => el.removeAttribute(a));
  }
}

/** 从 root 往下找第一个满足条件且**有真实盒子**的元素（官方 slot 元素常是 display:contents）。 */
function firstBox(root: Element | null, matches: (el: HTMLElement) => boolean): HTMLElement | null {
  if (root === null) return null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (matches(el)) return el;
  }
  return null;
}

const hasBox = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
};

export function tagHudSlots(root: HTMLElement): void {
  const conv = root.querySelector<HTMLElement>('[data-slot="conversation"]');

  if (conv === null) {
    return;
  }

  untag(root, [
    'data-hud-slot',
    'data-hud-conv-root',
    'data-hud-body',
    'data-hud-scroll-body',
    'data-hud-view-area',
    'data-hud-composer-seat',
  ]);

  // ── 结构：官方那一列（root → body → scrollBody → viewArea / composerSeat）──
  const convRoot = conv.querySelector<HTMLElement>('[class*="_root"]');
  tag(convRoot, 'conv-root', 'data-hud-conv-root');

  const body = conv.querySelector<HTMLElement>('[class*="_body"]');
  tag(body, 'body', 'data-hud-body');

  const seat = conv.querySelector<HTMLElement>('[class*="_composerSeat"]');
  tag(seat, 'seat', 'data-hud-composer-seat');

  // band = 线程区（view 的真实盒子：`_viewArea`，官方把整列塞在一个滚动容器里，
  // 这里给它自己的滚动，bar 由 CSS 钉底）
  const viewSlot = conv.querySelector<HTMLElement>('[data-slot="conversation.view"]');
  const viewArea =
    firstBox(viewSlot, (el) => hasBox(el)) ??
    conv.querySelector<HTMLElement>('[class*="_viewArea"]');
  tag(viewArea, 'view', 'data-hud-view-area');
  // 同一个盒子既是"带子"又是"视口"（hermes 的两个名字在官方结构里合一）
  tag(viewArea, 'composer-bounds');
  tag(viewArea, 'aui_thread-viewport');

  // 官方那个滚动列（thread 与 composer 共用）：CSS 要禁掉它自己的滚动、改成 flex 列。
  // 同时**把它的 scrollTop 归零**：官方把整列滚动到底来贴住最新消息，而 HUD 里
  // band 是这一层的绝对定位子元素 —— 残留的 scrollTop 会把 band 平移出去（实测
  // 带子因此压到 bar 上）。
  const scrollBody =
    conv.querySelector<HTMLElement>('[class*="_scrollBody"]') ?? viewArea?.parentElement?.parentElement ?? null;
  tag(scrollBody, 'scroll-body', 'data-hud-scroll-body');
  if (scrollBody !== null && scrollBody.scrollTop !== 0) scrollBody.scrollTop = 0;

  // ── 线程行容器（hermes 的 aui_thread-content）：装着 chat.node 的那一列 ──
  const node = conv.querySelector<HTMLElement>('[data-slot="conversation.chat.node"]');
  const flowItem = node?.parentElement ?? null;
  const rowsContainer = flowItem?.parentElement ?? null;
  tag(rowsContainer, 'aui_thread-content');

  // ── composer：hermes 的 dock / root / surface / rich-input ──
  const barSlot = conv.querySelector<HTMLElement>('[data-slot="conversation.composer.bar"]');
  const barBox = firstBox(barSlot, (el) => hasBox(el));
  // dock = bar 的**父层**，root = bar 自己。
  // 为什么不能更"聪明"：官方把附属按钮行（`conversation.composer.dock`）放在
  // **bar 内部**，所以"找同时装着 bar 与 extras 的祖先"会一路找到 bar 自己 →
  // dock 与 root 落成同一元素 → hermes 那条"dock 里只留 composer-root，其余全藏"
  // 会把输入卡片一起 `display:none`（实测 .pa_card 0x0、窗口整块空白）。
  // 官方 bar 的父层是 `display: contents` 的 slot，正合 dock 语义（bar 是它的孩子）。
  const dockEl = barBox?.parentElement ?? barBox;
  tag(dockEl, 'composer-dock');
  tag(barBox, 'composer-root');

  // surface = bar 里那块真正画背景的卡片（contenteditable 最近的"有底色"祖先）
  const editable = conv.querySelector<HTMLElement>('[contenteditable="true"]');
  tag(editable, 'composer-rich-input');
  let surface: HTMLElement | null = null;
  for (let el: HTMLElement | null = editable; el !== null && el !== barBox; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') surface = el;
  }
  tag(surface, 'composer-surface');
}

/** 持续维护（官方树会重渲染/换会话重挂）。官方会话在流式输出时高频加节点，
 *  所以判据用"关键标签还在不在"（一次 query，便宜），不是"有没有任何标签"。 */
export function watchHudSlots(root: HTMLElement): () => void {
  tagHudSlots(root);

  let scheduled = false;
  const needsRetag = (): boolean => {
    const editable = root.querySelector<HTMLElement>('[data-hud-slot="composer-rich-input"]');
    const dock = root.querySelector<HTMLElement>('[data-hud-slot="composer-dock"]');
    return editable === null || !editable.isConnected || dock === null || !dock.isConnected;
  };

  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (needsRetag()) tagHudSlots(root);
    });
  });
  // 只观察 childList：tagHudSlots 只写属性，不会自激
  observer.observe(root, { childList: true, subtree: true });

  const timer = window.setInterval(() => {
    if (needsRetag()) tagHudSlots(root);
  }, 3000);

  return () => {
    observer.disconnect();
    window.clearInterval(timer);
  };
}
