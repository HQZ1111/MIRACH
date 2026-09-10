/**
 * MessagingOverlay — 通讯（IM 渠道）
 *
 * 旧版是**假清单**：30 个平台写死、状态写死（Telegram 显示 connected）、密钥字段写死 ——
 * 用户明确要求"通讯图标用社区的 im 插件，现在是假的"。现在改为真实面：
 *
 *   引擎侧 `dsh-im`（统一 IM 桥核心：会话映射 / 命令 / 通知总线 / 审批流）
 *   + 渠道适配器插件（dsh-im-feishu / dsh-im-telegram / dsh-im-wecom / dsh-im-weixin）
 *
 * 本面板只做三件事，全部取自引擎真状态（plugins.list / config.pluginEntries）：
 *   1. 装没装（一键安装，走 sidecar 事务安装：装完写 dsh.profile.bundles）
 *   2. 激没激活（bundles 里有没有 → 未激活要重启应用才生效）
 *   3. 引导到插件自己的设置分区（渠道凭据由插件自己管，mirach 不代管密钥）
 *
 * 旧版存档：MessagingOverlay.tsx.old-fake（假数据仅供对照，不要再改它）。
 */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Download, MessageSquare, RefreshCw } from "lucide-react";
import { getApi } from "@/lib/api";
import type { InstalledPluginInfo } from "@/lib/api/client";

/** IM 桥核心 + 官方渠道适配器（dsh-im 插件家族） */
const IM_CORE = "dsh-im";
const IM_CHANNELS: { pkg: string; label: string; hint: string }[] = [
  { pkg: "dsh-im-weixin", label: "微信", hint: "腾讯 iLink 个人微信机器人（扫码绑定）" },
  { pkg: "dsh-im-wecom", label: "企业微信", hint: "企业微信自建应用渠道" },
  { pkg: "dsh-im-feishu", label: "飞书", hint: "飞书长连接（需自建应用凭据）" },
  { pkg: "dsh-im-telegram", label: "Telegram", hint: "Bot API 轮询，免公网" },
];

type Row = {
  pkg: string;
  label?: string;
  hint?: string;
  installed: boolean;
  active: boolean;
  version?: string;
};

export function MessagingOverlay({ onOpenPlugins }: { onOpenPlugins?: (pkg?: string) => void }) {
  const [installed, setInstalled] = useState<InstalledPluginInfo[] | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const refresh = useCallback(() => {
    void getApi()
      .listCommunityPlugins()
      .then((list) => setInstalled(list ?? []))
      .catch(() => setInstalled([]));
    void getApi()
      .listEnginePlugins()
      .then((list) => {
        const names = new Set<string>();
        for (const e of list ?? []) {
          names.add(e.id);
          names.add(e.name);
        }
        setActive(names);
      })
      .catch(() => setActive(new Set()));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const rowFor = (pkg: string, label?: string, hint?: string): Row => {
    const hit = installed?.find((p) => p.name === pkg);
    return {
      pkg,
      label,
      hint,
      installed: !!hit,
      active: [...active].some((a) => a === pkg || a.includes(pkg)),
      version: hit?.version,
    };
  };

  const doInstall = async (pkg: string) => {
    setBusy(pkg);
    setLogs([`安装 ${pkg} …`]);
    try {
      const lines = await getApi().installCommunityPlugin(pkg);
      setLogs(lines);
      refresh();
    } catch (e) {
      setLogs((l) => [...l, "失败：" + String(e)]);
    } finally {
      setBusy(null);
    }
  };

  const rows =
    installed === null
      ? null
      : [rowFor(IM_CORE, "IM 桥核心"), ...IM_CHANNELS.map((c) => rowFor(c.pkg, c.label, c.hint))];
  const coreActive = rows?.[0]?.active ?? false;
  const channelCount = rows ? rows.slice(1).filter((r) => r.installed).length : 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* 状态头：桥核心是否激活 —— 全真值，没有假 connected */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <div className="min-w-0 flex-1 text-[12px] leading-snug text-[#303030]">
          {rows === null ? (
            "正在读取引擎插件状态…"
          ) : coreActive ? (
            <>
              <b>IM 桥已激活</b>：渠道消息按会话映射进引擎，审批/通知走同一条总线
              {channelCount > 0 ? `（已装 ${channelCount} 个渠道）` : "（还没有渠道，先装一个）"}
            </>
          ) : (
            <>
              <b>IM 桥未激活</b>：装好 {IM_CORE} 后需<b>重启应用</b>，引擎装配才会带上它
            </>
          )}
        </div>
        <button
          onClick={refresh}
          title="重新读取"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        {onOpenPlugins && (
          <button
            onClick={() => onOpenPlugins(IM_CORE)}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] text-[#303030] transition-colors hover:bg-muted"
          >
            插件管理器
          </button>
        )}
      </div>

      {/* 桥核心 + 渠道适配器 */}
      <div className="space-y-1.5">
        {rows === null ? (
          <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">正在读取…</p>
        ) : (
          rows.map((r) => (
            <div key={r.pkg} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[#464646]">
                {r.installed ? (
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <AlertCircle className="h-4 w-4" strokeWidth={2} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-medium text-[#303030]">
                  {r.label ? `${r.label}（${r.pkg}）` : r.pkg}
                  {r.version && (
                    <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                      {r.version}
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {r.hint ? `${r.hint} · ` : ""}
                  {!r.installed ? "未安装" : r.active ? "已激活" : "已安装但未激活（重启应用生效）"}
                </p>
              </div>
              {!r.installed ? (
                <button
                  onClick={() => void doInstall(r.pkg)}
                  disabled={busy !== null}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Download className="h-3 w-3" strokeWidth={2} />
                  {busy === r.pkg ? "安装中…" : "安装"}
                </button>
              ) : (
                <button
                  onClick={() => onOpenPlugins?.(r.pkg)}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] text-[#303030] transition-colors hover:bg-muted"
                >
                  设置
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {logs.length > 0 && (
        <pre className="max-h-40 shrink-0 overflow-auto rounded-md bg-[#303030] p-2 text-[11px] leading-relaxed text-white/90">
          {logs.join("\n")}
        </pre>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        渠道凭据（bot token / 应用密钥 / 扫码绑定）由<b>插件自己的设置分区</b>接管，mirach 不代管密钥。
        安装与激活都走 sidecar 的官方装配路径写入 <span className="font-mono">dsh.profile.bundles</span>，
        重启应用生效；装配失败会自动回滚清单。
      </p>
    </div>
  );
}
