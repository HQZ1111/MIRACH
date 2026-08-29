/**
 * MessagingOverlay — 消息平台面板（按原型 Messaging 精确复刻）
 *
 * 平台列表（Telegram/Discord/Slack/Mattermost/Matrix/WhatsApp/Signal/…30 个）
 * + 凭据详情（Required/Recommended/Advanced 三组字段，字段与原型一致）
 * + 状态类型（connected/connecting/retrying/disabled/fatal/startup_failed/
 *   not_configured/pending_restart/gateway_stopped）
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ExternalLink, Save, Search, Trash2 } from "lucide-react";

type PlatformStatus =
  | "connected" | "connecting" | "retrying" | "disabled" | "fatal"
  | "startup_failed" | "not_configured" | "pending_restart" | "gateway_stopped";

interface Cred {
  group: "required" | "recommended" | "advanced";
  key: string;
  label: string;
  isPassword?: boolean;
  isSet?: boolean;
  hint?: string;
}

interface Platform {
  id: string;
  name: string;
  initials: string;
  color: string;
  desc: string;
  status: PlatformStatus;
  creds: Cred[];
}

const STATUS_META: Record<PlatformStatus, { label: string; dot: string; pill: string }> = {
  connected: { label: "Connected", dot: "bg-[#10B981]", pill: "bg-emerald-50 text-[#059669]" },
  connecting: { label: "Connecting", dot: "bg-[#F59E0B]", pill: "bg-amber-50 text-[#D97706]" },
  retrying: { label: "Retrying", dot: "bg-[#F59E0B]", pill: "bg-amber-50 text-[#D97706]" },
  disabled: { label: "Disabled", dot: "bg-[#9CA3AF]", pill: "bg-muted text-[#6B7280]" },
  fatal: { label: "Error", dot: "bg-[#EF4444]", pill: "bg-red-50 text-[#EF4444]" },
  startup_failed: { label: "Startup failed", dot: "bg-[#EF4444]", pill: "bg-red-50 text-[#EF4444]" },
  not_configured: { label: "Needs setup", dot: "bg-[#F59E0B]", pill: "bg-amber-50 text-[#D97706]" },
  pending_restart: { label: "Restart needed", dot: "bg-[#F59E0B]", pill: "bg-amber-50 text-[#D97706]" },
  gateway_stopped: { label: "Messaging gateway stopped", dot: "bg-[#F59E0B]", pill: "bg-amber-50 text-[#D97706]" },
};

// 分组标签走 i18n：messaging.required / recommended / advanced

const PLATFORMS: Platform[] = [
  {
    id: "telegram", name: "Telegram", initials: "T", color: "#26A5E4",
    desc: "Run Mirach from Telegram DMs, groups, and topics.", status: "connected",
    creds: [
      { group: "required", key: "TELEGRAM_BOT_TOKEN", label: "Bot token", isPassword: true, isSet: true },
      { group: "recommended", key: "TELEGRAM_ALLOWED_USERS", label: "Allowed Telegram user IDs" },
      { group: "advanced", key: "TELEGRAM_PROXY", label: "Proxy URL" },
    ],
  },
  {
    id: "discord", name: "Discord", initials: "D", color: "#5865F2",
    desc: "Connect Mirach to Discord DMs, channels, and threads.", status: "disabled",
    creds: [
      { group: "required", key: "DISCORD_BOT_TOKEN", label: "Bot token", isPassword: true },
      { group: "recommended", key: "DISCORD_ALLOWED_USERS", label: "Allowed Discord user IDs" },
    ],
  },
  {
    id: "slack", name: "Slack", initials: "S", color: "#4A154B",
    desc: "Use Mirach from Slack via Socket Mode for bots and apps.", status: "not_configured",
    creds: [
      { group: "required", key: "SLACK_BOT_TOKEN", label: "Slack bot token", isPassword: true },
      { group: "required", key: "SLACK_APP_TOKEN", label: "Slack app token", isPassword: true },
      { group: "recommended", key: "SLACK_ALLOWED_USERS", label: "Allowed Slack user IDs" },
    ],
  },
  {
    id: "mattermost", name: "Mattermost", initials: "M", color: "#0058CC",
    desc: "Connect Mirach to Mattermost channels and direct messages.", status: "disabled",
    creds: [
      { group: "required", key: "MATTERMOST_URL", label: "Server URL" },
      { group: "required", key: "MATTERMOST_TOKEN", label: "Bot token", isPassword: true },
      { group: "recommended", key: "MATTERMOST_ALLOWED_USERS", label: "Allowed user IDs" },
      { group: "recommended", key: "MATTERMOST_REQUIRE_MENTION", label: "Require @mention in channels" },
      { group: "recommended", key: "MATTERMOST_FREE_RESPONSE_CHANNELS", label: "Free-response channel IDs (comma-separated)" },
    ],
  },
  {
    id: "matrix", name: "Matrix", initials: "Mx", color: "#000000",
    desc: "Use Mirach in Matrix rooms and direct messages.", status: "disabled",
    creds: [
      { group: "required", key: "MATRIX_HOMESERVER", label: "Homeserver URL" },
      { group: "required", key: "MATRIX_ACCESS_TOKEN", label: "Access token", isPassword: true },
      { group: "required", key: "MATRIX_USER_ID", label: "Bot user ID" },
      { group: "recommended", key: "MATRIX_ALLOWED_USERS", label: "Allowed Matrix user IDs" },
      { group: "advanced", key: "MATRIX_REQUIRE_MENTION", label: "Require @mention" },
      { group: "advanced", key: "MATRIX_AUTO_THREAD", label: "Auto-thread" },
      { group: "advanced", key: "MATRIX_DEVICE_ID", label: "Device ID" },
      { group: "advanced", key: "MATRIX_RECOVERY_KEY", label: "Recovery key", isPassword: true },
    ],
  },
  {
    id: "whatsapp", name: "WhatsApp", initials: "W", color: "#25D366",
    desc: "Use Mirach through the bundled WhatsApp bridge with QR-based auth.", status: "not_configured",
    creds: [
      { group: "recommended", key: "WHATSAPP_ALLOWED_USERS", label: "Allowed WhatsApp users" },
      { group: "advanced", key: "WHATSAPP_ENABLED", label: "Enable WhatsApp bridge" },
      { group: "advanced", key: "WHATSAPP_MODE", label: "Bridge mode" },
      { group: "advanced", key: "WHATSAPP_DM_POLICY", label: "DM policy" },
    ],
  },
  {
    id: "signal", name: "Signal", initials: "Sg", color: "#3A76F0",
    desc: "Connect through a signal-cli REST bridge.", status: "disabled",
    creds: [
      { group: "required", key: "SIGNAL_HTTP_URL", label: "Signal bridge URL" },
      { group: "required", key: "SIGNAL_ACCOUNT", label: "Phone number" },
      { group: "recommended", key: "SIGNAL_ALLOWED_USERS", label: "Allowed Signal users" },
    ],
  },
  {
    id: "bluebubbles", name: "BlueBubbles (iMessage)", initials: "B", color: "#0BD318",
    desc: "Use Mirach through iMessage via a BlueBubbles server.", status: "disabled",
    creds: [
      { group: "required", key: "BLUEBUBBLES_SERVER_URL", label: "Server URL" },
      { group: "required", key: "BLUEBUBBLES_PASSWORD", label: "Password", isPassword: true },
      { group: "recommended", key: "BLUEBUBBLES_ALLOWED_USERS", label: "Allowed iMessage addresses" },
      { group: "advanced", key: "BLUEBUBBLES_ALLOW_ALL_USERS", label: "Allow all iMessage users" },
    ],
  },
  {
    id: "homeassistant", name: "Home Assistant", initials: "H", color: "#18BCF2",
    desc: "Control your smart home from Mirach via Home Assistant.", status: "disabled",
    creds: [
      { group: "required", key: "HASS_URL", label: "Home Assistant URL" },
      { group: "required", key: "HASS_TOKEN", label: "Home Assistant access token", isPassword: true },
    ],
  },
  {
    id: "email", name: "Email", initials: "E", color: "#EA4335",
    desc: "Talk to Mirach through an IMAP/SMTP mailbox.", status: "connected",
    creds: [
      { group: "required", key: "EMAIL_ADDRESS", label: "Email address", isSet: true },
      { group: "required", key: "EMAIL_PASSWORD", label: "Password", isPassword: true, isSet: true },
      { group: "required", key: "EMAIL_IMAP_HOST", label: "IMAP host", isSet: true },
      { group: "required", key: "EMAIL_SMTP_HOST", label: "SMTP host", isSet: true },
    ],
  },
  {
    id: "sms", name: "SMS (Twilio)", initials: "SMS", color: "#F43F5E",
    desc: "Send and receive text messages via Twilio.", status: "disabled",
    creds: [
      { group: "required", key: "TWILIO_ACCOUNT_SID", label: "Account SID" },
      { group: "required", key: "TWILIO_AUTH_TOKEN", label: "Auth token", isPassword: true },
    ],
  },
  {
    id: "dingtalk", name: "DingTalk", initials: "D", color: "#4A90D9",
    desc: "Connect Mirach to DingTalk groups (钉钉).", status: "disabled",
    creds: [
      { group: "required", key: "DINGTALK_CLIENT_ID", label: "Client ID" },
      { group: "required", key: "DINGTALK_CLIENT_SECRET", label: "Client secret", isPassword: true },
    ],
  },
  {
    id: "feishu", name: "Feishu / Lark", initials: "F", color: "#3370FF",
    desc: "Use Mirach inside Feishu / Lark.", status: "disabled",
    creds: [
      { group: "required", key: "FEISHU_APP_ID", label: "App ID" },
      { group: "required", key: "FEISHU_APP_SECRET", label: "App secret", isPassword: true },
      { group: "recommended", key: "FEISHU_ENCRYPT_KEY", label: "Encrypt key" },
      { group: "recommended", key: "FEISHU_VERIFICATION_TOKEN", label: "Verification token" },
    ],
  },
  {
    id: "google_chat", name: "Google Chat", initials: "G", color: "#00897B",
    desc: "Connect Mirach to Google Chat via Cloud Pub/Sub.", status: "disabled",
    creds: [
      { group: "required", key: "GOOGLE_CHAT_SERVICE_ACCOUNT", label: "Service account JSON" },
      { group: "required", key: "GOOGLE_CHAT_SPACE_ID", label: "Space ID" },
    ],
  },
  {
    id: "wecom", name: "WeCom (group bot)", initials: "企", color: "#0082EF",
    desc: "Send-only WeCom group bot via webhook.", status: "disabled",
    creds: [
      { group: "required", key: "WECOM_BOT_ID", label: "WeCom Bot ID" },
      { group: "recommended", key: "WECOM_SECRET", label: "WeCom Secret", isPassword: true },
    ],
  },
  {
    id: "wecom_callback", name: "WeCom (app)", initials: "企", color: "#0082EF",
    desc: "Two-way WeCom integration via callback app.", status: "disabled",
    creds: [
      { group: "required", key: "WECOM_CALLBACK_CORP_ID", label: "Corp ID" },
      { group: "required", key: "WECOM_CALLBACK_CORP_SECRET", label: "Corp secret", isPassword: true },
      { group: "required", key: "WECOM_CALLBACK_AGENT_ID", label: "Agent ID" },
      { group: "recommended", key: "WECOM_CALLBACK_TOKEN", label: "Callback token" },
      { group: "recommended", key: "WECOM_CALLBACK_ENCODING_AES_KEY", label: "Encoding AES key", isPassword: true },
    ],
  },
  {
    id: "weixin", name: "Weixin / WeChat (Personal)", initials: "微", color: "#07C160",
    desc: "Connect a personal WeChat account through Tencent's iLink Bot API.", status: "not_configured",
    creds: [
      { group: "required", key: "WEIXIN_ACCOUNT_ID", label: "iLink Bot account ID" },
      { group: "required", key: "WEIXIN_TOKEN", label: "Token", isPassword: true },
      { group: "recommended", key: "WEIXIN_BASE_URL", label: "iLink API base URL" },
    ],
  },
  {
    id: "qqbot", name: "QQ Bot", initials: "Q", color: "#EB1923",
    desc: "Connect Mirach to a QQ Bot from the QQ Open Platform.", status: "disabled",
    creds: [
      { group: "required", key: "QQ_APP_ID", label: "QQ App ID" },
      { group: "required", key: "QQ_CLIENT_SECRET", label: "QQ Client Secret", isPassword: true },
      { group: "recommended", key: "QQ_ALLOWED_USERS", label: "Allowed QQ users" },
      { group: "advanced", key: "QQ_ALLOW_ALL_USERS", label: "Allow all QQ users" },
    ],
  },
  {
    id: "yuanbao", name: "Yuanbao (元宝)", initials: "元", color: "#FB7299",
    desc: "Connect Mirach to Tencent Yuanbao.", status: "disabled",
    creds: [
      { group: "required", key: "YUANBAO_APP_ID", label: "App ID" },
      { group: "required", key: "YUANBAO_APP_SECRET", label: "App secret", isPassword: true },
    ],
  },
  {
    id: "api_server", name: "API server", initials: "API", color: "#64748B",
    desc: "Expose Mirach as an OpenAI-compatible HTTP API for other tools.", status: "connected",
    creds: [
      { group: "advanced", key: "API_SERVER_ENABLED", label: "Enabled", isSet: true },
      { group: "advanced", key: "API_SERVER_KEY", label: "API key", isPassword: true, isSet: true },
      { group: "advanced", key: "API_SERVER_PORT", label: "Port", isSet: true },
      { group: "advanced", key: "API_SERVER_HOST", label: "Host" },
      { group: "advanced", key: "API_SERVER_MODEL_NAME", label: "Model name" },
    ],
  },
  {
    id: "webhook", name: "Webhooks", initials: "WH", color: "#71717A",
    desc: "Receive events from GitHub, GitLab, and other webhook sources.", status: "connected",
    creds: [
      { group: "recommended", key: "WEBHOOK_ENABLED", label: "Enabled", isSet: true },
      { group: "recommended", key: "WEBHOOK_PORT", label: "Port", isSet: true },
      { group: "recommended", key: "WEBHOOK_SECRET", label: "Secret", isPassword: true, isSet: true },
    ],
  },
  {
    id: "teams", name: "Microsoft Teams", initials: "T", color: "#6264A7",
    desc: "Connect Mirach to Microsoft Teams.", status: "disabled",
    creds: [
      { group: "required", key: "TEAMS_CLIENT_ID", label: "Client ID" },
      { group: "required", key: "TEAMS_CLIENT_SECRET", label: "Client secret", isPassword: true },
      { group: "required", key: "TEAMS_TENANT_ID", label: "Tenant ID" },
    ],
  },
  {
    id: "ntfy", name: "ntfy", initials: "N", color: "#16A34A",
    desc: "Send notifications to ntfy topics.", status: "disabled",
    creds: [
      { group: "required", key: "NTFY_TOPIC", label: "Topic" },
    ],
  },
  {
    id: "line", name: "LINE", initials: "L", color: "#06C755",
    desc: "Connect Mirach to LINE.", status: "disabled",
    creds: [
      { group: "required", key: "LINE_CHANNEL_ACCESS_TOKEN", label: "Channel access token", isPassword: true },
      { group: "required", key: "LINE_CHANNEL_SECRET", label: "Channel secret", isPassword: true },
    ],
  },
  {
    id: "simplex", name: "SimpleX Chat", initials: "S", color: "#6B7280",
    desc: "Connect Mirach to SimpleX Chat.", status: "disabled",
    creds: [
      { group: "required", key: "SIMPLEX_WS_URL", label: "WebSocket URL" },
    ],
  },
  {
    id: "irc", name: "IRC", initials: "I", color: "#6B7280",
    desc: "Connect Mirach to IRC channels.", status: "disabled",
    creds: [
      { group: "required", key: "IRC_SERVER", label: "IRC server" },
      { group: "required", key: "IRC_CHANNEL", label: "IRC channel" },
      { group: "required", key: "IRC_NICKNAME", label: "IRC nickname" },
      { group: "recommended", key: "IRC_ALLOWED_USERS", label: "Allowed users" },
      { group: "advanced", key: "IRC_SERVER_PASSWORD", label: "Server password", isPassword: true },
    ],
  },
];

export function MessagingOverlay() {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(PLATFORMS[0].id);
  const [search, setSearch] = useState("");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    telegram: true, email: true, api_server: true, webhook: true,
  });

  const selected = PLATFORMS.find((p) => p.id === selectedId)!;
  const filtered = PLATFORMS.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));
  const isEnabled = enabled[selected.id] ?? false;

  return (
    <div className="flex h-full">
      {/* 左栏：平台列表 */}
      <div className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="p-3 pb-2">
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("messaging.search")}
              className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
            />
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                selectedId === p.id ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.initials}
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-[#303030]">{p.name}</span>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_META[p.status].dot)} />
            </button>
          ))}
        </div>
      </div>

      {/* 右栏：详情 */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: selected.color }}
            >
              {selected.initials}
            </span>
            <div>
              <h3 className="text-member font-bold text-[#303030]">{selected.name}</h3>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_META[selected.status].pill)}>
                  {STATUS_META[selected.status].label}
                </span>
                {selected.status === "pending_restart" && (
                  <span className="text-[11px] text-muted-foreground">{t("messaging.restartHint")}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-[#464646]">
              {t("messaging.enable")}
              <SwitchButton on={isEnabled} onChange={(v) => setEnabled((e) => ({ ...e, [selected.id]: v }))} />
            </label>
            <button className="flex items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#464646]">
              <Save className="h-3 w-3" strokeWidth={2} />
              {t("messaging.saveChanges")}
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-body-sm leading-relaxed text-muted-foreground">{selected.desc}</p>

          {/* 凭据区块 */}
          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <p className="text-body-sm font-medium text-[#303030]">{t("messaging.getCredentials")}</p>
              <button className="flex items-center gap-1 text-xs text-[#6366F1] transition-colors hover:underline">
                {t("messaging.openSetupGuide")}
                <ExternalLink className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* 凭据分组 */}
          {(["required", "recommended", "advanced"] as const).map((group) => {
            const creds = selected.creds.filter((c) => c.group === group);
            if (creds.length === 0) return null;
            return (
              <div key={group} className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`messaging.${group}`)}
                  {group === "advanced" && ` (${creds.length})`}
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {creds.map((c) => (
                    <div key={c.key} className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-body-sm text-[#303030]">{c.label}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">{c.key}</p>
                      </div>
                      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                        <input
                          type={c.isPassword ? "password" : "text"}
                          defaultValue={c.isSet ? (c.isPassword ? "••••••••" : "saved value") : ""}
                          placeholder={c.isSet ? t("messaging.replaceCurrent") : "Not set"}
                          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-white px-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
                        />
                        {c.isSet && (
                          <button title="Clear" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#EF4444]">
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SwitchButton({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "flex h-[18px] w-8 items-center rounded-full px-[2px] transition-colors",
        on ? "justify-end bg-[#303030]" : "justify-start bg-[#D1D5DB]",
      )}
    >
      <span className="h-[14px] w-[14px] rounded-full bg-white shadow-sm" />
    </button>
  );
}
