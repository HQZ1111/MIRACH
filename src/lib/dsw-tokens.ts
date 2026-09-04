/**
 * dsw-tokens — 官方 dsw alias 令牌（浅色值）
 *
 * 官方 client 组件的 CSS（ModelSelect/官方设置面板/酒馆面板…）依赖
 * --dsw-alias-* 色板变量；mirach 宿主容器挂上这组变量即完成 ui 转换。
 * 原导出点在 settings/AgentTeam.tsx（保留 re-export 兼容）。
 */

import type React from "react";

/** 官方 dsw alias 令牌 → mirach 浅色值（原生面板样式依赖） */
export const DSW_ALIAS_VARS = {
  "--dsw-alias-label-primary": "#303030",
  "--dsw-alias-label-secondary": "#6B7280",
  "--dsw-alias-label-caption": "#8B8C8F",
  "--dsw-alias-label-tertiary": "#8B8C8F",
  "--dsw-alias-border-l1": "#E5E7EB",
  "--dsw-alias-border-l2": "#E5E7EB",
  "--dsw-alias-border-default": "#D1D5DB",
  "--dsw-alias-bg-base": "#FFFFFF",
  "--dsw-alias-bg-layer-1": "#FFFFFF",
  "--dsw-alias-bg-layer-2": "#F5F6F8",
  "--dsw-alias-bg-mask-1": "rgba(0, 0, 0, 0.24)",
  "--dsw-mask-blur": "blur(2px)",
  "--dsw-shadow-lv3": "0 0 1px 0 rgba(0, 0, 0, 0.2), 0 0 4px 0 rgba(0, 0, 0, 0.02), 0 12px 32px 0 rgba(0, 0, 0, 0.08)",
  "--dsw-alias-brand-primary": "#017CF3",
  "--dsw-alias-state-business-primary": "#017CF3",
  "--dsw-alias-state-error-primary": "#EF4444",
  "--dsw-alias-state-success-primary": "#10B981",
  "--dsw-font-base": '13px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif',
} as React.CSSProperties;
