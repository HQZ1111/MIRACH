/**
 * FilesOverlay — 文件树弹窗（顶栏下拉打开）
 */

import { OverlayShell } from "./OverlayShell";
import { FilesPanel } from "@/components/files/FilesPanel";

export function FilesOverlay({ onClose }: { onClose: () => void }) {
  return (
    <OverlayShell title="文件树" width={900} height={660} onClose={onClose}>
      <FilesPanel />
    </OverlayShell>
  );
}
