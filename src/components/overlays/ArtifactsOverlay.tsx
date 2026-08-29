/**
 * ArtifactsOverlay — 产物弹窗（全屏抽屉）
 *
 * 由左侧栏"产物"按钮打开（AppLayout 的 overlayView="artifacts"）。
 * 内容复用 ArtifactsPanel（收集/预览 HTML、SVG、代码、链接产物）。
 */

import { OverlayShell } from "./OverlayShell";
import { ArtifactsPanel } from "@/components/files/ArtifactsPanel";

export function ArtifactsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <OverlayShell title="产物" width={980} height={680} onClose={onClose}>
      <ArtifactsPanel />
    </OverlayShell>
  );
}
