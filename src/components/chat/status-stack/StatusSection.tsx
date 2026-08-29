/**
 * StatusSection - 可折叠分组
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  ▸  [icon]  label              accessory     │
 *   ├──────────────────────────────────────────────┤
 *   │  [StatusRow ...]                             │
 *   └──────────────────────────────────────────────┘
 *
 * 基于 Radix Collapsible（稳定收展行为）。
 */

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface StatusSectionProps {
  label: string;
  icon?: ReactNode;
  /** 右侧常驻附属（如计数 "3/5"） */
  accessory?: ReactNode;
  /** 默认展开 */
  defaultOpen?: boolean;
  /** 强制展开（忽略折叠状态，如停车时强制显示 Resume） */
  forceOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function StatusSection({
  label,
  icon,
  accessory,
  defaultOpen = true,
  forceOpen = false,
  children,
  className,
}: StatusSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen || open;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={forceOpen ? undefined : setOpen}
      className={cn("group/section", className)}
    >
      <CollapsibleTrigger
        disabled={forceOpen}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
          !forceOpen && "hover:bg-muted",
        )}
      >
        <span className="flex h-3 w-3 shrink-0 items-center justify-center text-muted-foreground">
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
        {icon && (
          <span className="flex shrink-0 items-center justify-center">{icon}</span>
        )}
        <span className="text-[12px] font-medium text-muted-foreground">
          {label}
        </span>
        {accessory && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {accessory}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 pl-1 pt-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
