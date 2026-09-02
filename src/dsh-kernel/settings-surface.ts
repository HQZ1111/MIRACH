/**
 * settings-surface — 把镜像树里的官方设置面板"浮出"为可见设置页
 *
 * 机制：官方 SettingsRoot 常驻镜像树（同一文档、同一 React 树、真 store/真
 * hooks）。打开设置 = ①镜像容器去掉 inert、提到最上层并加半透明背板；
 * ②程序化点击官方触发按钮（SettingsRoot 内部 open 状态翻真）→ 面板在
 * AppFrame 的 shell-overlay 层渲染为对话框；③关闭（面板自带关闭/Esc/背板
 * 点击）后恢复镜像隐藏与 inert。CSS 由本模块注入一次，选择器用结构锚点
 * （data-slot / data-shell-overlay），不依赖 css-modules 哈希。
 *
 * 所有权语义：设置页 UI 归官方（导航/分区/开关全部官方组件，真数据），
 * mirach 只提供皮肤（容器挂 DSW 令牌）与浮出/背板交互。
 */

const MIRROR_SEL = "[data-kernel-mirror]";
const SURFACE_CLASS = "dsh-settings-surface";
const STYLE_ID = "dsh-settings-surface-style";

const CSS = `
/* 背板：镜像容器本体（浮出时抬高到一切 UI 之上） */
[data-kernel-mirror].${SURFACE_CLASS} {
  opacity: 1 !important;
  z-index: 400 !important;
  pointer-events: auto !important;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
}
/* 官方面板 = sidebar.settings 槽内联的 overlay 对话框（fixed 全屏）。
   隐藏镜像其余部分（帧整体 visibility:hidden），面板单独可见并约束成
   居中对话框（mirach 观感）；visibility 可被后代覆盖，正是这个用法。 */
[data-kernel-mirror].${SURFACE_CLASS} [data-slot="root"] > div {
  visibility: hidden;
}
[data-kernel-mirror].${SURFACE_CLASS} [data-slot="sidebar.settings"] > div {
  visibility: visible;
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(1020px, 94vw);
  height: min(680px, 90vh);
  border-radius: 18px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}
`;

let styleInjected = false;
let escAttached = false;
let closeObserver: MutationObserver | null = null;

function injectStyle(): void {
  if (styleInjected) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

function mirrorEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(MIRROR_SEL);
}

function triggerButton(): HTMLButtonElement | null {
  const mirror = mirrorEl();
  if (!mirror) return null;
  // 官方触发按钮包裹 settings.trigger 槽（槽内是图标内容）
  return mirror.querySelector<HTMLButtonElement>('[data-slot="settings.trigger"]')?.closest("button") ?? null;
}

function expanded(): boolean {
  return triggerButton()?.getAttribute("aria-expanded") === "true";
}

/** 浮出：去 inert、抬层、点官方触发；已浮出则只确保面板展开。 */
export function openOfficialSettings(): boolean {
  const mirror = mirrorEl();
  const trigger = triggerButton();
  if (!mirror || !trigger) return false;
  injectStyle();
  mirror.inert = false;
  mirror.classList.add(SURFACE_CLASS);
  if (!expanded()) trigger.click();
  attachCloseWiring(mirror, trigger);
  return true;
}

/** 收起：面板若开着先点触发关上，然后恢复镜像隐藏 + inert。 */
export function closeOfficialSettings(): void {
  const mirror = mirrorEl();
  if (!mirror) return;
  const trigger = triggerButton();
  if (trigger && expanded()) trigger.click();
  mirror.classList.remove(SURFACE_CLASS);
  mirror.inert = true;
  detachCloseWiring();
}

function attachCloseWiring(mirror: HTMLElement, trigger: HTMLButtonElement): void {
  // 背板点击 = 关闭（背板即容器本体；面板/对话框在其上层，点不到背板）
  mirror.onmousedown = (e) => {
    if (e.target === mirror) closeOfficialSettings();
  };
  // Esc = 关闭
  if (!escAttached) {
    document.addEventListener("keydown", onEsc);
    escAttached = true;
  }
  // 官方面板关闭（aria-expanded 翻回 false，含面板自带关闭钮/Esc）→ 自动收层
  closeObserver?.disconnect();
  closeObserver = new MutationObserver(() => {
    if (!expanded()) closeOfficialSettings();
  });
  closeObserver.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
}

function onEsc(e: KeyboardEvent): void {
  if (e.key === "Escape" && isSurfaced()) closeOfficialSettings();
}

function detachCloseWiring(): void {
  const mirror = mirrorEl();
  if (mirror) mirror.onmousedown = null;
  document.removeEventListener("keydown", onEsc);
  escAttached = false;
  closeObserver?.disconnect();
  closeObserver = null;
}

export function isSurfaced(): boolean {
  return mirrorEl()?.classList.contains(SURFACE_CLASS) ?? false;
}
