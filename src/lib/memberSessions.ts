/**
 * memberSessions — 项目会话模型
 *
 * 会话单位是【项目】：每个项目一个固定会话（跟随主项目建立）。
 * 成员对话是项目会话下的成员线程（memberThreads），
 * 各线程消息独立，但共享项目上下文（PROJECT_CONTEXT）。
 */

import type { ConvItem } from "@/components/layout/LeftSidebar";

export interface ChatMessage {
  id: string;
  role: "member" | "user";
  text: string;
  time: string;
}

export interface ProjectSession {
  projectId: string;
  projectName: string;
  /** 成员线程：memberId → 该成员的消息列表 */
  memberThreads: Record<string, ChatMessage[]>;
}

// 项目上下文（与主对话共享；主项目固定会话）
export const PROJECT_CONTEXT = {
  id: "hermes-agent-project",
  name: "Mirach Agent Project",
  desc: "智能对话助手 · 多模型协作 · 实时响应",
  files: 24,
};

let msgSeq = 0;
const nextId = () => `m${Date.now()}_${msgSeq++}`;

export const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 跟随主项目建立固定会话 */
export function createProjectSession(): ProjectSession {
  return {
    projectId: PROJECT_CONTEXT.id,
    projectName: PROJECT_CONTEXT.name,
    memberThreads: {},
  };
}

/** 确保成员的线程存在（首次打开该成员对话时创建，首条消息为成员预览） */
export function ensureMemberThread(session: ProjectSession, member: ConvItem): ProjectSession {
  if (session.memberThreads[member.id]) return session;
  return {
    ...session,
    memberThreads: {
      ...session.memberThreads,
      [member.id]: [
        {
          id: nextId(),
          role: "member",
          text: member.preview,
          time: member.time,
        },
      ],
    },
  };
}

// 模拟成员回复池（引用项目上下文）
const REPLY_POOL: string[] = [
  "好的，我已经结合项目上下文看了下。这个需求可以从现有模块入手，我先梳理具体方案再同步给你。",
  "收到！结合 Mirach Agent Project 当前的结构，我建议分两步：先对齐接口约定，再实现核心逻辑。",
  "明白，这部分和主对话里讨论的架构是一致的。我会在项目上下文中定位相关模块，确认影响范围。",
  "可以，我会基于项目现有代码调整，完成后更新到共享的项目上下文，主对话也能看到进展。",
  "我查了项目上下文，这条路径可行，但需要注意依赖关系。我列一下具体改动点。",
  "没问题，这个我负责。先做个小范围验证，确认后再全量推进，结果会同步回项目上下文。",
];

/** 生成模拟成员回复（按用户消息长度轮换回复池） */
export function generateMemberReply(_member: ConvItem, userText: string): string {
  const idx = userText.length % REPLY_POOL.length;
  return REPLY_POOL[idx];
}
