/**
 * settings-surface — 官方设置面板打开（body 级 portal 浮窗版）
 *
 * 机制：MirachSidebar 把官方 sidebar.settings 槽经 **createPortal 挂到
 * document.body** 的屏幕外容器（`[data-mirach-settings-portal]`，fixed
 * left:-10000，0×0）——PortalSettingsMount（sidebar-shell）。官方触发按钮
 * 常驻其中，官方面板（SettingsPanel，fixed inset:0 相对视口）作为 portal
 * 子树渲染，DOM 彻底脱离应用裁剪链（软件面板 translateZ(0) 包含块、官方
 * sidebarCol overflow、侧栏滚动容器 maskImage 都管不到它）：天然全窗口、
 * 天然在最上层（body 末尾 + z-1000）、可拖出软件边界。
 *
 * 非模态：官方遮罩隐藏，overlay pointer-events:none、面板单独 auto——面板
 * 外点击直接落在真实应用上；无背景压暗。关闭走官方自身交互（✕ / Esc，
 * aria-expanded 翻回 false）由观察器收层。
 *
 * 可拖动：面板挂 pointer 拖拽（rAF 轮询等挂载），按住非交互区域拖动位置
 * （translate 相对居中位累积），交互元素（按钮/输入/下拉）上不启动；面板
 * 关闭即卸载，监听随元素消亡，重新打开复位居中。
 */

const PORTAL_SEL = "[data-mirach-settings-portal]";
const SURFACE_CLASS = "dsh-settings-surface";
const STYLE_ID = "dsh-settings-surface-style";

const CSS = `
/* 无遮罩：官方 mask 层整体移除（设置窗口背后不压暗） */
.${SURFACE_CLASS} [class*="_overlay"] > [class*="_mask"] {
  display: none !important;
}
/* 非模态：overlay 不接事件（面板外点击穿透到真实应用），面板单独恢复 */
.${SURFACE_CLASS} [class*="_overlay"] {
  pointer-events: none !important;
}
.${SURFACE_CLASS} [role="dialog"] {
  pointer-events: auto !important;
}
/* 拖动中光标与禁选 */
body.mirach-settings-dragging,
body.mirach-settings-dragging * {
  cursor: move !important;
  user-select: none !important;
}
`;

let styleInjected = false;
let closeObserver: MutationObserver | null = null;

function injectStyle(): void {
  if (styleInjected) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

function portalEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(PORTAL_SEL);
}

function triggerIn(root: ParentNode | null): HTMLButtonElement | null {
  if (root === null) return null;
  // 官方触发按钮包裹 settings.trigger 槽（槽内是图标内容）
  return root.querySelector<HTMLButtonElement>('[data-slot="settings.trigger"]')?.closest("button") ?? null;
}

function expanded(trigger: HTMLButtonElement | null): boolean {
  return trigger?.getAttribute("aria-expanded") === "true";
}

/**
 * 面板拖拽：按住面板任意非交互区域（标题带、空白、行间空隙）拖动位置；
 * 按钮/输入/下拉等交互元素上不启动（保持原语义）。translate 相对居中位
 * 累积；面板关闭即卸载，监听随元素消亡，重新打开复位居中。rAF 轮询兜底
 * 官方面板的挂载时机。
 */
function attachPanelDrag(root: ParentNode): void {
  let tries = 0;
  const tryAttach = () => {
    const panel = root.querySelector<HTMLElement>('[role="dialog"]');
    if (panel === null) {
      if (tries++ < 40) requestAnimationFrame(tryAttach);
      return;
    }
    if (panel.dataset.mirachDrag === "1") return;
    panel.dataset.mirachDrag = "1";
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let dragging = false;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('button, input, select, textarea, a, label, [contenteditable="true"], [role="combobox"], [role="slider"]')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      document.body.classList.add("mirach-settings-dragging");
      try { panel.setPointerCapture(e.pointerId); } catch { /* 合成事件无捕获 */ }
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      panel.style.transform = `translate(${baseX + e.clientX - startX}px, ${baseY + e.clientY - startY}px)`;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      baseX += e.clientX - startX;
      baseY += e.clientY - startY;
      document.body.classList.remove("mirach-settings-dragging");
      try { panel.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerup", onPointerUp);
    panel.addEventListener("pointercancel", onPointerUp);
  };
  tryAttach();
}

/**
 * 打开：点击 portal 里的官方触发按钮 → 官方面板（fixed inset:0，相对视口、
 * 无遮罩、非模态、可拖动）直接显示在一切之上。
 */
export function openOfficialSettings(): boolean {
  const container = portalEl();
  const trigger = triggerIn(container);
  if (container === null || trigger === null) {
    // fail-loud：portal/设置槽未就绪（内核尚未挂载），不静默假成功
    console.warn("[settings-surface] 设置触发按钮未就绪，稍后重试");
    return false;
  }
  injectStyle();
  container.classList.add(SURFACE_CLASS);
  if (!expanded(trigger)) trigger.click();
  attachPanelDrag(container);
  attachCloseWiring(trigger);
  return true;
}

/** 关闭：面板若开着先点触发关上，然后移除浮层标记。 */
export function closeOfficialSettings(): void {
  const container = portalEl();
  if (container === null) return;
  const trigger = triggerIn(container);
  if (trigger !== null && expanded(trigger)) trigger.click();
  container.classList.remove(SURFACE_CLASS);
  detachCloseWiring();
}

/** 官方面板关闭（aria-expanded 翻回 false，含面板自带关闭钮/Esc）→ 自动收层 */
function attachCloseWiring(trigger: HTMLButtonElement): void {
  closeObserver?.disconnect();
  closeObserver = new MutationObserver(() => {
    if (!expanded(trigger)) closeOfficialSettings();
  });
  closeObserver.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
}

function detachCloseWiring(): void {
  closeObserver?.disconnect();
  closeObserver = null;
}

export function isSurfaced(): boolean {
  return portalEl()?.classList.contains(SURFACE_CLASS) ?? false;
}
