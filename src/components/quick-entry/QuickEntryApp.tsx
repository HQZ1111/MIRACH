/**
 * QuickEntryApp — quick entry 迷你窗口（全局快捷键 Alt+Space 唤起）
 *
 * 无边框置顶小窗：单输入框，Enter 提交 → 发 quick-entry:submit 事件给主窗口
 * （主窗口按当前发送逻辑处理）→ 关闭本窗口；Esc 关闭。
 */

import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { Send } from "lucide-react";

export function QuickEntryApp() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    void emit("quick-entry:submit", { text: v });
    void getCurrentWindow().close();
  };

  return (
    <div className="flex h-screen items-center gap-2 border border-black/10 bg-white px-3">
      <span className="shrink-0 text-[11px] font-semibold text-[#6366F1]">Mirach</span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") void getCurrentWindow().close();
        }}
        placeholder="发送消息…（Enter 发送，Esc 关闭）"
        className="min-w-0 flex-1 rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
      />
      <button
        onClick={submit}
        disabled={!text.trim()}
        title="发送"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#303030] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <Send className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
