/**
 * UserQuestionCard — 引擎提问卡（dsh ask_user_question 工具）
 *
 * 引擎需要用户确认/选择时暂停，这里渲染问题 + 选项 + 补充输入；
 * 提交后经 question/resolve 回传引擎，agent 循环继续。
 */
import { useState } from "react";
import { HelpCircle, Send } from "lucide-react";
import type { PendingQuestionBatch } from "@/store/user-questions";
import { answerUserQuestion } from "@/store/user-questions";

export function UserQuestionCard({ batch }: { batch: PendingQuestionBatch }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (qid: string, label: string, multi: boolean) => {
    setSelected((prev) => {
      const cur = prev[qid] ?? [];
      if (multi) {
        return { ...prev, [qid]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      }
      return { ...prev, [qid]: [label] };
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const answers = batch.questions.map((q) => ({
      id: q.id,
      selected: selected[q.id] ?? [],
      ...(custom[q.id]?.trim() ? { custom: custom[q.id].trim() } : {}),
    }));
    const ok = await answerUserQuestion(batch.rpcId, answers);
    setBusy(false);
    if (!ok) setError("提交失败，请重试");
  };

  const allAnswered = batch.questions.every(
    (q) => (selected[q.id]?.length ?? 0) > 0 || Boolean(custom[q.id]?.trim()),
  );

  return (
    <div className="rounded-xl border border-[#6366F1]/20 bg-[#6366F1]/5 p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-[#6366F1]">
        <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
        引擎需要你的确认
      </div>
      <div className="mt-2 space-y-3">
        {batch.questions.map((q) => (
          <div key={q.id}>
            {q.header && <div className="text-[11px] font-semibold text-muted-foreground">{q.header}</div>}
            <div className="mt-0.5 text-body-sm font-medium text-[#303030]">{q.question}</div>
            {q.detail && <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{q.detail}</div>}
            {q.options && q.options.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const active = (selected[q.id] ?? []).includes(opt.label);
                  return (
                    <button
                      key={opt.label}
                      onClick={() => toggle(q.id, opt.label, q.multiSelect ?? false)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                        active
                          ? "border-[#6366F1] bg-[#6366F1] text-white"
                          : "border-black/10 bg-white text-[#464646] hover:border-[#6366F1]/40"
                      }`}
                      title={opt.description}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              value={custom[q.id] ?? ""}
              onChange={(e) => setCustom((prev) => ({ ...prev, [q.id]: e.target.value }))}
              placeholder="补充说明（可选）…"
              className="mt-1.5 w-full resize-none rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#6366F1]/20"
              rows={2}
            />
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-[11px] text-[#EF4444]">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !allAnswered}
          className="flex items-center gap-1.5 rounded-lg bg-[#6366F1] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-3 w-3" strokeWidth={2} />
          {busy ? "提交中…" : "提交回答"}
        </button>
      </div>
    </div>
  );
}
