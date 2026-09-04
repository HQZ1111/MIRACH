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
/* 背板与抬层：浮出时镜像容器升到一切 UI 之上（遮罩视觉由官方 mask 层提供，
   容器本体不再自画背景，避免与官方 --dsw-alias-bg-mask-1 双重叠色） */
[data-kernel-mirror].${SURFACE_CLASS} {
  opacity: 1 !important;
  z-index: 400 !important;
  pointer-events: auto !important;
}
/* 隐藏镜像其余部分（帧整体 visibility:hidden）；visibility 可被后代覆盖。
   注意：不再给 overlay 套自定义尺寸/圆角/overflow——官方 panel 自身就是
   width:800px; height:min(800px,100vh-48px); border-radius:24px 的居中对话框
   （fixed inset:0 flex 居中），官方更新几何时本视图直接跟随。 */
[data-kernel-mirror].${SURFACE_CLASS} [data-slot="root"] > div {
  visibility: hidden;
}
[data-kernel-mirror].${SURFACE_CLASS} [data-slot="sidebar.settings"] > div {
  visibility: visible;
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
  // 背板点击 = 关闭。背板是官方 mask 层（overlay 内 absolute inset:0 的 .WYVdaG_mask，
  // 类名是 css-modules 哈希，不能写死）——用结构判定：点击目标在 overlay 容器内、
  // 但不是 panel 及其后代（panel 是 overlay 内除 mask 之外的常驻层）。
  const overlay = mirror.querySelector<HTMLElement>('[data-slot="sidebar.settings"] > div');
  mirror.onmousedown = (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !overlay) return;
    if (!overlay.contains(t)) return; // 面板外（容器本体，理论上点不到）也可关闭
    if (t.closest('[class*="_panel"]')) return; // 官方面板靠 css-modules 类名标识面板层
    closeOfficialSettings();
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
