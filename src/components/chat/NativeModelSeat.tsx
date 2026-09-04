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
 * 组件本体从官方包的「源码导出路径」直接 import（@deepseek-ai/dsh-client-ui-
 * model-selection/src/* 在包 exports 里开放，vite 走 workspace 源码；官方
 * client 产物不导出组件名，槽位注入面在无会话上下文时为 null）。官方更新
 * ModelSelect 源码 → mirach 重新构建即跟随。
 *
 * 内核未 boot（mock / VITE_KERNEL=0）或词典不可用时返回 null，Composer
 * 回退 mirach 自有模型菜单。
 */

import { useEffect, useMemo, useState } from "react";
import { nativeLocaleTranslate } from "@/dsh-kernel/boot";
import { loadNativeModelCatalog, modelDirectoryStore, selectNativeModel } from "@/lib/native-model";
import { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";
import type { NativeModelSelection } from "@/lib/native-model";

// 官方 ModelSelect 组件本体从官方包「源码导出路径」直接引入（./src/* 在包
// exports 开放，vite 走 workspace 源码——运行时渲染的就是官方原件，官方改源
// mirach 重建即跟随）。官方 client 产物不导出组件名，槽位注入面在无会话
// context 时为 null，故此处绕开槽位、直接引源码文件。官方源码自身的类型
// 依赖在各自包 tsconfig 下解析，mirach 侧不跨包类型编译它（vite 仍正常
// 打包运行时），所以只做运行时导入 + 本地结构类型。
// @ts-expect-error 官方 src 深度导入：tsc 不跨包解析，vite 打包放行
import { ModelSelect as OfficialModelSelect } from "@deepseek-ai/dsh-client-ui-model-selection/src/client/ModelSelect";

/** ModelSelect 注入席位的本地结构（与官方 src/client/slots.ts 一致） */
interface OfficialModelSeatInjected {
  available: boolean;
  directory: { getSnapshot: () => unknown; subscribe: (fn: () => void) => () => void };
  load: () => void;
  select: (selection: NativeModelSelection) => Promise<boolean>;
}
type OfficialModelSeatProps = OfficialModelSeatInjected & {
  locked: boolean;
  t: (key: string, params?: Record<string, unknown>) => string;
};
type ModelSeatComponent = (props: Record<string, unknown>) => React.ReactElement | null;

/** 词典（内核 boot 晚于渲染时 1.5s 重试；null = 不可用回退 mirach 菜单） */
export function useNativeModelSeat(): ModelSeatComponent | null {
  const [t, setT] = useState(() => nativeLocaleTranslate("model"));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (t) return;
    const to = window.setTimeout(() => {
      const again = nativeLocaleTranslate("model");
      if (again) setT(again);
      setTick((v) => v + 1);
    }, 1500);
    return () => window.clearTimeout(to);
  }, [t, tick]);
  return t ? (OfficialModelSelect as unknown as ModelSeatComponent) : null;
}

/** 官方模型 seat 渲染（挂 DSW alias 令牌：官方 CSS 依赖官方色板变量）；
 *  sessionScope：成员会话等非活跃会话上下文的目标会话 id */
export function NativeModelSeat({ locked = false, sessionScope }: { locked?: boolean; sessionScope?: string }) {
  const seat = useNativeModelSeat();
  const t = useMemo(() => nativeLocaleTranslate("model"), [seat]);
  const store = useMemo(() => modelDirectoryStore(), []);
  useEffect(() => {
    void loadNativeModelCatalog();
  }, []);
  if (!seat || !t) return null;
  return (
    <div className="native-model-seat min-w-0" style={DSW_ALIAS_VARS}>
      <OfficialModelSelect
        locked={locked}
        available
        directory={store as OfficialModelSeatProps["directory"]}
        load={() => { void loadNativeModelCatalog(); }}
        select={(selection: NativeModelSelection) => selectNativeModel(selection, sessionScope)}
        t={t as OfficialModelSeatProps["t"]}
      />
    </div>
  );
}
