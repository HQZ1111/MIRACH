/**
 * plugin-environments — 环境管理插件（可拔插）
 *
 * 职责：
 *   1. 图标库贡献（icon-library 独立注册表，设置页/其他插件复用）；
 *   2. 左栏导航贡献（sidebarNav）：输出 visible 环境的图标按钮组，
 *      点击切换 activeView → MainPanel 串行流水线下发 dsh_set_env；
 *   3. 设置页"环境"分区挂载（SettingsOverlay 渲染 EnvSettingsSection）。
 *
 * 主环境（main，点 Logo 进入）锁定：名称/图标/工作区/可见性/删除全部不可改
 * —— 锁定在 store 层强制（saveEnvironments 回填），插件 UI 层再禁用入口。
 * 拔插：禁用本插件（registry 不注册）→ 左栏环境区消失、引擎对接不受影响
 * （environments store 是核心件，插件只做展示与编辑）。
 */

import { registerPlugin } from "./registry";
import { $environments } from "@/store/environments";

registerPlugin({
  id: "plugin-environments",
  name: "环境管理",
  version: "0.1.0",
  sidebarNav: {
    items: () =>
      $environments
        .get()
        .filter((e) => e.visible !== false)
        .map((e) => ({ id: e.id, iconId: e.icon ?? "lucide:bot", label: e.name })),
    onSelect: (id) => {
      // 切换左栏视图（envIdForView 保证 main/mirach 映射；其余 id 即视图 id）
      window.dispatchEvent(new CustomEvent("mirach:switch-view", { detail: id }));
    },
  },
});
