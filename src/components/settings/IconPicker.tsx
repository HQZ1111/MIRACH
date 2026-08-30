/**
 * IconPicker — 图标选择弹窗（环境插件用）
 *
 * 网格展示 icon-library 全量图标 + 搜索过滤 + 选中高亮；点选即回传。
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { searchIcons, type IconItem } from "@/plugins/icon-library";
import { Search, X, Check } from "lucide-react";

export function IconPicker({
  value,
  onSelect,
  onClose,
}: {
  value?: string;
  onSelect: (iconId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => searchIcons(query), [query]);

  return (
    <div className="absolute left-0 top-0 z-50 h-full w-full overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索图标…"
            className="w-full rounded-md border border-border bg-white py-1 pl-7 pr-7 text-xs outline-none focus:border-[#6366F1]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[#303030]"
              aria-label="清除"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-black/5"
          aria-label="关闭选择器"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="h-[calc(100%-41px)] overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="grid grid-cols-6 gap-1">
          {items.map((item) => (
            <IconCell key={item.id} item={item} selected={item.id === value} onSelect={onSelect} />
          ))}
          {items.length === 0 && (
            <p className="col-span-6 py-6 text-center text-xs text-muted-foreground">无匹配图标</p>
          )}
        </div>
      </div>
    </div>
  );
}

function IconCell({
  item,
  selected,
  onSelect,
}: {
  item: IconItem;
  selected: boolean;
  onSelect: (iconId: string) => void;
}) {
  const Icon = item.Icon;
  return (
    <button
      onClick={() => onSelect(item.id)}
      title={item.label}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[10px] transition-colors",
        selected
          ? "border-[#6366F1] bg-[#6366F1]/8 text-[#6366F1]"
          : "border-transparent text-[#464646] hover:border-border hover:bg-muted",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="max-w-full truncate px-0.5">{item.label}</span>
      {selected && <Check className="h-2.5 w-2.5" />}
    </button>
  );
}
