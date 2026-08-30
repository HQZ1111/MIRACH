/**
 * TurnNavigator — 消息定位器（官方原版移植）
 *
 * 来源：packages/client/ui-chat/src/client/chat/TurnNavigator.tsx
 * （@deepseek-ai/dsh-client-ui-chat，官方 ChatView 右侧回合导航轨）。
 * 竖轨刻度 = 每个回合一条，hover/焦点出回合预览（提问 + 回复摘要），
 * 点击整轨或刻度跳转对应回合。少于 2 个回合不显示。
 *
 * 移植差异（仅适配，不改行为）：
 * - TurnNavigationItem / t 在本文件内声明（原版依赖 ui-chat contract 包）；
 * - 颜色/字号由官方 dsw alias 令牌换为 mirach 固定色（对话区为固定浅色）。
 */

import {
  memo, useId, useState, type CSSProperties, type MouseEvent, type PointerEvent,
} from "react";
import css from "./TurnNavigator.module.css";

/** 一条loaded Turn投影进导航轨（原版 contract/snapshot.ts 同名类型） */
export interface TurnNavigationItem {
  readonly turn: number;
  /** 稳定锚点（原版为 Conversation Context key；mirach 传消息数组下标字符串） */
  readonly anchorKey: string;
  /** 有界提问预览；加载窗口从回合中间开始时为空 */
  readonly prompt: string;
  /** 有界回复预览；回合未回答前为空 */
  readonly response: string;
}

/** 官方 ChatViewSlotProps['t'] 的最小契约（mirach 用三键中文实现） */
export type TurnNavigatorT = (key: string, vars?: { turn?: number }) => string;

interface TurnNavigatorProps {
  readonly items: readonly TurnNavigationItem[];
  readonly activeTurn: number | null;
  readonly onNavigate: (item: TurnNavigationItem) => void;
  readonly t: TurnNavigatorT;
}

/** Resting gap between neighbouring marks before the rail compresses to fit. */
const TURN_SPACING_PX = 10;
/** Rail padding above the first mark and below the last one, per end. */
const RAIL_INSET_PX = 6;

type TurnPositionStyle = CSSProperties & {
  readonly "--turn-natural-position": string;
  readonly "--turn-position": string;
};

type TurnRailStyle = CSSProperties & {
  readonly "--turn-natural-height": string;
  readonly "--turn-rail-inset": string;
};

function itemPosition(index: number, count: number): TurnPositionStyle {
  const ratio = count <= 1 ? 0 : index / (count - 1);
  return {
    "--turn-natural-position": `${String(index * TURN_SPACING_PX)}px`,
    "--turn-position": `${String(ratio * 100)}%`,
  };
}

function railSize(count: number): TurnRailStyle {
  return {
    "--turn-natural-height": `${String((count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX)}px`,
    "--turn-rail-inset": `${String(RAIL_INSET_PX)}px`,
  };
}

function itemAtPointer(
  items: readonly TurnNavigationItem[],
  rail: HTMLElement,
  clientY: number,
): TurnNavigationItem | undefined {
  const rect = rail.getBoundingClientRect();
  const usableHeight = Math.max(1, rect.height - 2 * RAIL_INSET_PX);
  const ratio = Math.max(0, Math.min(1, (clientY - rect.top - RAIL_INSET_PX) / usableHeight));
  return items[Math.round(ratio * (items.length - 1))];
}

function TurnNavigatorRail({ items, activeTurn, onNavigate, t }: TurnNavigatorProps) {
  const [previewTurn, setPreviewTurn] = useState<number | null>(null);
  const previewId = useId();
  if (items.length < 2) return null;
  const previewIndex = items.findIndex(item => item.turn === previewTurn);
  const preview = previewIndex < 0 ? undefined : items[previewIndex];
  const previewPosition = previewIndex < 0 ? undefined : itemPosition(previewIndex, items.length);
  const previewAtPointer = (event: PointerEvent<HTMLElement>): void => {
    setPreviewTurn(itemAtPointer(items, event.currentTarget, event.clientY)?.turn ?? null);
  };
  const navigateAtPointer = (event: MouseEvent<HTMLElement>): void => {
    const item = itemAtPointer(items, event.currentTarget, event.clientY);
    if (item !== undefined) onNavigate(item);
  };
  return (
    <div className={css.slot}>
      <nav
        className={css.rail}
        style={railSize(items.length)}
        aria-label={t("chat.turnNavigation.label")}
        onClick={navigateAtPointer}
        onPointerMove={previewAtPointer}
        onPointerLeave={() => { setPreviewTurn(null); }}
      >
        <div className={css.marks}>
          {items.map((item, index) => {
            const active = item.turn === activeTurn;
            const showingPreview = item.turn === previewTurn;
            const markClass = active
              ? `${css.mark} ${css.markActive}`
              : showingPreview ? `${css.mark} ${css.markPreview}` : css.mark;
            return (
              <div key={item.turn} className={css.markPosition} style={itemPosition(index, items.length)}>
                <button
                  type="button"
                  className={markClass}
                  aria-label={t("chat.turnNavigation.jump", { turn: item.turn })}
                  aria-current={active ? "true" : undefined}
                  aria-describedby={showingPreview ? previewId : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNavigate(item);
                  }}
                  onFocus={() => { setPreviewTurn(item.turn); }}
                  onBlur={() => { setPreviewTurn(null); }}
                />
              </div>
            );
          })}
        </div>
        {preview !== undefined && previewPosition !== undefined && (
          <div id={previewId} role="tooltip" className={css.preview} style={previewPosition}>
            <div className={css.previewPrompt}>
              {preview.prompt || t("chat.turnNavigation.turn", { turn: preview.turn })}
            </div>
            {preview.response !== "" && <div className={css.previewResponse}>{preview.response}</div>}
          </div>
        )}
      </nav>
    </div>
  );
}

/**
 * Compact rail of the currently loaded Turns with hover and focus previews.
 *
 * Memoized because it renders two host elements per loaded Turn while the
 * enclosing view re-renders on every streaming delta: without the guard a long
 * session rebuilds hundreds of marks per commit for a rail that only changes
 * when a Turn is added, removed, or becomes active. Its props must therefore
 * stay referentially stable across those commits.
 */
export const TurnNavigator = memo(TurnNavigatorRail);
