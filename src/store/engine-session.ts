/**
 * engine-session — 引擎会话绑定（persona + 会话映射）
 *
 * sidecar 的 systemPrompt 是运行时全局的（一次注入整个 runtime），会话映射
 * 也按"最近一次 load_session"生效。主对话与成员私聊共用同一个 runtime，
 * 因此**每次发送前各自绑定**：成员发送绑成员人设 + member-<id> 会话，
 * 主对话发送绑主 persona + 主会话。两次本地 RPC，串行执行，成本可忽略。
 *
 * $engineEnv / $mainPersona 由 MainPanel 的环境流水线写入（唯一写入口）。
 */

import { atom } from "nanostores";
import { invoke } from "@tauri-apps/api/core";

/** 当前引擎环境（envId = 会话命名空间前缀；cwd = 工作区） */
export const $engineEnv = atom<{ id: string; cwd: string | null }>({ id: "main", cwd: null });

/** 主聊天 persona（默认成员的 systemPrompt；null = 引擎默认） */
export const $mainPersona = atom<string | null>(null);

/**
 * 绑定引擎到指定前端会话（set_env 下发 persona + load_session 建立映射）。
 * 之后对该 sessionId 的 prompt/steer 即在绑定的 dsh 会话里跑（有上文）。
 */
export async function bindEngineSession(sessionId: string, persona: string | null): Promise<void> {
  const env = $engineEnv.get();
  await invoke("dsh_set_env", { envId: env.id, cwd: env.cwd, systemPrompt: persona });
  await invoke("load_dsh_session", { sessionId });
}
