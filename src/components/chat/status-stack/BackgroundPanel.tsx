/**
 * BackgroundPanel - 后台进程面板
 *
 * 每个进程显示名称 + 状态 + stop/dismiss 操作。
 */

import { useStore } from "@nanostores/react";
import { Server, Square, X } from "lucide-react";
import {
  $bgState,
  removeBackgroundProcess,
  type BackgroundStatus,
} from "@/store/background-processes";
import type { ItemState } from "@/store/composer-status";
import { StatusSection } from "./StatusSection";
import { StatusRow } from "./StatusRow";

function bgToItemState(status: BackgroundStatus): ItemState {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "error";
  }
}

export function BackgroundPanel() {
  const { processes } = useStore($bgState);
  if (processes.length === 0) return null;

  return (
    <StatusSection
      label="后台"
      icon={<Server className="h-3.5 w-3.5 text-muted-foreground" />}
      accessory={`${processes.length}`}
    >
      {processes.map((p) => (
        <StatusRow
          key={p.id}
          state={bgToItemState(p.status)}
          title={p.name}
          subtitle={p.status === "failed" ? "失败" : undefined}
          trailing={
            <>
              {p.status === "running" && (
                <button
                  title="停止"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBackgroundProcess(p.id);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
                >
                  <Square className="h-3 w-3" />
                </button>
              )}
              <button
                title="关闭"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBackgroundProcess(p.id);
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          }
        />
      ))}
    </StatusSection>
  );
}
