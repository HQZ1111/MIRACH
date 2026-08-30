/**
 * agent - Agent 状态共享
 *
 * busy 状态从 Composer 的 useState 提升为全局 atom，
 * 让 queue auto-drain、status stack 等组件都能观察。
 *
 * sendHandler 机制让 auto-drain 能触发发送，
 * 由 Composer 在挂载时注册。
 *
 * agentMode：Composer 三模式（plan/workspace/full）全局共享，
 * 对话区 Plan chip、工具菜单开关与 Composer 模式选择读写同一份，
 * 保证「计划模式」真正联动（参考引擎 /yolo 审批语义）。
 */

import { atom, computed } from "nanostores";

/**
 * Agent 忙碌桶：按会话 id 分桶（key "" = 无会话上下文的全局桶）。
 * busy 是"会话的属性"而非应用全局属性——A 会话回复中，切到 B 会话
 * 应立即可发送（B 未发消息 = 不忙），输入框/等待指示都按活跃会话读桶。
 */
export const $busyMap = atom<Record<string, true>>({});

/** 任一会话忙（队列 auto-drain 等全局语义观察用） */
export const $agentBusy = computed($busyMap, (m) => Object.keys(m).length > 0);

/** 设置某会话忙碌状态；sid 省略 = 全局桶（mock/无会话上下文场景） */
export function setAgentBusy(busy: boolean, sid?: string): void {
  const key = sid ?? "";
  const prev = $busyMap.get();
  const has = Object.prototype.hasOwnProperty.call(prev, key);
  if (busy === has) return; // 无变化不发布（避免 computed 抖动）
  const next = { ...prev };
  if (busy) next[key] = true;
  else delete next[key];
  $busyMap.set(next);
}

/** 清空全部忙碌桶（队列"立即发送/断开当前 turn"等全局中断语义用） */
export function clearAgentBusy(): void {
  $busyMap.set({});
}

// ----------------------------------------------------------------
// 发送处理器（由 Composer 注册，auto-drain 调用）
// ----------------------------------------------------------------

type SendHandler = (text: string) => void;

let _sendHandler: SendHandler | null = null;

/** Composer 挂载时注册发送回调 */
export function setSendHandler(fn: SendHandler | null) {
  _sendHandler = fn;
}

/** auto-drain 调用：触发实际发送；返回是否有处理器接收（无处理器时调用方回滚忙标记） */
export function sendMessage(text: string): boolean {
  if (!_sendHandler) return false;
  _sendHandler(text);
  return true;
}

// ----------------------------------------------------------------
// Agent 工作模式（plan / workspace / full，对应 dsh 权限三档）
// ----------------------------------------------------------------

export type AgentMode = "plan" | "workspace" | "full";

/** 当前 Agent 模式（Composer 三选一；对话区 Plan chip / 工具菜单联动） */
export const $agentMode = atom<AgentMode>("workspace");

export function setAgentMode(mode: AgentMode): void {
  $agentMode.set(mode);
}

/** plan 模式 = 只分析规划，不修改文件 */
export function isPlanMode(): boolean {
  return $agentMode.get() === "plan";
}

// 审批模式（设置-安全）：manual=工具需人工审批 / smart=按模式（plan 需审批）/ off=自动批准
export type ApprovalMode = "manual" | "smart" | "off";

export const $approvalMode = atom<ApprovalMode>("smart");

export function setApprovalMode(mode: ApprovalMode): void {
  $approvalMode.set(mode);
}

/** 是否需要人工审批：off 永不 / manual 恒要 / smart 仅 plan 模式 */
export function requiresApproval(): boolean {
  const mode = $approvalMode.get();
  if (mode === "off") return false;
  if (mode === "manual") return true;
  return $agentMode.get() === "plan";
}
