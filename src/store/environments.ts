/**
 * environments - 工作环境 store（环境隔离，本地持久化）
 *
 * 环境与左栏入口绑定：Logo 点击 = main 主环境（锁定：名称/图标/工作区/
 * 可见性/删除全部不可改）；其余环境可自由增删改/隐藏。
 * 切换环境 = MainPanel 串行下发 dsh_set_env（envId + cwd）→ sidecar 以
 * "<envId>::<会话id>" 做会话映射命名空间 + 引擎工作区 cwd 切换 → 下一条
 * 消息触发 runtime 重启换到新工作区。dsh 会话持久化天然按 cwd 分组
 * （sessionRoot/<cwd编码>/<sessionId>），历史/上下文/文件操作随环境隔离。
 *
 * 环境插件（plugins/plugin-environments）消费本 store：
 * icon（图标库 id）/ visible（左栏展示开关）为插件展示层字段。
 *
 * cwd 为空串表示"跟随系统默认"（sidecar 回退 DSH_CWD 默认值 = 用户主目录）。
 */

import { atom } from "nanostores";
import { MOCK } from "@/lib/mock";

export interface EnvProfile {
  /** 稳定 id（sessionMap 命名空间键的一部分；main 保留为主环境） */
  id: string;
  name: string;
  /** 工作区绝对路径；空串 = 跟随系统默认 */
  cwd: string;
  /** 图标库 id（如 "ph:code"，面性图标库）；旧 "ph:code" 数据按裸名兼容解析 */
  icon?: string;
  /** 左栏是否展示；主环境恒 true */
  visible?: boolean;
  /** 内置环境（main）：名称/图标/工作区/可见性/删除全部锁定 */
  builtIn?: boolean;
}

const STORAGE_KEY = "mirach.environments.v1";

/** 左栏视图 → 环境 id（mirach/hermes 视图即 main 主环境——点 Logo 进入；
 *  其余视图 id 即环境 id；chat 是独立环境，有自己的工作区）。 */
export function envIdForView(view: string): string {
  if (view === "mirach" || view === "hermes") return "main";
  return view;
}

/**
 * 左栏全部可作环境的入口种子（与 LeftToolbar 对齐）。
 * 种子缺失的环境在 load() 时自动补齐。
 */
const VIEW_ENV_SEEDS: EnvProfile[] = [
  { id: "main", name: "主环境", cwd: "", icon: "ph:bot", visible: true, builtIn: true },
  // 聊天环境专属工作区（~ 展开为用户主目录）：与主环境的文件操作隔离
  { id: "chat", name: "聊天", cwd: "~/Mirach/chat", icon: "ph:chat", visible: true },
  { id: "code", name: "代码", cwd: "G:\\Workspaces\\code", icon: "ph:code", visible: true },
  { id: "work", name: "工作", cwd: "G:\\Workspaces\\work", icon: "ph:briefcase", visible: true },
  { id: "finance", name: "金融写作", cwd: "G:\\Workspaces\\finance-writing", icon: "ph:chart", visible: true },
  { id: "write", name: "写作", cwd: "G:\\Workspaces\\writing", icon: "ph:pen", visible: true },
];

function defaultEnvs(): EnvProfile[] {
  if (MOCK) return [{ id: "main", name: "主环境", cwd: "", icon: "ph:bot", visible: true, builtIn: true }];
  return VIEW_ENV_SEEDS.map((e) => ({ ...e }));
}

/** 存量记录补默认字段（迁移：icon/visible/builtIn）。 */
function migrate(e: EnvProfile): EnvProfile {
  const seed = VIEW_ENV_SEEDS.find((s) => s.id === e.id);
  return {
    ...e,
    icon: e.icon ?? seed?.icon ?? "ph:bot",
    visible: e.visible ?? true,
    builtIn: e.id === "main",
  };
}

export const $environments = atom<EnvProfile[]>(load());

/** 环境变更版本号：设置页修改环境信息（尤其当前环境的工作区）后 bump，
 *  驱动 MainPanel 的会话加载流水线重新执行。 */
export const $envVersion = atom<number>(0);
export function bumpEnvVersion(): void {
  $envVersion.set($envVersion.get() + 1);
}

