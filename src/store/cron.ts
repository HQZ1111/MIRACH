/**
 * cron - 排程任务 store（对齐 dsh 官方排程语义）
 *
 * dsh 的"定时任务"是 session 内提醒：schedule 插件注册 schedule_create /
 * schedule_list / schedule_delete 三个 LLM 工具（after/at/every 三种，
 * 没有 crontab 表达式、没有外部 RPC 面）。因此：
 *  - 创建：把用户选择折算成一句 schedule 指令，经 send_prompt 让模型调用
 *    schedule_create（会话内自然触发工具栏确认链）；
 *  - 删除：同样经 prompt 调 schedule_delete；
 *  - 列表：dsh 无跨会话任务目录（schedule/change 记录在会话日志里），本地
 *    localStorage 持久化登记表——记录真实创建过的任务与状态，绝不灌假数据。
 *
 * mock 模式保留演示种子（VITE_MOCK=1 才有），真实模式永远是真操作。
 */

import { atom } from "nanostores";
import { MOCK } from "@/lib/mock";
import { invoke } from "@tauri-apps/api/core";

export interface EngineCronJob {
  id: string;
  name: string;
  prompt: string;
  /** 折算后的频率说明（如 "every-15-minutes" → 每 15 分钟）；custom 时为原文 */
  schedule: string;
  /** 下发给模型的完整指令（复现/删除用） */
  instruction: string;
  deliver: string;
  enabled: boolean;
  status: "scheduled" | "running" | "paused" | "disabled" | "error" | "completed";
  createdAt: number;
}

const STORAGE_KEY = "mirach.cron.v2";
/** 旧 api_server 假数据键，直接废弃 */
const LEGACY_KEY = "mirach.cron.v1";

function load(): EngineCronJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as EngineCronJob[];
      if (Array.isArray(arr)) return arr.filter((j) => j && j.id && j.instruction);
    }
  } catch {
    /* ignore */
  }
  return [];
}

function persist(list: EngineCronJob[]): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// 本地 mock 种子仅 mock 构建（VITE_MOCK=1）
const MOCK_JOBS: EngineCronJob[] = [
  {
    id: "c1",
    name: "每日摘要（演示）",
    prompt: "总结今天的工作进展并给出明日建议。",
    schedule: "daily",
    instruction: "每 30 秒后提醒我查看一次工作进展（演示任务，可删除）。",
    deliver: "本桌面对话",
    enabled: true,
    status: "scheduled",
    createdAt: Date.now(),
  },
];

export const $cronJobs = atom<EngineCronJob[]>(MOCK ? MOCK_JOBS : load());
export const $cronEngineOk = atom(!MOCK);
export const $cronLoading = atom(false);

export function persistCronJobs(): void {
  if (!MOCK) persist($cronJobs.get());
}

/**
 * 频率选择 → 一句中文 schedule 指令（模型据此调 schedule_create；
 * 每 N 分钟映射 every_seconds=N*60）。返回 null 表示 custom 且无法解析。
 */
export function frequencyToInstruction(name: string, prompt: string, freqValue: string, customCron: string): string | null {
  const body = prompt.trim();
  const label = name.trim() || body.slice(0, 20) || "定时任务";
  switch (freqValue) {
    case "every-15-minutes":
      return `创建一个每 15 分钟重复的提醒：${label}。内容：${body}`;
    case "hourly":
      return `创建一个每小时重复的提醒：${label}。内容：${body}`;
    case "daily":
      return `创建一个每天上午 9 点的提醒（at 绝对时间方式）：${label}。内容：${body}`;
    case "weekdays":
      return `分别创建周一到周五每天上午 9 点的提醒（共五个）：${label}。内容：${body}`;
    case "weekly":
      return `创建一个每周一上午 9 点的提醒：${label}。内容：${body}`;
    case "monthly":
      return `创建一个每月 1 号上午 9 点的提醒：${label}。内容：${body}`;
    default:
      // custom：用户填的任意文案透传给模型理解
      return customCron.trim()
        ? `创建一个定时提醒，时间规则按这个描述执行：「${customCron.trim()}」。名称：${label}。内容：${body}`
        : null;
  }
}

/**
 * 创建任务：把指令经 send_prompt 发给当前活跃会话（模型在会话里调用
 * schedule_create；session-local 语义 = 任务随该会话存活）。
 * 本地登记表同步落一条（pending → 用户在对话区看到工具行/结果）。
 */
