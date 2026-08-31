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

// ── 世界书（对齐 dsh-tavern v2 统一格式） ──
// 存储：<预设目录>/worldbooks.json（旧 worldbook.json 兼容读）
// { version: 2, injectMode: "full"|"keyword", groups: [{ name, enabled, entries }] }
// entry：{ name, keywords: string[], content, enabled }——keyword 模式按触发词命中。

export interface WbEntry {
  name?: string;
  keywords?: string[];
  content?: string;
  enabled?: boolean;
}

export interface WbGroup {
  name?: string;
  enabled?: boolean;
  entries: WbEntry[];
}

export interface Worldbook {
  version?: number;
  injectMode?: string;
  groups?: WbGroup[];
}

function normalizeWorldbook(d: unknown): Worldbook {
  if (Array.isArray(d)) {
    const looksLikeWorldbooks = d.some((wb) => wb && Array.isArray((wb as WbGroup).entries));
    if (looksLikeWorldbooks) {
      return {
        injectMode: "full",
        groups: d
          .filter((wb) => wb && Array.isArray((wb as WbGroup).entries))
          .map((wb) => ({
            name: (wb as WbGroup).name || "未命名世界书",
            enabled: (wb as WbGroup).enabled !== false,
            entries: (wb as WbGroup).entries ?? [],
          })),
      };
    }
    return { injectMode: "full", groups: [{ name: "导入条目", enabled: true, entries: d as WbEntry[] }] };
  }
  const o = (d ?? {}) as Worldbook;
  let groups = Array.isArray(o.groups) ? o.groups : [];
  if (!groups.length && Array.isArray((o as { entries?: WbEntry[] }).entries)) {
    groups = [{ name: "导入条目", enabled: true, entries: (o as { entries: WbEntry[] }).entries }];
  }
  return {
    injectMode: o.injectMode === "keyword" ? "keyword" : "full",
    groups: groups.map((g) => ({
      name: g?.name || "未命名世界书",
      enabled: g?.enabled !== false,
      entries: Array.isArray(g?.entries) ? g.entries : [],
    })),
  };
}

/** 读取预设的世界书（worldbooks.json 优先，worldbook.json 兼容；缺失返回空书） */
export async function readWorldbook(presetRoot: string, presetKey: string): Promise<Worldbook> {
  const base = `${presetRoot}\\${presetKey}`;
  for (const f of ["worldbooks.json", "worldbook.json"]) {
    try {
      const text = await invoke<string>("read_file", { path: `${base}\\${f}` });
      return normalizeWorldbook(JSON.parse(text));
    } catch {
      /* 换下一个/缺失 */
    }
  }
  return { version: 2, injectMode: "full", groups: [] };
}

/** 保存预设的世界书（统一写 worldbooks.json v2 格式） */
export async function writeWorldbook(presetRoot: string, presetKey: string, wb: Worldbook): Promise<void> {
  const unified = {
    version: 2,
    injectMode: wb.injectMode === "keyword" ? "keyword" : "full",
    groups: (wb.groups ?? []).map((g) => ({
      name: g.name || "未命名世界书",
      enabled: g.enabled !== false,
      entries: g.entries ?? [],
    })),
  };
  await invoke("write_user_file", {
    path: `${presetRoot}\\${presetKey}\\worldbooks.json`,
    content: JSON.stringify(unified, null, 2),
  });
}

/**
 * 登记"会话 → 酒馆预设"绑定（session-bindings.json）。
 *
 * 插件的注入门控读这个文件：只有登记过的会话才注入角色卡/世界书/记忆/关系网。
 * mirach 成员经 agentPresets.select 绑定预设成功后调用本函数落一条
 * dshSessionId → presetId，注入即对该成员会话激活（其他会话零注入）。
 */
export async function recordTavernBinding(dshSessionId: string, presetId: string): Promise<void> {
  const home = await userHomeDir();
  if (!home || !dshSessionId || !presetId) return;
  const path = `${home}\\.dsh\\.agent-presets\\session-bindings.json`;
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(await invoke<string>("read_file", { path })) as Record<string, string>;
    if (!data || typeof data !== "object") data = {};
  } catch {
    data = {}; // 文件不存在 = 首条绑定
  }
  if (data[dshSessionId] === presetId) return; // 已登记
  data[dshSessionId] = presetId;
  await invoke("write_user_file", { path, content: JSON.stringify(data, null, 2) });
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

/** 从卡片对象（V2 {data:{…}} 或平铺）提取字段；非卡片返回 null */
export function cardFromObject(raw: unknown): TavernCard | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;
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
}

/** 解析 SillyTavern 角色卡 JSON；非法输入返回 null */
export function parseCharacterCard(json: string): TavernCard | null {
  try {
    return cardFromObject(JSON.parse(json));
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * 解析 SillyTavern PNG 角色卡：角色 JSON 以 base64 藏在 PNG tEXt 块里
 * （keyword "chara"，V3 卡为 "ccv3"）。非 PNG / 无卡返回 null。
 */
export function parseCharacterCardPng(buf: ArrayBuffer): TavernCard | null {
  const bytes = new Uint8Array(buf);
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const dec = new TextDecoder("utf-8");
  const latin = (arr: Uint8Array): string => {
    // 分段 fromCharCode，避开超长数组的参数上限
    let out = "";
    for (let i = 0; i < arr.length; i += 0x8000) {
      out += String.fromCharCode(...arr.subarray(i, i + 0x8000));
    }
    return out;
  };
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = ((bytes[off]! << 24) | (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!) >>> 0;
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const dataStart = off + 8;
    if (dataStart + len + 4 > bytes.length) return null;
    if (type === "tEXt") {
      const data = bytes.subarray(dataStart, dataStart + len);
      const z = data.indexOf(0);
      if (z > 0) {
        const keyword = latin(data.subarray(0, z));
        if (keyword === "chara" || keyword === "ccv3") {
          try {
            const b64 = latin(data.subarray(z + 1)).replace(/\s/g, "");
            const bin = atob(b64);
            const jsonBytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) jsonBytes[i] = bin.charCodeAt(i);
            const card = cardFromObject(JSON.parse(dec.decode(jsonBytes)));
            if (card) return card;
          } catch {
            /* 该块不是有效卡：继续扫下一块 */
          }
        }
      }
    }
    off = dataStart + len + 4; // 跳过 CRC
    if (type === "IEND") break;
  }
  return null;
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
