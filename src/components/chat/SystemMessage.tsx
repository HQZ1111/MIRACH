/**
 * SystemMessage - 系统消息
 *
 * 三种格式：
 *   steer  - 转向笔记（compass 图标）
 *   slash  - 斜杠命令状态输出
 *   plain  - 普通文本
 * 居中、小字、muted 色。
 */

import { Compass, Terminal } from "lucide-react";
import type { ReactNode } from "react";

export function SystemMessage({
  text,
  type = "plain",
}: {
  text: string;
  type?: "steer" | "slash" | "plain";
}) {
  let icon: ReactNode = null;
  if (type === "steer") {
    icon = <Compass className="h-3.5 w-3.5 shrink-0" />;
  } else if (type === "slash") {
    icon = <Terminal className="h-3.5 w-3.5 shrink-0" />;
  }

  return (
    <div className="flex justify-center py-2">
      <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-3 py-1 text-[12px] text-muted-foreground">
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );
}
