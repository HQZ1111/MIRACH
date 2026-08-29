/**
 * projects - 项目 store（本地持久化）
 *
 * 左侧栏项目树数据源；新建项目写本地。接后端后由 project.* 同步。
 */

import { atom } from "nanostores";

export interface ProjectSessionItem {
  title: string;
  time: string;
}

export interface Project {
  id: string;
  name: string;
  sessions: ProjectSessionItem[];
  /** 自定义工作区（项目级 cwd；空 = 跟随系统默认） */
  cwd?: string;
}

const STORAGE_KEY = "mirach.projects.v1";

const SEED: Project[] = [
  { id: "p1", name: "项目 01", sessions: [{ title: "前端架构重构", time: "12:34" }, { title: "组件库升级", time: "11:20" }] },
  { id: "p2", name: "项目 02", sessions: [{ title: "API 接口设计", time: "昨天" }, { title: "数据库迁移", time: "周三" }] },
  { id: "p3", name: "项目 03", sessions: [{ title: "性能优化", time: "周一" }, { title: "CI/CD 配置", time: "上周" }] },
];

function load(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Project[];
  } catch {
    /* ignore */
  }
  return SEED;
}

function persist(list: Project[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export const $projects = atom<Project[]>(load());

function commit(list: Project[]): void {
  persist(list);
  $projects.set(list);
}

let idSeq = 0;

export function createProject(name: string, cwd?: string): Project {
  const p: Project = { id: `p${Date.now()}_${idSeq++}`, name: name || "新项目", sessions: [], ...(cwd ? { cwd } : {}) };
  commit([...$projects.get(), p]);
  return p;
}

/** 新对话页画廊选中的项目（发送时把会话挂到它、引擎环境切到它的 cwd） */
export const $selectedProjectId = atom<string | null>(null);

export function selectProject(id: string | null): void {
  $selectedProjectId.set(id);
}

export function removeProject(id: string): void {
  commit($projects.get().filter((p) => p.id !== id));
}

/** 在指定项目下新建会话 */
export function addProjectSession(projectId: string, title: string): void {
  commit(
    $projects.get().map((p) =>
      p.id === projectId ? { ...p, sessions: [{ title: title || "新会话", time: "刚刚" }, ...p.sessions] } : p,
    ),
  );
}
