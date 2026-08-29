/**
 * ShareControls — 星图分享控制（S3-5，对应原型 share-controls）
 *
 * 「分享」生成 HML1 分享码（可复制到剪贴板）；
 * 「导入」粘贴分享码重建星图（校验失败给出原因）；
 * 「重置」清除导入数据，恢复本地 store 快照。
 */

import { useRef, useState } from "react";
import { Check, Clipboard, Download, Import, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareControlsProps {
  /** 当前图生成的分享码（未生成时 null） */
  code: string | null;
  /** 当前图是否来自导入 */
  imported: boolean;
  /** 生成分享码（由父组件写入 code） */
  onShare: () => void;
  /** 导入回调：返回错误信息（成功返回 null） */
  onImport: (code: string) => string | null;
  /** 清除导入数据 */
  onReset: () => void;
}

export function ShareControls({ code, imported, onShare, onImport, onReset }: ShareControlsProps) {
  const [mode, setMode] = useState<"idle" | "share" | "import">("idle");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleMode = (next: "share" | "import") => {
    setMode((m) => (m === next ? "idle" : next));
    setError(null);
    setDraft("");
  };

  const doCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用（非安全上下文）：选中文本供手动复制
      inputRef.current?.select();
    }
  };

  const doImport = () => {
    const err = onImport(draft);
    if (err) {
      setError(err);
      return;
    }
    setMode("idle");
    setDraft("");
    setError(null);
  };

  const btn = (active: boolean) =>
    cn(
      "flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
      active
        ? "border-[#303030] bg-[#303030] text-white"
        : "border-border bg-white text-[#464646] hover:bg-muted",
    );

  return (
    <div className="relative flex items-center gap-1">
      <button className={btn(mode === "share")} onClick={() => toggleMode("share")}>
        <Download className="h-3 w-3" strokeWidth={2} />
        分享
      </button>
      <button className={btn(mode === "import")} onClick={() => toggleMode("import")}>
        <Import className="h-3 w-3" strokeWidth={2} />
        导入
      </button>
      {imported && (
        <button className={btn(false)} onClick={onReset} title="重置为本地星图">
          <RotateCcw className="h-3 w-3" strokeWidth={2} />
          重置
        </button>
      )}

      {/* ---- 分享 popover ---- */}
      {mode === "share" && (
        <div className="panel-glass menu-anim absolute right-0 top-full z-20 mt-1 w-80 rounded-xl p-3">
          <p className="mb-1.5 text-xs font-medium text-[#303030]">星图分享码</p>
          {code ? (
            <>
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  readOnly
                  value={code}
                  className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-2 py-1.5 font-mono text-[10px] text-[#303030] outline-none"
                />
                <button
                  onClick={doCopy}
                  title="复制"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-[#464646] transition-colors hover:bg-muted"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" strokeWidth={2} />
                  ) : (
                    <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                在另一台设备上打开星图 → 导入并粘贴此码，即可还原会话 / 项目 / 插件快照。
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">
                基于当前星图（会话 / 项目 / 插件）生成 HML1 分享码。
              </p>
              <button
                onClick={onShare}
                className="mt-2 w-full rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                生成分享码
              </button>
            </>
          )}
        </div>
      )}

      {/* ---- 导入 popover ---- */}
      {mode === "import" && (
        <div className="panel-glass menu-anim absolute right-0 top-full z-20 mt-1 w-80 rounded-xl p-3">
          <p className="mb-1.5 text-xs font-medium text-[#303030]">导入星图分享码</p>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && doImport()}
            placeholder="HML1:…"
            className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-[11px] text-[#303030] outline-none transition-colors focus:border-[#6366F1] placeholder:text-muted-foreground"
          />
          {error && <p className="mt-1 text-[10px] text-red-500">{error}</p>}
          <button
            onClick={doImport}
            disabled={!draft.trim()}
            className="mt-2 w-full rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            导入
          </button>
        </div>
      )}
    </div>
  );
}
