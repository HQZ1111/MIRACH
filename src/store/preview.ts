/**
 * preview - 预览目标 store
 *
 * 状态栈 PreviewRow 的数据源：agent/浏览器/产物可 setPreviewUrl 展示预览链接。
 * 默认空 → PreviewRow 不渲染。
 */

import { atom } from "nanostores";

export interface PreviewTarget {
  url: string;
  label?: string;
}

export const $previewTarget = atom<PreviewTarget | null>(null);

export function setPreviewUrl(url: string, label?: string): void {
  $previewTarget.set({ url, label });
}

export function clearPreview(): void {
  $previewTarget.set(null);
}
