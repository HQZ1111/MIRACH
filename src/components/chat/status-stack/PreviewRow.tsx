/**
 * PreviewRow - 预览链接行
 *
 * 读 store/preview 的 $previewTarget（默认空 → 不渲染）。
 * 点击在新标签打开。
 */

import { useStore } from "@nanostores/react";
import { Globe } from "lucide-react";
import { StatusRow } from "./StatusRow";
import { $previewTarget } from "@/store/preview";

export function PreviewRow() {
  const target = useStore($previewTarget);
  if (!target) return null;

  return (
    <StatusRow
      state="completed"
      icon={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}
      title={target.label ?? target.url.replace(/^https?:\/\//, "")}
      onActivate={() => window.open(target.url, "_blank")}
    />
  );
}