export async function createCronJob(draft: {
  name: string;
  prompt: string;
  schedule: string;
  deliver: string;
}): Promise<boolean> {
  const instruction = frequencyToInstruction(draft.name, draft.prompt, draft.schedule, "");
  if (!instruction) return false;
  if (MOCK) {
    $cronJobs.set([
      {
        id: `c${Date.now()}`,
        name: draft.name || draft.prompt.slice(0, 30) || "Cron job",
        prompt: draft.prompt,
        schedule: draft.schedule,
        instruction,
        deliver: draft.deliver,
        enabled: true,
        status: "scheduled",
        createdAt: Date.now(),
      },
      ...$cronJobs.get(),
    ]);
    return true;
  }
  try {
    await invoke("send_prompt", {
      text: `${instruction}\n（这是「定时任务」面板下发的排程请求；请立即调用 schedule_create 完成。）`,
    });
  } catch (e) {
    console.warn("[cron] 发送排程请求失败:", e);
    return false;
  }
  $cronJobs.set([
    {
      id: `c${Date.now()}`,
      name: draft.name || draft.prompt.slice(0, 30) || "Cron job",
      prompt: draft.prompt,
      schedule: draft.schedule,
      instruction,
      deliver: draft.deliver,
      enabled: true,
      status: "scheduled",
      createdAt: Date.now(),
    },
    ...$cronJobs.get(),
  ]);
  persist($cronJobs.get());
  return true;
}

export async function removeCronJob(id: string): Promise<void> {
  const j = $cronJobs.get().find((x) => x.id === id);
  if (!j) return;
  if (!MOCK && j.instruction) {
    try {
      await invoke("send_prompt", {
        text: `请调用 schedule_delete 删除当前会话中的这个提醒：「${j.name}」（如果存在多个同名取最早创建的那个）。\n原始要求：${j.instruction}`,
      });
    } catch (e) {
      console.warn("[cron] 发送删除请求失败:", e);
    }
  }
  $cronJobs.set($cronJobs.get().filter((x) => x.id !== id));
  persist($cronJobs.get());
}

/**
 * 列表拉取：真实模式读本地登记（不降级假数据）。engineOk 语义改为
 * "sidecar 就绪"——探测不再打旧 api_server。
 */
export async function loadCronJobs(): Promise<boolean> {
  if (MOCK) {
    $cronJobs.set(MOCK_JOBS);
    $cronEngineOk.set(true);
    return true;
  }
  $cronLoading.set(true);
  try {
    $cronJobs.set(load());
    $cronEngineOk.set(true);
    return true;
  } finally {
    $cronLoading.set(false);
  }
}

// 以下操作在 dsh 的会话内提醒模型没有暂停/恢复 RPC 面（pause 需要重新
// 发指令重建），UI 仍展示按钮但真实模式下提示语义；mock 保持本地切换。
export async function togglePauseCron(id: string): Promise<void> {
  if (MOCK) {
    $cronJobs.set(
      $cronJobs.get().map((x) =>
        x.id === id ? { ...x, status: x.status === "paused" ? "scheduled" : "paused", enabled: x.status === "paused" } : x,
      ),
    );
    return;
  }
  const j = $cronJobs.get().find((x) => x.id === id);
  if (!j) return;
  const pausing = j.status !== "paused";
  if (pausing) {
    await removeCronJob(id); // 引擎侧删除即停
  } else {
    await invoke("send_prompt", { text: `请调用 schedule_create 重新建立这个提醒：${j.instruction}` }).catch(() => {});
    $cronJobs.set(
      $cronJobs.get().map((x) => (x.id === id ? { ...x, status: "scheduled", enabled: true } : x)),
    );
    persist($cronJobs.get());
  }
}

export async function triggerCronNow(id: string): Promise<void> {
  const j = $cronJobs.get().find((x) => x.id === id);
  if (!MOCK && j) {
    try {
      await invoke("send_prompt", { text: `立即执行一次这个定时任务的主体内容（不用新建 schedule，直接做）：${j.prompt}` });
      $cronJobs.set($cronJobs.get().map((x) => (x.id === id ? { ...x, status: "running" } : x)));
      persist($cronJobs.get());
      return;
    } catch (e) {
      console.warn("[cron] 立即运行失败:", e);
    }
  }
  $cronJobs.set($cronJobs.get().map((x) => (x.id === id ? { ...x, status: "running" } : x)));
}
