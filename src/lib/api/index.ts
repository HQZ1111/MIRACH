/**
 * api 单例 — 按 VITE_MOCK 选择 Mock / Real 客户端
 *
 * import { getApi } from "@/lib/api";
 * const api = getApi();
 * await api.submitPrompt(sessionId, text);
 */

import { MOCK } from "@/lib/mock";
import { createClient, type MirachClient } from "./client";

let singleton: MirachClient | null = null;

/** 获取后端客户端单例（mock 模式返回演示实现，真实模式返回 JSON-RPC 实现） */
export function getApi(): MirachClient {
  if (!singleton) {
    singleton = createClient(MOCK);
  }
  return singleton;
}

export type { MirachClient } from "./client";
export type * from "./types";
