/**
 * artifact-detect — 从文本中检测产物（HTML/SVG/代码围栏/链接）
 *
 * 规则参考 hermes-agent-main apps/desktop 的 lib/artifact-detect.ts：
 * - 围栏代码块（```html/```svg/```lang）按长度阈值判定为产物
 * - 裸链接收集为 link 类型
 *
 * 产物由 store/artifacts.ts 收集（去重），预览见 ArtifactsPanel。
 */

export type ArtifactKind = "html" | "svg" | "code" | "link";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** html/svg/code 的内容 */
  content: string;
  /** code 的语言；link 的地址 */
  language?: string;
  url?: string;
  sessionId: string;
  createdAt: number;
}

const FENCE_RE = /```([\w+-]*)\n([\s\S]*?)```/g;
const LINK_RE = /(https?:\/\/[^\s)]+)/g;

/** 从内容提取标题：<title> → <h1> → 首个非空行 */
function titleFrom(content: string, kind: ArtifactKind): string {
  const title = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) return title[1].trim();
  const h1 = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) return h1[1].trim();
  const firstLine = content.split("\n").find((l) => l.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 40) : kind.toUpperCase();
}

export function detectArtifacts(text: string, sessionId = "main"): Artifact[] {
  const out: Artifact[] = [];
  const now = Date.now();
  const push = (a: Omit<Artifact, "id" | "sessionId" | "createdAt">) => {
    out.push({ ...a, id: `a${now}_${out.length}`, sessionId, createdAt: now + out.length });
  };

  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    const lang = (m[1] || "").toLowerCase();
    const content = m[2].trim();
    if (content.length < 20) continue; // 过短不构成产物
    if (lang === "html" || /<html|<body|<div|<h1|<style/.test(content)) {
      push({ kind: "html", title: titleFrom(content, "html"), content });
    } else if (lang === "svg" || /<svg/.test(content)) {
      push({ kind: "svg", title: titleFrom(content, "svg"), content });
    } else {
      push({ kind: "code", title: titleFrom(content, "code"), content, language: lang || "text" });
    }
  }

  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    push({ kind: "link", title: m[1], content: "", url: m[1] });
  }

  return out;
}
