/**
 * PromptDialogOverlay — 通用文本输入弹窗（替换 window.prompt）
 *
 * $promptDialog 非空时显示：单行输入 + 取消/确定。
 * 复用 panel-glass + popup-anim 玻璃弹窗风格（同 PasswordModal），
 * z-[120] 盖在 SettingsOverlay 等常规浮层之上。
 * 打开时自动聚焦并全选初值，Enter 提交 / Esc 取消。
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { $promptDialog } from "@/store/prompt-dialog";

export function PromptDialogOverlay() {
  const state = useStore($promptDialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开时重置输入值
  useEffect(() => {
    if (state) {
      setValue(state.initialValue ?? "");
      // 聚焦 + 全选初值，方便直接覆盖输入
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    }
  }, [state]);

  if (!state) return null;

  const close = (v: string | null) => {
    $promptDialog.set(null);
    state.resolve(v);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md">
      <div className="absolute inset-0" onClick={() => close(null)} />
      <div className="panel-glass popup-anim relative w-96 rounded-2xl p-5">
        <h3 className="text-member font-bold text-[#303030]">{state.title}</h3>
        {state.label && <p className="mt-1 text-[11px] text-muted-foreground">{state.label}</p>}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") close(value);
            if (e.key === "Escape") close(null);
          }}
          placeholder={state.placeholder}
          className="mt-3 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => close(null)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
          >
            {state.cancelText ?? "取消"}
          </button>
          <button
            onClick={() => close(value)}
            className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {state.confirmText ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
