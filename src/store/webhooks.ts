/**
 * webhooks - Webhook 订阅 store（本地持久化）
 *
 * 订阅列表：名称 / URL / 事件 / 投递目标 / 启用状态。
 * 存 localStorage（hermes.webhooks.v1）。真实投递由后端 Webhook 服务完成，
 * 前端先做管理 UI + 持久化。
 */

import { atom } from "nanostores";

export interface WebhookSub {
  id: string;
  name: string;
  url: string;
  events: string;
  deliver: string;
  enabled: boolean;
}

const STORAGE_KEY = "mirach.webhooks.v1";

const SEED: WebhookSub[] = [
  { id: "w1", name: "Deploy notifications", url: "https://mirach.local/hooks/deploy", events: "deploy.completed, deploy.failed", deliver: "log + telegram", enabled: true },
  { id: "w2", name: "Daily digest", url: "https://mirach.local/hooks/digest", events: "daily.summary", deliver: "email", enabled: false },
];

function load(): WebhookSub[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      // 数组校验：损坏但合法的 JSON（如旧 schema 对象）不会让 addWebhook 崩溃
      if (Array.isArray(parsed)) return parsed as WebhookSub[];
    }
  } catch {
    /* ignore */
  }
  return SEED;
}

function persist(list: WebhookSub[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export const $webhooks = atom<WebhookSub[]>(load());

function commit(list: WebhookSub[]): void {
  persist(list);
  $webhooks.set(list);
}

let idSeq = 0;

export function addWebhook(input: Omit<WebhookSub, "id" | "enabled">): WebhookSub {
  const sub: WebhookSub = {
    id: `w${Date.now()}_${idSeq++}`,
    name: input.name || "未命名订阅",
    url: input.url,
    events: input.events,
    deliver: input.deliver,
    enabled: true,
  };
  commit([...$webhooks.get(), sub]);
  return sub;
}

export function toggleWebhook(id: string): void {
  commit(
    $webhooks.get().map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w)),
  );
}

export function removeWebhook(id: string): void {
  commit($webhooks.get().filter((w) => w.id !== id));
}
