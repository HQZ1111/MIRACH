/**
 * tavern — 酒馆（dsh-tavern）角色接入 mirach 成员体系
 *
 * 数据源一：dsh-tavern 插件的 Agent 预设目录 `~/.dsh/.agent-presets/<dir>/`
 *   （插件 lib/index.js 的 ROOT 硬编码在用户主目录，不随 DSH_HOME）：
 *   - preset.yml        → name / description
 *   - agent.cordis.yml  → `- id: persona` 的 text 块标量 = 角色卡注入文本
 * 数据源二：SillyTavern V2/V3 角色卡 JSON（chara_card_v2/v3 或平铺老格式），
 *   在 mirach 内直接导入为成员，不依赖酒馆管理面板。
 *
 * 成员合并：每个酒馆预设/角色卡 → agents store 一个成员（source: "tavern"），
 * 角色卡文本作为成员 systemPrompt，走既有的成员对话注入管线（set_env.systemPrompt）。
 */

import { invoke } from "@tauri-apps/api/core";
import { userHomeDir } from "./paths";

/** 酒馆预设（agent-presets 目录下的一个预设） */
export interface TavernPreset {
  /** 稳定键（预设目录名） */
  key: string;
  name: string;
  description: string;
  /** 角色卡注入文本（persona.text）；空 = 该预设没写 persona */
  persona: string;
}

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/**
 * 酒馆 agent-presets 根目录（~/.dsh/.agent-presets）。
 * 主目录经 userHomeDir() 推得；非 Tauri 环境/解析失败返回 null。
 */
export async function tavernPresetsRoot(): Promise<string | null> {
  try {
    const home = await userHomeDir();
    if (!home) return null;
    return `${home}\\.dsh\\.agent-presets`;
  } catch {
    return null;
  }
}

/**
 * 从 agent.cordis.yml 提取 persona 的 text 块标量。
 * 酒馆生成的固定形态：`config:\n    text: |-\n      <多行文本>`；
 * 兼容 |- 与 | 两种块标量与内联引号串。
 */
export function extractPersonaText(yaml: string): string {
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)text:\s*(\|-?|\|)?\s*$/.exec(lines[i] ?? "");
    if (m) {
      const indent = m[1]!.length;
      const out: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] ?? "";
        if (line.trim() === "") {
          out.push("");
          continue;
        }
        const cur = line.length - line.trimStart().length;
        if (cur <= indent) break;
        out.push(line.slice(indent + 2 <= cur ? cur : indent)); // 剥去块缩进
      }
      while (out.length && out[out.length - 1] === "") out.pop();
      return out.join("\n").trim();
    }
    const inline = /^\s*text:\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(lines[i] ?? "");
    if (inline) return inline[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }
  return "";
}

function yamlScalar(raw: string): string {
  const t = raw.trim();
  const q = /^"((?:[^"\\]|\\.)*)"$/.exec(t) ?? /^'([^']*)'$/.exec(t);
  if (q) return q[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  return t;
}

function presetYmlField(yaml: string, field: string): string {
  const m = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(yaml);
  return m ? yamlScalar(m[1]!) : "";
}

/** 列出酒馆全部预设（目录缺失/非 Tauri 环境返回空数组） */
export async function listTavernPresets(): Promise<TavernPreset[]> {
  const root = await tavernPresetsRoot();
  if (!root) return [];
  try {
    const entries = await invoke<FileEntry[]>("read_dir", { path: root });
    const out: TavernPreset[] = [];
    for (const e of entries.filter((x) => x.is_dir)) {
      let name = e.name;
      let description = "";
      let persona = "";
      try {
        const py = await invoke<string>("read_file", { path: `${e.path}\\preset.yml` });
        name = presetYmlField(py, "name") || name;
        description = presetYmlField(py, "description");
      } catch {
        /* 无 preset.yml：用目录名 */
      }
      try {
        const cy = await invoke<string>("read_file", { path: `${e.path}\\agent.cordis.yml` });
        persona = extractPersonaText(cy);
      } catch {
        /* 无 agent.cordis.yml */
      }
      out.push({ key: e.name, name, description, persona });
    }
    return out;
  } catch {
    return [];
  }
}

/** SillyTavern 角色卡（V2/V3 或平铺）解析结果 */
export interface TavernCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
}

/** 解析 SillyTavern 角色卡 JSON；非法输入返回 null */
export function parseCharacterCard(json: string): TavernCard | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const data = (raw.data ?? raw) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const name = str(data.name).trim();
    if (!name) return null;
    return {
      name,
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      firstMes: str(data.first_mes ?? data.firstMes),
    };
  } catch {
    return null;
  }
}

/** 角色卡 → 成员系统提示词（角色扮演注入文本） */
export function cardToPersona(card: TavernCard): string {
  const parts: string[] = [
    `你是「${card.name}」。请完全以该角色身份与用户对话，始终保持角色扮演，不要跳出角色设定。`,
  ];
  if (card.description) parts.push(`【角色描述】\n${card.description}`);
  if (card.personality) parts.push(`【性格】\n${card.personality}`);
  if (card.scenario) parts.push(`【场景】\n${card.scenario}`);
  if (card.firstMes) parts.push(`【开场白】\n${card.firstMes}\n（首次回复以贴合开场白的口吻开始）`);
  return parts.join("\n\n");
}

/** 酒馆预设 → 成员系统提示词（persona 即插件请求时的注入文本） */
export function presetToPersona(p: TavernPreset): string {
  const persona = p.persona.trim();
  const head = `你是「${p.name}」。请完全以该角色身份与用户对话，始终保持角色扮演，不要跳出角色设定。`;
  return persona ? `${head}\n\n${persona}` : head;
}
