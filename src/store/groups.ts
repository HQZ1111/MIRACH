/**
 * groups — 群聊定义 store（聊天环境）
 *
 * 群聊 = 聊天环境智能体团队里的一个伪成员（ConvItem，id = grp-<ts>），
 * 成员列表里直接可见、点击进入群聊面板；参与者与回复策略存这里。
 * 发送流程（AppLayout）：按策略选出应答成员，逐个走各自的成员会话
 * （persona/酒馆预设照常生效），回复带 from 署名写回群聊线程。
 */

import { atom } from "nanostores";

export type GroupMode = "all" | "round";

export interface GroupDef {
  /** 群聊 id（= 智能体团队里的伪成员 id，grp-<ts>） */
  id: string;
  name: string;
  /** 参与成员 id 列表（按回复顺序） */
  memberIds: string[];
  /** 回复策略：all=全员依次回复；round=轮流（每次一人） */
  mode: GroupMode;
}

const STORAGE_KEY = "mirach.groups.v1";

export const $groups = atom<GroupDef[]>(loadGroups());

function loadGroups(): GroupDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as GroupDef[]) : [];
    return Array.isArray(arr) ? arr.filter((g) => g && g.id && Array.isArray(g.memberIds)) : [];
  } catch {
    return [];
  }
}

function persist(list: GroupDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* 配额满静默 */
  }
}

export function getGroupById(id: string): GroupDef | undefined {
  return $groups.get().find((g) => g.id === id);
}

/** 创建群聊（id 可选：传入智能体团队里已建的伪成员 id） */
export function createGroup(name: string, memberIds: string[], mode: GroupMode, id?: string): GroupDef {
  const g: GroupDef = {
    id: id ?? `grp-${Date.now().toString(36)}`,
    name: name.trim() || "未命名群聊",
    memberIds,
    mode,
  };
  persist([...$groups.get(), g]);
  $groups.set([...$groups.get(), g]);
  return g;
}

/** 更新群聊（参与者/模式/名称） */
export function updateGroup(id: string, patch: Partial<Omit<GroupDef, "id">>): void {
  persist($groups.get().map((g) => (g.id === id ? { ...g, ...patch } : g)));
  $groups.set($groups.get().map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

/** 删除群聊定义（伪成员由调用方从 agents store 移除） */
export function removeGroup(id: string): void {
  persist($groups.get().filter((g) => g.id !== id));
  $groups.set($groups.get().filter((g) => g.id !== id));
}
