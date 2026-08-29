/**
 * environments - 工作环境 store（环境隔离，本地持久化）
 *
 * 环境与左栏模式（activeView）一一绑定：hermes/chat → main 主环境，
 * code/work/finance/... 直接以视图 id 作为环境 id。切换视图 = 切换环境：
 * MainPanel 串行下发 dsh_set_env（envId + cwd）→ sidecar 以
 * "<envId>::<会话id>" 做会话映射命名空间 + 引擎工作区 cwd 切换 → 下一条
 * 消息触发 runtime 重启换到新工作区。dsh 会话持久化天然按 cwd 分组
 * （sessionRoot/<cwd编码>/<sessionId>），历史/上下文/文件操作随环境隔离——
 * 对齐 dsh 原生语义，零引擎改动。
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
}

const STORAGE_KEY = "mirach.environments.v1";

/** 左栏视图 → 环境 id（每个视图独占一个环境；hermes 视图即 main 主环境）。 */
export function envIdForView(view: string): string {
  if (view === "mirach" || view === "hermes") return "main";
  return view;
}

/**
 * 左栏全部可作环境的视图（与 LeftToolbar topTools 对齐）。
 * 种子缺失的环境在 load() 时自动补齐——否则"写作"等视图首次切入时
 * 未登记，设置页环境数量与实际对不上。
 */
const VIEW_ENV_SEEDS: EnvProfile[] = [
  { id: "main", name: "主环境", cwd: "" },
  // 聊天环境专属工作区（~ 展开为用户主目录）：与主环境的文件操作隔离
  { id: "chat", name: "聊天", cwd: "~/Mirach/chat" },
  { id: "code", name: "代码", cwd: "G:\\Workspaces\\code" },
  { id: "work", name: "工作", cwd: "G:\\Workspaces\\work" },
  { id: "finance", name: "金融写作", cwd: "G:\\Workspaces\\finance-writing" },
  { id: "write", name: "写作", cwd: "G:\\Workspaces\\writing" },
];

function defaultEnvs(): EnvProfile[] {
  if (MOCK) return [{ id: "main", name: "主环境", cwd: "" }];
  return VIEW_ENV_SEEDS.map((e) => ({ ...e }));
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
          if (!have.has(d.id)) list.push(d);
        }
        return list;
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

export function saveEnvironments(list: EnvProfile[]): void {
  // main 主环境不可删除；id 全局唯一非空
  const seen = new Set<string>();
  const clean = list.filter((e) => e && e.id && e.id.trim() && !seen.has(e.id));
  for (const e of clean) seen.add(e.id);
  if (!clean.some((e) => e.id === "main")) {
    clean.unshift({ id: "main", name: "主环境", cwd: "" });
  }
  $environments.set(clean);
  persist();
  bumpEnvVersion();
}

/** 按环境 id 取配置（未登记的环境回退主环境——只共享工作区，不做映射隔离声明）。 */
export function envById(id: string): EnvProfile {
  const list = $environments.get();
  return list.find((e) => e.id === id) ?? { id, name: id, cwd: "" };
}
