/**
 * artifacts - 产物注册表 store
 *
 * 收集聊天消息中的产物（HTML/SVG/代码/链接），按内容去重。
 * 预览渲染见 ArtifactsPanel；接真实后端后由 message delta 事件驱动。
 */

import { atom } from "nanostores";
import type { Artifact } from "@/lib/artifact-detect";

export const $artifacts = atom<Artifact[]>([]);

/** 收集一批产物（按内容去重，最新在前） */
export function addArtifacts(items: Artifact[]): void {
  if (items.length === 0) return;
  const cur = $artifacts.get();
  const seen = new Set(cur.map((a) => a.content || a.url || a.id));
  const fresh = items.filter((a) => !seen.has(a.content || a.url || a.id));
  if (fresh.length > 0) {
    $artifacts.set([...fresh, ...cur]);
  }
}

export function clearArtifacts(): void {
  $artifacts.set([]);
}
