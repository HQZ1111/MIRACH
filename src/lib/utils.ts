/**
 * shadcn/ui 工具函数
 * cn() — 合并 className，处理 Tailwind 冲突
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
