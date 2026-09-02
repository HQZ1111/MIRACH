/**
 * SubagentBackendsSection — 外部子代理后端管理（设置页官方槽位条目）
 *
 * Codex / Claude Code 两个官方后端的安装状态、一键启用/停用（官方 CLI）、
 * 以及"无登录"鉴权配置：API Key / Base URL / 模型名存
 * <用户>/.mirach/subagent-backends.json，sidecar 在引擎 spawn 时组装成
 * CODEX_ENV / CLAUDE_ENV 注入（profile patch !!js 读取）。
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { userHomeDir } from "@/lib/paths";
import { SubHeading } from "@/components/overlays/SettingsOverlay";
import { cn } from "@/lib/utils";

interface BackendStatus {
  installed: boolean;
  version: string | null;
  payloadOk: boolean;
}

interface BackendAuth {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface StatusPayload {
  codex: BackendStatus;
  claude: BackendStatus;
  config: { codex?: BackendAuth; claude?: BackendAuth };
}

type Kind = "codex" | "claude";

const META: Record<Kind, { name: string; desc: string; keyLabel: string; urlLabel: string }> = {
  codex: {
    name: "Codex",
    desc: "OpenAI Codex（官方 app-server 协议）。模型走你的 Codex/OpenAI 兼容端点；填 Base URL 可指向第三方 OpenAI 兼容路由。",
    keyLabel: "OPENAI_API_KEY",
    urlLabel: "Base URL（可选，默认官方）",
  },
  claude: {
    name: "Claude Code",
    desc: "Anthropic Claude Code（官方 Agent SDK）。填 Anthropic 兼容端点的令牌与 Base URL 即可免登录（GLM/DeepSeek 等均有兼容入口）。",
    keyLabel: "ANTHROPIC_AUTH_TOKEN",
    urlLabel: "ANTHROPIC_BASE_URL",
  },
};

function configPath(home: string): string {
  return `${home}\\.mirach\\subagent-backends.json`;
}

export function SubagentBackendsSection() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [home, setHome] = useState("");
  const [draft, setDraft] = useState<{ codex: BackendAuth; claude: BackendAuth }>({ codex: {}, claude: {} });
  const [busy, setBusy] = useState<Kind | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      const s = await invoke<StatusPayload>("dsh_rpc", { method: "subagent.status", params: null });
      setStatus(s);
      // 配置里读回的 enabled 只作"该后端是否处于启用态"信号，不进入鉴权草稿
      const toAuth = (a?: BackendAuth & { enabled?: boolean }): BackendAuth => {
        const { enabled: _enabled, ...rest } = a ?? {};
        return rest;
      };
      setDraft({ codex: toAuth(s.config.codex), claude: toAuth(s.config.claude) });
    } catch (e) {
      setNote("状态读取失败：" + String(e).slice(0, 80));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try { setHome((await userHomeDir()) ?? ""); } catch { setHome(""); }
      await load();
    })();
  }, [load]);

  const saveConfig = useCallback(async (next: { codex: BackendAuth; claude: BackendAuth }): Promise<void> => {
    const body = JSON.stringify({
      codex: { enabled: status?.codex.installed ?? false, ...next.codex },
      claude: { enabled: status?.claude.installed ?? false, ...next.claude },
    }, null, 2);
    await invoke("write_user_file", { path: configPath(home), content: body });
  }, [home, status]);

  const toggle = useCallback(async (kind: Kind): Promise<void> => {
    const enabling = !(status?.[kind].installed);
    setBusy(kind);
    setLogs([]);
    try {
      // 先保存当前表单（启用前带上的 key/base 一并生效）
      await saveConfig(draft);
      const r = await invoke<{ logs: string[] }>("dsh_rpc", {
        method: enabling ? "subagent.enable" : "subagent.disable",
        params: { kind },
      });
      setLogs(r.logs ?? []);
      await load();
      setNote(`${META[kind].name} ${enabling ? "已启用" : "已停用"} —— 重启应用生效`);
    } catch (e) {
      setNote(String(e).slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [draft, load, saveConfig, status]);

  const save = useCallback(async (kind: Kind): Promise<void> => {
    setBusy(kind);
    try {
      // saveConfig 已把 enabled 固定为"当前安装态"——停用后保存不会重新启用
      await saveConfig({ ...draft, [kind]: draft[kind] });
      setNote(`${META[kind].name} 鉴权配置已保存 —— 重启应用生效`);
    } catch (e) {
      setNote(String(e).slice(0, 120));
    } finally {
      setBusy(null);
    }
  }, [draft, saveConfig]);

  const row = (kind: Kind) => {
    const st = status?.[kind];
    const auth = draft[kind] ?? {};
    const meta = META[kind];
    return (
      <div key={kind} className="rounded-lg border border-border bg-white p-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[#303030]">{meta.name}</span>
          {st?.installed ? (
            <span className="rounded bg-[#10B981]/12 px-1.5 py-0.5 text-[10px] font-medium text-[#0B7A50]">
              已装 {st.version ?? ""}
              {!st.payloadOk && <span className="ml-1 text-[#B45309]">（负载缺失，重新启用可补齐）</span>}
            </span>
          ) : (
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">未安装</span>
          )}
          <button
            onClick={() => void toggle(kind)}
            disabled={busy !== null}
            className={cn(
              "ml-auto rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              st?.installed
                ? "border border-border text-[#464646] hover:bg-muted"
                : "bg-[#017CF3] text-white hover:bg-[#017CF3]/90",
            )}
          >
            {busy === kind ? "处理中…" : st?.installed ? "停用" : "启用"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{meta.desc}</p>
        {st?.installed && (
          <div className="mt-2 space-y-1.5">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-[#303030]">{meta.keyLabel}</span>
              <input
                type="password"
                value={auth.apiKey ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [kind]: { ...d[kind], apiKey: e.target.value } }))}
                placeholder="sk-…"
                className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-[#303030] outline-none focus:border-[#6366F1]"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-[#303030]">{meta.urlLabel}</span>
              <input
                value={auth.baseUrl ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [kind]: { ...d[kind], baseUrl: e.target.value } }))}
                placeholder="https://…（兼容端点；Codex 留空=官方）"
                className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-[#303030] outline-none focus:border-[#6366F1]"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-[#303030]">模型（可选，固定子代理模型）</span>
              <input
                value={auth.model ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [kind]: { ...d[kind], model: e.target.value } }))}
                placeholder="留空 = 各自原生默认"
                className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-[#303030] outline-none focus:border-[#6366F1]"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              {note && <span className="text-[11px] text-[#10B981]">{note}</span>}
              <button
                onClick={() => void save(kind)}
                disabled={busy !== null}
                className="rounded-md bg-[#017CF3] px-3 py-1 text-xs text-white transition-colors hover:bg-[#017CF3]/90 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <SubHeading>子代理后端</SubHeading>
      <p className="px-5 pb-2 text-[11px] leading-relaxed text-muted-foreground">
        外部编码代理作为子代理接入：父 agent 对话中直接委派（工具名 <span className="font-mono">codex</span> /{" "}
        <span className="font-mono">claude-code</span>）。"启用"把后端装入引擎 profile（运行时可独立移除，随时可卸
        载重装）；鉴权用下面填的 key（免官方登录），保存后重启应用生效。
      </p>
      <div className="space-y-2.5 px-5 pb-4">
        {row("codex")}
        {row("claude")}
        {logs.length > 0 && (
          <pre className="max-h-40 overflow-y-auto rounded-md bg-black/90 p-2.5 text-[10px] leading-relaxed text-[#D1FAE5]">
            {logs.join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
