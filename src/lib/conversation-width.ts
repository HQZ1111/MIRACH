/**
 * conversation-width — 对话内容宽度的窗口自适应补丁
 *
 * 官方 ConversationRoot 的宽度机制：拖拽手柄把偏好存 localStorage
 * （dsh.conversation.contentWidth，px），发布链在列宽变化时把偏好
 * clamp 到官方硬编码 [640, 列宽-176]。两处与 mirach 布局冲突：
 *  1) 偏好是绝对 px —— 窗口最大化/还原时内容宽不随列宽等比变化；
 *  2) 官方下限 640 按官方网页版列宽假设写死；mirach 主栏最小 706 时
 *     对话列可窄到 426，640 的内容宽塞进去手柄公式为负 → 手柄归零。
 *
 * 本补丁成为宽度的最终裁决者（double rAF 晚于官方发布链落笔）：
 *  - 列宽变化：偏好按新旧列宽比例等比迁移（最大化/还原跟随缩放）；
 *  - 内容宽恒等于 clamp(偏好, 330, 列宽-96)——下限 330（用户设定），
 *    上限使 40px 手柄在最小列宽时恰好贴满可拖；
 *  - 拖拽中（handle data-dragging）不干预，官方实时发布不受扰。
 */

const WIDTH_PREF_KEY = "dsh.conversation.contentWidth";
/** 官方手柄几何：手柄内缘距内容宽 24px + 手柄 40px + 24px 安全区 = 每侧 48px。
 *  内容宽上限 = 列宽 - 96 时手柄恰好 40px 贴满（配合 CSS min-width 28px 兜底） */
const HANDLE_BUDGET = 96;
/** 内容宽下限 = 330（用户设定；列极窄时下限与上限重合，手柄仍可拖） */
const CONTENT_FLOOR = 330;

let columnObserver: ResizeObserver | null = null;
let observedCol: Element | null = null;
let styleObserver: MutationObserver | null = null;
let observedRoot: Element | null = null;
let lastColumn = 0;

function readPref(): number | null {
  try {
    const raw = localStorage.getItem(WIDTH_PREF_KEY);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function findCol(): Element | null {
  return document.querySelector("[class*='centerCol']");
}

function findRoot(col: Element): Element | null {
  return col.querySelector("[data-phase]");
}

/** 当前列宽下的目标内容宽（下限 330，上限保手柄可拖） */
function targetFor(column: number, pref: number): number {
  const upper = Math.max(0, column - HANDLE_BUDGET);
  const lower = Math.min(CONTENT_FLOOR, upper);
  return Math.round(Math.min(Math.max(pref, lower), upper));
}

/** 把裁决值直接发布到官方根元素的 --dsh-chat-user-width（double rAF
 *  保证晚于官方 ResizeObserver 同帧的发布；值相同则不写，防循环） */
function publishInline(root: Element, value: number): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const current = (root as HTMLElement).style.getPropertyValue("--dsh-chat-user-width").trim();
      const next = `${value}px`;
      if (current !== next) {
        (root as HTMLElement).style.setProperty("--dsh-chat-user-width", next);
      }
    }),
  );
}

/** 裁决入口：读偏好与列宽 → 算目标 → 落笔（拖拽中跳过） */
function enforce(): void {
  const col = findCol();
  const root = col ? findRoot(col) : null;
  if (!col || !root) return;
  const dragging = root.querySelector("[data-width-handle][data-dragging]");
  if (dragging) return;
  const pref = readPref();
  if (pref === null) return;
  const column = Math.round(col.getBoundingClientRect().width);
  if (column <= 0) return;
  publishInline(root, targetFor(column, pref));
}

/** 列宽变化：偏好按新旧列宽比例等比迁移（最大化/还原跟随缩放） */
function rescaleFor(column: number): void {
  if (column <= 0 || lastColumn <= 0 || lastColumn === column) return;
  const pref = readPref();
  if (pref === null) return;
  const next = targetFor(column, Math.round(pref * (column / lastColumn)));
  if (next !== pref) {
    try {
      localStorage.setItem(WIDTH_PREF_KEY, String(next));
    } catch {
      /* 存储失败忽略 */
    }
  }
}

/** 应用启动后挂一次：观察官方对话列与官方根元素，成长为宽度裁决者。
 *  官方树异步挂载且可能重挂（视图切换），观察目标失联时自动重连。 */
export function initConversationWidthAutoscale(): void {
  if (typeof ResizeObserver === "undefined" || columnObserver) return;

  const attach = (): void => {
    // 列宽观察：失联重连
    const col = findCol();
    if (col && col !== observedCol) {
      columnObserver?.disconnect();
      columnObserver = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect.width ?? 0);
        if (width > 0 && width !== lastColumn) {
          rescaleFor(width);
          lastColumn = width;
        }
        enforce();
      });
      columnObserver.observe(col);
      observedCol = col;
      // 首次接入：基线记录 + 归一已存偏好（如上次会话最大化时拖出的超宽值）
      const width = Math.round(col.getBoundingClientRect().width);
      if (width > 0) {
        if (lastColumn === 0) {
          const pref = readPref();
          if (pref !== null) {
            const normalized = targetFor(width, pref);
            if (normalized !== pref) {
              try {
                localStorage.setItem(WIDTH_PREF_KEY, String(normalized));
              } catch {
                /* 存储失败忽略 */
              }
            }
          }
        }
        lastColumn = width;
        enforce();
      }
    } else if (!col && observedCol) {
      columnObserver?.disconnect();
      columnObserver = null;
      observedCol = null;
      lastColumn = 0;
    }

    // 官方根元素 style 变化观察（拖拽提交/官方发布后立即裁决纠偏）
    const colNow = observedCol ?? col;
    const root = colNow ? findRoot(colNow) : null;
    if (root && root !== observedRoot) {
      styleObserver?.disconnect();
      styleObserver = new MutationObserver(() => enforce());
      styleObserver.observe(root, { attributes: true, attributeFilter: ["style"] });
      observedRoot = root;
    } else if (observedRoot && (!root || root !== observedRoot)) {
      styleObserver?.disconnect();
      styleObserver = null;
      observedRoot = null;
    }
  };

  // 官方树异步挂载：短轮询直到接上，此后 attach 幂等自愈（重挂自动重连）
  const timer = window.setInterval(attach, 800);
  attach();
  // 挂上列观察后即可停轮询（重连由列观察回调驱动；root 重挂走 styleObserver 检查）
  window.setTimeout(() => window.clearInterval(timer), 30000);
}
