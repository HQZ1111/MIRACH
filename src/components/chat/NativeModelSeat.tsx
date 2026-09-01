/**
 * NativeModelSeat — 官方模型选型 seat（输入框接官方组件）
 *
 * 官方 ModelSelect 组件（ui-model-selection 包：模型 / 思考档位两级菜单，
 * 数据走官方 /model 弹出选择同一目录），注入席位由 mirach 供：
 *   - directory store = 官方 session.modelCatalog + 会话 model/selection 投影
 *     事件（src/lib/native-model.ts，形状与官方 ModelDirectoryState 一致）
 *   - select = 官方 session.selectModel（sidecar 映射前端会话 id → dsh id）
 *   - t = 官方 'model' 词典（内核 locale.bind）
 *
 * 内核未 boot（mock / VITE_KERNEL=0）时 useNativeModelSeat 返回 null，
 * Composer 回退 mirach 自有模型菜单。官方更新 ModelSelect 时本组件跟随。
 */

import { useEffect, useMemo, useState } from "react";
import { nativeLocaleTranslate, nativeModelSeat } from "@/dsh-kernel/boot";
import { loadNativeModelCatalog, modelDirectoryStore, selectNativeModel } from "@/lib/native-model";
import { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";

type ModelSeatComponent = (props: Record<string, unknown>) => React.ReactElement | null;

/** 官方 ModelSelect 组件 + 词典（内核 boot 晚于渲染时 1.5s 重试） */
export function useNativeModelSeat(): ModelSeatComponent | null {
  const [seat, setSeat] = useState<ModelSeatComponent | null>(() => nativeModelSeat()?.ModelSelect ?? null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (seat) return;
    const t = window.setTimeout(() => {
      const again = nativeModelSeat();
      if (again?.ModelSelect) setSeat(again.ModelSelect);
      setTick((v) => v + 1);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [seat, tick]);
  return seat;
}

/** 官方模型 seat 渲染（挂 DSW alias 令牌：官方 CSS 依赖官方色板变量）；
 *  sessionScope：成员会话等非活跃会话上下文的目标会话 id */
export function NativeModelSeat({ locked = false, sessionScope }: { locked?: boolean; sessionScope?: string }) {
  const ModelSelect = useNativeModelSeat();
  const t = useMemo(() => nativeLocaleTranslate("model"), [ModelSelect]);
  const store = useMemo(() => modelDirectoryStore(), []);
  useEffect(() => {
    void loadNativeModelCatalog();
  }, []);
  if (!ModelSelect || !t) return null;
  return (
    <div className="native-model-seat min-w-0" style={DSW_ALIAS_VARS}>
      <ModelSelect
        locked={locked}
        available
        directory={store}
        load={() => { void loadNativeModelCatalog(); }}
        select={(selection: Parameters<typeof selectNativeModel>[0]) => selectNativeModel(selection, sessionScope)}
        t={t}
      />
    </div>
  );
}
