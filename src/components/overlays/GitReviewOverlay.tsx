/**
 * GitReviewOverlay — Git Review 弹窗（顶栏下拉打开）
 */

import { OverlayShell } from "./OverlayShell";
import { GitReviewPanel } from "@/components/files/GitReviewPanel";

export function GitReviewOverlay({ onClose }: { onClose: () => void }) {
  return (
    <OverlayShell title="Git Review" width={980} height={680} onClose={onClose}>
      <GitReviewPanel />
    </OverlayShell>
  );
}
