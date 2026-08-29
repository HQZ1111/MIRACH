/**
 * ProfileBuilderWizard — 档案构建向导（对齐原型 web/src/pages/ProfileBuilderPage.tsx）
 *
 * 5 步 Stepper：身份（名称+描述）→ 模型（提供方·模型，含"继承克隆/默认"）→
 * 技能（本地技能池勾选）→ MCP（本地服务器开关）→ 确认汇总。
 * 数据为本地勾选/输入，完成后通过 onCreate 回传给档案页加入列表。
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

// 提供方·模型选项（对齐原型模型选择器，改模型下拉与本向导共用）
export const MODEL_OPTIONS = [
  { provider: "Z.AI", model: "glm-5p2" },
  { provider: "Moonshot", model: "kimi-k2p6" },
  { provider: "Anthropic", model: "claude-3.5-sonnet" },
  { provider: "OpenAI", model: "gpt-4o" },
];

const PROVIDERS = [...new Set(MODEL_OPTIONS.map((m) => m.provider))];

// 技能池（对齐原型 Skills step 的复选来源）
const SKILL_POOL = [
  { name: "search_files", category: "编码", desc: "按名称/内容/正则搜索项目文件" },
  { name: "edit_file", category: "编码", desc: "在工作区精确编辑文件" },
  { name: "apply_diff", category: "编码", desc: "应用差异补丁" },
  { name: "web_browse", category: "浏览", desc: "浏览网页并提取结构化内容" },
  { name: "terminal", category: "系统", desc: "在持久终端中运行 shell 命令" },
  { name: "doc_summarize", category: "办公", desc: "总结文档与长文本" },
  { name: "email_write", category: "办公", desc: "从简短笔记起草润色邮件" },
];

// MCP 服务器池（对齐原型 MCP step 的开关）
const MCP_POOL = [
  { name: "filesystem", desc: "本地文件系统访问" },
  { name: "fetch", desc: "HTTP 抓取工具" },
  { name: "github", desc: "GitHub 集成" },
];

const STEPS = ["身份", "模型", "技能", "MCP", "确认"];

export interface ProfileBuilderResult {
  name: string;
  description: string;
  provider: string;
  model: string;
  skills: string[];
  mcpServers: string[];
}

interface ProfileBuilderWizardProps {
  open: boolean;
  onClose: () => void;
  /** 克隆来源档案（模型继承用） */
  cloneOptions: { id: string; name: string; provider: string; model: string }[];
  onCreate: (result: ProfileBuilderResult) => void;
}

export function ProfileBuilderWizard({ open, onClose, cloneOptions, onCreate }: ProfileBuilderWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cloneId, setCloneId] = useState("");
  const [provider, setProvider] = useState("(inherit)");
  const [model, setModel] = useState("(inherit)");
  const [skills, setSkills] = useState<string[]>([]);
  const [mcp, setMcp] = useState<string[]>([]);

  // 打开时重置表单
  useEffect(() => {
    if (open) {
      setStep(0);
      setName("");
      setDescription("");
      setCloneId(cloneOptions[0]?.id ?? "");
      setProvider("(inherit)");
      setModel("(inherit)");
      setSkills([]);
      setMcp([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const base = cloneOptions.find((c) => c.id === cloneId);
  const inherit = provider === "(inherit)" || model === "(inherit)";
  const finalProvider = inherit ? (base?.provider ?? "OpenAI") : provider;
  const finalModel = inherit ? (base?.model ?? "gpt-4o") : model;
  const modelsForProvider =
    provider === "(inherit)" ? [] : MODEL_OPTIONS.filter((m) => m.provider === provider).map((m) => m.model);

  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const canNext = step !== 0 || name.trim().length > 0;

  const handleCreate = () => {
    onCreate({
      name: name.trim(),
      description: description.trim(),
      provider: finalProvider,
      model: finalModel,
      skills,
      mcpServers: mcp,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
      <div className="panel-glass popup-anim relative flex w-[560px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-2xl">
        {/* 标题 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <span className="text-body-sm font-bold text-[#303030]">构建档案</span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>

        {/* 步骤指示 */}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-5 py-2.5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex shrink-0 items-center gap-1">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
                  i < step
                    ? "bg-[#10B981] text-white"
                    : i === step
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-xs", i === step ? "font-medium text-[#303030]" : "text-muted-foreground")}>
                {s}
              </span>
              {i < STEPS.length - 1 && <div className="mx-1 h-px w-5 bg-border" />}
            </div>
          ))}
        </div>

        {/* 步骤内容 */}
        <div className="min-h-[240px] flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {step === 0 && (
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-[#303030]">名称</p>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="档案名称（如 research）"
                  className="w-full rounded-md border border-border px-2.5 py-1.5 text-body-sm text-[#303030] outline-none focus:border-[#303030]/40"
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[#303030]">描述</p>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="这个档案应当如何工作…"
                  className="w-full resize-none rounded-md border border-border px-2.5 py-1.5 text-body-sm text-[#303030] outline-none focus:border-[#303030]/40"
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[#303030]">克隆自</p>
                <select
                  value={cloneId}
                  onChange={(e) => setCloneId(e.target.value)}
                  className="w-full cursor-pointer rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#464646] outline-none"
                >
                  {cloneOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.model}）
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-[#303030]">提供方</p>
                <select
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value;
                    setProvider(p);
                    setModel(p === "(inherit)" ? "(inherit)" : MODEL_OPTIONS.find((m) => m.provider === p)?.model ?? "");
                  }}
                  className="w-full cursor-pointer rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#464646] outline-none"
                >
                  <option value="(inherit)">继承克隆 / 默认</option>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[#303030]">模型</p>
                {provider === "(inherit)" ? (
                  <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                    将使用克隆来源的模型：{finalProvider} · {finalModel}
                  </p>
                ) : (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full cursor-pointer rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#464646] outline-none"
                  >
                    {modelsForProvider.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-1.5">
              {SKILL_POOL.map((s) => (
                <label
                  key={s.name}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    checked={skills.includes(s.name)}
                    onChange={() => setSkills(toggle(skills, s.name))}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#303030]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-body-sm text-[#303030]">
                      {s.name}
                      <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{s.category}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">{s.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-1.5">
              {MCP_POOL.map((m) => (
                <label
                  key={m.name}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    checked={mcp.includes(m.name)}
                    onChange={() => setMcp(toggle(mcp, m.name))}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#303030]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-body-sm text-[#303030]">{m.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{m.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-2.5">
              {[
                { label: "名称", value: name.trim() },
                { label: "描述", value: description.trim() || "（无）" },
                { label: "模型", value: `${finalProvider} · ${finalModel}` },
                { label: "技能", value: skills.length ? `${skills.length} 项：${skills.join("、")}` : "（无）" },
                { label: "MCP", value: mcp.length ? `${mcp.length} 个：${mcp.join("、")}` : "（无）" },
              ].map((r) => (
                <div key={r.label} className="flex items-start gap-3 text-xs">
                  <span className="w-10 shrink-0 text-muted-foreground">{r.label}</span>
                  <span className="min-w-0 flex-1 text-[#303030]">{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft size={13} /> 上一步
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => canNext && setStep((s) => s + 1)}
              disabled={!canNext}
              className="flex items-center gap-1 rounded-md bg-foreground px-4 py-1.5 text-xs text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一步 <ArrowRight size={13} />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              className="flex items-center gap-1 rounded-md bg-[#6366F1] px-4 py-1.5 text-xs text-white transition-colors hover:bg-[#6366F1]/90"
            >
              <Check size={13} strokeWidth={3} /> 创建档案
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
