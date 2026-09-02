/**
 * mirach-sections — mirach 自有设置分区的"官方槽位化"注册
 *
 * 设置页 UI 所有权移交官方后，可见面板 = 官方 SettingsRoot；其导航 =
 * settings.section（list 槽位）的全部条目。本模块把 mirach 的自有分区
 * （对话风格/团队/记忆/归档会话/安全/Git/键位/使用统计/关于）注册成同槽位
 * 条目——官方导航自动混排（按 order），分区内容由官方渲染器用真 kit 渲染。
 *
 * 与酒馆/dsh-pocket 同一机制：外部内容以官方 settings.section 条目形态共存。
 * 组件保持 mirach 实现（nanostores/tauri invoke/mirach i18n 都在同一 React 树）。
 */

import type { Context } from "@deepseek-ai/cordis";
import { logInfo, logWarn } from "./kernel-log";
import {
  GeneralContent,
  MemorySection,
  SessionsContent,
  SafetyContent,
  GitContent,
  KeybindsContent,
  UsageContent,
  AboutContent,
} from "@/components/overlays/SettingsOverlay";
import { EnvSettingsSection } from "@/components/settings/EnvSettingsSection";

interface MirachSectionDef {
  id: string;
  order: number;
  label: string;
  component: (props: Record<string, unknown>) => React.ReactNode;
}

/** 顺序沿用旧导航习惯：mirach 分区在前，官方分区（order≥0）在后 */
const SECTIONS: MirachSectionDef[] = [
  { id: "chat-style", order: -32, label: "通用设置", component: GeneralContent },
  { id: "agents", order: -30, label: "智能体团队", component: EnvSettingsSection },
  { id: "memory", order: -28, label: "记忆", component: MemorySection },
  { id: "sessions", order: -26, label: "归档会话", component: SessionsContent },
  { id: "safety", order: -24, label: "安全", component: SafetyContent },
  { id: "git", order: -22, label: "Git 账户", component: GitContent },
  { id: "keybinds", order: -20, label: "键盘快捷键", component: KeybindsContent },
  { id: "usage", order: -18, label: "使用统计", component: UsageContent },
  { id: "about", order: -16, label: "关于", component: AboutContent },
];

/**
 * 把 mirach 自有分区注册进官方 settings.section（经 slots.inject 等声明落地，
 * 与官方分区包同一机制；重复调用幂等——重复注册会被官方 register 拒绝并告警）。
 */
export function registerMirachSections(ctx: Context): void {
  try {
    const slots = (ctx as unknown as {
      slots?: { inject?: (key: string, cb: () => unknown) => void };
    }).slots;
    if (typeof slots?.inject !== "function") {
      logWarn("mirach sections: slots.inject unavailable");
      return;
    }
    for (const def of SECTIONS) {
      slots.inject("settings.section", () => {
        ctx.slots.register(
          {
            name: "settings.section",
            id: def.id,
            order: def.order,
            label: () => def.label,
          },
          def.component as never,
        );
      });
    }
    logInfo("mirach sections registered: %s", SECTIONS.map((s) => s.id).join(","));
  } catch (err) {
    logWarn("mirach sections registration failed: %s", err instanceof Error ? err.message : String(err));
  }
}
