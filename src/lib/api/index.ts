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

/** 鑾峰彇鍚庣瀹㈡埛绔崟渚嬶紙mock 妯″紡杩斿洖婕旂ず瀹炵幇锛岀湡瀹炴ā寮忚繑鍥?JSON-RPC 瀹炵幇锛?*/
export function getApi(): MirachClient {
  if (!singleton) {
    singleton = createClient(MOCK);
  }
  return singleton;
}

export type { MirachClient } from "./client";
export type { InstalledPluginInfo, NativeModelCatalog } from "./client";
export type * from "./types";

