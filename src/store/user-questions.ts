/**
 * user-questions — 引擎提问（dsh ask_user_question 工具）
 *
 * 引擎需要用户确认/选择时暂停 agent 循环，经 sdk JSON-RPC notification
 * （question/requested）送达：本 store 暂存待答问题，对话区渲染提问卡；
 * 用户作答后经 dsh_rpc question/resolve 回传，引擎恢复继续。
 */

import { atom } from "nanostores";
import { invoke } from "@tauri-apps/api/core";

export interface UserQuestion {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export interface PendingQuestionBatch {
  rpcId: string;
  questions: UserQuestion[];
  askedAt: number;
}

export const $pendingQuestions = atom<PendingQuestionBatch | null>(null);

/** 提问卡最长停留（引擎侧 question 桥 5 分钟超时，UI 留 6 分钟兜底清卡） */
const QUESTION_TTL_MS = 6 * 60 * 1000;

export function setPendingQuestions(batch: PendingQuestionBatch | null): void {
  $pendingQuestions.set(batch);
}

/**
 * 提交回答（选中项 + 可选补充文本），经 dsh_rpc question/resolve 回传引擎。
 * 只有引擎确认接收（ok:true）才清卡：ok:false 或网络错误都保留卡片供重试
 * ——此前无条件清卡导致失败时"提交失败"提示永远看不到。
 */
export async function answerUserQuestion(
  rpcId: string,
  answers: { id: string; selected: string[]; custom?: string }[],
): Promise<boolean> {
  try {
    const res = await invoke<unknown>("dsh_rpc", {
      method: "question/resolve",
      params: { rpcId, answer: { answers } },
    });
    const ok = Boolean((res as { ok?: boolean } | null)?.ok);
    // 只清理仍指向本批次的待答：期间若来了新批次不能误清新批
    if (ok && $pendingQuestions.get()?.rpcId === rpcId) {
      setPendingQuestions(null);
    }
    return ok;
  } catch {
    return false;
  }
}

/** 过期批次清理：MainPanel 定时调用；引擎超时后提问卡不应永久悬挂。 */
export function dropExpiredQuestions(): void {
  const cur = $pendingQuestions.get();
  if (cur && Date.now() - cur.askedAt > QUESTION_TTL_MS) {
    setPendingQuestions(null);
  }
}