/** 环境切换代数：每次切左栏模式/环境信息变化都 bump。流式回调捕获发送时的
 *  代数，事件到达时代数不符即丢弃 —— 防止旧环境的流式尾巴写进新环境对话区。 */
export const $envEpoch = atom<number>(0);
export function bumpEnvEpoch(): void {
  $envEpoch.set($envEpoch.get() + 1);
}

function load(): EnvProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const list = JSON.parse(raw) as EnvProfile[];
      if (Array.isArray(list) && list.some((e) => e && e.id)) {
        // 种子里有而存量没有的环境（如升级后新增视图环境）补进来
        const have = new Set(list.map((e) => e.id));
        for (const d of defaultEnvs()) {
          if (!have.has(d.id)) list.push(migrate(d));
        }
        return list.map(migrate);
      }
    }
  } catch {
    /* 损坏数据走种子 */
  }
  return defaultEnvs();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify($environments.get()));
  } catch {
    /* 配额满等静默 */
  }
}

/** 主环境强制回填：名称/图标/工作区/可见性/锁定状态不可被传入值覆盖。 */
function enforceMain(list: EnvProfile[]): EnvProfile[] {
  const main = list.find((e) => e.id === "main");
  const locked: EnvProfile = {
    id: "main",
    name: "主环境",
    cwd: main?.cwd ?? "",
    icon: "ph:bot",
    visible: true,
    builtIn: true,
  };
  const rest = list.filter((e) => e.id !== "main");
  return [locked, ...rest];
}

export function saveEnvironments(list: EnvProfile[]): void {
  // id 全局唯一非空；main 强制保留
  const seen = new Set<string>();
  const clean = list.filter((e) => e && e.id && e.id.trim() && !seen.has(e.id));
  for (const e of clean) seen.add(e.id);
  if (!clean.some((e) => e.id === "main")) {
    clean.unshift({ id: "main", name: "主环境", cwd: "", icon: "ph:bot", visible: true, builtIn: true });
  }
  const enforced = enforceMain(clean);
  $environments.set(enforced);
  persist();
  bumpEnvVersion();
}

/** 按环境 id 取配置（未登记的环境回退主环境——只共享工作区，不做映射隔离声明）。 */
export function envById(id: string): EnvProfile {
  const list = $environments.get();
  return list.find((e) => e.id === id) ?? { id, name: id, cwd: "", icon: "ph:bot", visible: true, builtIn: false };
}

// ---- 插件/设置页 actions（main 全部拒改） ----

/** 添加环境；返回新环境 id（失败返回 null）。 */
export function addEnvironment(profile: { name: string; cwd: string; icon?: string; visible?: boolean }): string | null {
  const id = `env-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const env: EnvProfile = {
    id,
    name: profile.name.trim() || "新环境",
    cwd: profile.cwd ?? "",
    icon: profile.icon ?? "ph:bot",
    visible: profile.visible ?? true,
    builtIn: false,
  };
  saveEnvironments([...$environments.get(), env]);
  return id;
}

/** 更新环境（main 内置锁定，全拒；其余自由改）。 */
export function updateEnvironment(id: string, patch: Partial<Pick<EnvProfile, "name" | "cwd" | "icon" | "visible">>): boolean {
  const list = $environments.get();
  const target = list.find((e) => e.id === id);
  if (!target) return false;
  if (target.builtIn) return false;
  saveEnvironments(
    list.map((e) =>
      e.id === id
        ? {
            ...e,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
            ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
            ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
          }
        : e,
    ),
  );
  return true;
}

/** 删除环境（main 拒绝）。返回是否删除。 */
export function removeEnvironment(id: string): boolean {
  const list = $environments.get();
  const target = list.find((e) => e.id === id);
  if (!target || target.builtIn) return false;
  saveEnvironments(list.filter((e) => e.id !== id));
  return true;
}

/** 可见性开关（main 恒 true，拒改）。 */
export function setEnvVisible(id: string, visible: boolean): boolean {
  const list = $environments.get();
  const target = list.find((e) => e.id === id);
  if (!target) return false;
  if (target.builtIn) return false;
  saveEnvironments(list.map((e) => (e.id === id ? { ...e, visible } : e)));
  return true;
}
