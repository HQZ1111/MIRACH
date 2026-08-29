/**
 * ClarifyCard - 澄清问答卡片
 *
 * 选项按钮 A/B/C… + "其他" 自由文本。
 * 1-9 快捷键选择选项，Enter 确认自由文本。
 * 已答时显示选中状态。
 */

import { useState, useEffect } from "react";
import { HelpCircle, Check } from "lucide-react";

export interface ClarifyOption {
  label: string;
  value: string;
}

export function ClarifyCard({
  question,
  options,
  onAnswer,
}: {
  question: string;
  options: ClarifyOption[];
  onAnswer?: (value: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  // 1-9 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showOther) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= options.length) {
        handleSelect(options[num - 1].value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [options, showOther]);

  const handleSelect = (value: string) => {
    setSelected(value);
    onAnswer?.(value);
  };

  return (
    <div className="my-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <HelpCircle className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="text-body-sm font-medium text-[#303030]">{question}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            onClick={() => handleSelect(opt.value)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition-colors ${
              selected === opt.value
                ? "bg-blue-600 text-white"
                : "bg-white text-[#303030] hover:bg-blue-100"
            }`}
          >
            <span className="text-[11px] opacity-60">
              {String.fromCharCode(65 + i)}
            </span>
            {opt.label}
            {selected === opt.value && <Check className="h-3 w-3" />}
          </button>
        ))}
        <button
          onClick={() => setShowOther(!showOther)}
          className={`rounded-full px-3 py-1 text-[13px] transition-colors ${
            showOther
              ? "bg-blue-600 text-white"
              : "bg-white text-[#303030] hover:bg-blue-100"
          }`}
        >
          其他
        </button>
      </div>
      {showOther && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && otherText.trim()) {
                handleSelect(otherText.trim());
                setShowOther(false);
              }
            }}
            placeholder="输入你的回答..."
            className="flex-1 rounded-md border border-blue-300 px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={() => {
              if (otherText.trim()) {
                handleSelect(otherText.trim());
                setShowOther(false);
              }
            }}
            className="rounded-md bg-blue-600 px-3 py-1 text-[13px] text-white"
          >
            确认
          </button>
        </div>
      )}
    </div>
  );
}
