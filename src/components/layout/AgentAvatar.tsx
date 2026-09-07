/**
 * AgentAvatar — hermes bots 头像系统移植（apps/desktop/src/plugins/hermes-bots/avatar.tsx）
 *
 * 形状/颜色/眼睛的词汇表、确定性的数学表情脸（随名字派生、会眨眼/注视/
 * 工作时三点跳动）、共享表情时钟，以及 BotFace —— 所有成员行/对话框/卡片
 * 统一用它渲染头像。照片头像走 <img>（data URL），形状头像保持 SVG 以便
 * 时钟驱动。裁剪自 hermes：blobatar（依赖 plugin-sdk 的生成库）与 PNG 回填
 * 未移植；sigil 符印与多面体保留。
 */

// ── 形状词汇表 ──────────────────────────────────────────────────────────────

const AVATAR_SHAPES = ["circle", "squircle", "pill", "triangle", "hexagon", "cloud", "drop"] as const;
export const AVATAR_PICKER_SHAPES = ["circle", "squircle", "pill", "triangle", "hexagon", "cloud", "drop"] as const;
const PLATONIC_SHAPES = ["tetrahedron", "cube", "octahedron", "dodecahedron", "icosahedron"] as const;
export const AVATAR_EXTRA_SHAPES = [...PLATONIC_SHAPES, "sigil-1", "sigil-2", "sigil-3"] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number] | (typeof PLATONIC_SHAPES)[number] | `sigil-${number}`;

/** xorshift PRNG（字符串播种）——跨会话/平台稳定。 */
function sigilRng(text: string) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0 || 88675123;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

interface SigilGeometry {
  ring: null | string;
  strokes: string;
}

/** 角制符印：5 列网格左半笔画 + 镜像右半 + 概率菱形环。 */
function sigilGeometry(name: string, seed: number): SigilGeometry {
  const rng = sigilRng(`${name}::${seed}`);
  const gx = (i: number) => 6 + i * 7;
  const gy = (j: number) => 8 + j * 6;
  const strokes: string[] = [];
  const segments = 4 + Math.floor(rng() * 3);
  for (let k = 0; k < segments; k++) {
    const x1 = Math.floor(rng() * 3);
    const y1 = Math.floor(rng() * 5);
    const x2 = Math.min(2, Math.max(0, x1 + (rng() > 0.5 ? 1 : -1)));
    const y2 = Math.min(4, Math.max(0, y1 + Math.floor(rng() * 3) - 1));
    strokes.push(`M${gx(x1)} ${gy(y1)} L${gx(x2)} ${gy(y2)}`);
    strokes.push(`M${gx(4 - x1)} ${gy(y1)} L${gx(4 - x2)} ${gy(y2)}`);
    if (rng() > 0.6) strokes.push(`M${gx(x2)} ${gy(y2)} L${gx(4 - x2)} ${gy(y2)}`);
  }
  strokes.push(`M20 ${gy(0)} L20 ${gy(4)}`);
  const ring = rng() > 0.45 ? "M20 4 L36 20 L20 36 L4 20 Z" : null;
  return { strokes: strokes.join(" "), ring };
}

/** 感知亮度——深色身体上眼睛/瞳孔翻成浅色。 */
function isDarkColor(hex: string) {
  try {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
  } catch {
    return false;
  }
}

export function defaultShapeFor(name: string): AvatarShape {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return AVATAR_SHAPES[hash % AVATAR_SHAPES.length];
}

// ── 形状节点（身体，无眼睛）────────────────────────────────────────────────

interface FacePathProps {
  fill: string;
  stroke: string;
  strokeLinecap?: "round";
  strokeLinejoin?: "round";
  strokeWidth: number;
}

function shapeNode(shape: string, color: string, botName = "agent") {
  if (shape.startsWith("sigil-")) {
    const seed = Number(shape.slice(6)) || 0;
    const { strokes, ring } = sigilGeometry(botName, seed);
    const sw: FacePathProps = {
      fill: "none",
      stroke: color,
      strokeWidth: 2.2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    };
    return (
      <g>
        {ring ? <path d={ring} fill="none" opacity={0.5} stroke={color} strokeWidth={1.2} /> : null}
        <path d={strokes} {...sw} />
      </g>
    );
  }

  const stroke: FacePathProps = { fill: color, stroke: color, strokeWidth: 7, strokeLinejoin: "round" };
  const edge: FacePathProps = { fill: "none", stroke: "rgba(0,0,0,0.4)", strokeWidth: 1.4, strokeLinejoin: "round", strokeLinecap: "round" };
  const face: FacePathProps = { fill: color, stroke: "rgba(0,0,0,0.4)", strokeWidth: 1.4, strokeLinejoin: "round" };

  switch (shape) {
    case "tetrahedron":
      return (
        <g>
          <path d="M20 5 L36 33 L4 33 Z" {...face} />
          <path d="M20 5 L20 25 M4 33 L20 25 M36 33 L20 25" {...edge} />
        </g>
      );
    case "cube":
      return (
        <g>
          <path d="M20 4 L33 11 L33 29 L20 36 L7 29 L7 11 Z" {...face} />
          <path d="M7 11 L20 18 L33 11 M20 18 L20 36" {...edge} />
        </g>
      );
    case "octahedron":
      return (
        <g>
          <path d="M20 3 L36 20 L20 37 L4 20 Z" {...face} />
          <path d="M4 20 L36 20 M20 3 L20 37" {...edge} />
        </g>
      );
    case "dodecahedron":
      return (
        <g>
          <path
            d="M20 3 L30 6.2 L36.2 14.7 L36.2 25.3 L30 33.8 L20 37 L10 33.8 L3.8 25.3 L3.8 14.7 L10 6.2 Z"
            {...face}
          />
          <path
            d={
              "M20 12 L27.6 17.5 L24.7 26.5 L15.3 26.5 L12.4 17.5 Z " +
              "M20 12 L20 3 M27.6 17.5 L36.2 14.7 M24.7 26.5 L30 33.8 M15.3 26.5 L10 33.8 M12.4 17.5 L3.8 14.7"
            }
            {...edge}
          />
        </g>
      );
    case "icosahedron":
      return (
        <g>
          <path d="M20 3 L34.7 11.5 L34.7 28.5 L20 37 L5.3 28.5 L5.3 11.5 Z" {...face} />
          <path
            d={
              "M20 11 L27.8 24.5 L12.2 24.5 Z " +
              "M20 11 L20 3 M20 11 L34.7 11.5 M20 11 L5.3 11.5 " +
              "M27.8 24.5 L34.7 11.5 M27.8 24.5 L34.7 28.5 M27.8 24.5 L20 37 " +
              "M12.2 24.5 L5.3 11.5 M12.2 24.5 L5.3 28.5 M12.2 24.5 L20 37"
            }
            {...edge}
          />
        </g>
      );
    case "squircle":
      return <rect fill={color} height={34} rx={11} width={34} x={3} y={3} />;
    case "pill":
      return <rect fill={color} height={26} rx={13} width={36} x={2} y={7} />;
    case "triangle":
      return <path d="M20 5.5 L36 33.5 L4 33.5 Z" {...stroke} />;
    case "hexagon":
      return <path d="M20 3.5 L34.5 11.75 L34.5 28.25 L20 36.5 L5.5 28.25 L5.5 11.75 Z" {...stroke} />;
    case "cloud":
      return <path d="M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z" fill={color} />;
    case "drop":
      return <path d="M20 3 C20 3 6 20 6 27 a14 13.5 0 0 0 28 0 C34 20 20 3 20 3 Z" fill={color} />;
    default:
      return <circle cx={20} cy={20} fill={color} r={17.5} />;
  }
}

// ── 数学表情脸（会动的头/注视/眨眼/工作三点）─────────────────────────────

type FacePoint = [number, number];

function cubicAt(p0: FacePoint, p1: FacePoint, p2: FacePoint, p3: FacePoint, t: number): FacePoint {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function sampleDropRing(steps: number): FacePoint[] {
  const pts: FacePoint[] = [];
  const n = Math.max(8, Math.floor(steps / 3));
  for (let i = 0; i < n; i++) {
    pts.push(cubicAt([20, 3], [20, 3], [6, 20], [6, 27], i / n));
  }
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    pts.push([20 - 14 * Math.cos(t), 27 + 13.5 * Math.sin(t)]);
  }
  for (let i = 1; i <= n; i++) {
    pts.push(cubicAt([34, 27], [34, 20], [20, 3], [20, 3], i / n));
  }
  return pts;
}

interface FaceArc {
  cx: number;
  cy: number;
  dtheta: number;
  rx: number;
  ry: number;
  theta1: number;
}

function svgArc(x1: number, y1: number, rx: number, ry: number, fa: number, fs: number, x2: number, y2: number): FaceArc {
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  const lam = (dx * dx) / rx2 + (dy * dy) / ry2;
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
    rx2 = rx * rx;
    ry2 = ry * ry;
  }
  const num = rx2 * ry2 - rx2 * dy * dy - ry2 * dx * dx;
  const den = rx2 * dy * dy + ry2 * dx * dx;
  let sq = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) sq = -sq;
  const cx = sq * ((rx * dy) / ry) + (x1 + x2) / 2;
  const cy = sq * ((-ry * dx) / rx) + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const n = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vx) / n)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1 - cx) / rx, (y1 - cy) / ry);
  let dtheta = ang((x1 - cx) / rx, (y1 - cy) / ry, (x2 - cx) / rx, (y2 - cy) / ry);
  if (!fs && dtheta > 0) dtheta -= Math.PI * 2;
  if (fs && dtheta < 0) dtheta += Math.PI * 2;
  return { cx, cy, rx, ry, theta1, dtheta };
}

function sampleArc(arc: FaceArc, n: number): FacePoint[] {
  const pts: FacePoint[] = [];
  for (let i = 0; i < n; i++) {
    const th = arc.theta1 + arc.dtheta * (i / n);
    pts.push([arc.cx + arc.rx * Math.cos(th), arc.cy + arc.ry * Math.sin(th)]);
  }
  return pts;
}

function sampleCloudRing(steps: number): FacePoint[] {
  const a1 = svgArc(11, 32, 7.5, 7.5, 0, 1, 10, 17.1);
  const a2 = svgArc(10, 17.1, 9.5, 9.5, 0, 1, 29, 12.5);
  const a3 = svgArc(29, 12.5, 7, 7, 0, 1, 30, 32);
  const len1 = Math.abs(a1.dtheta) * a1.rx;
  const len2 = Math.abs(a2.dtheta) * a2.rx;
  const len3 = Math.abs(a3.dtheta) * a3.rx;
  const len4 = 19;
  const total = len1 + len2 + len3 + len4;
  const n = Math.max(64, steps);
  const n1 = Math.max(8, Math.round((n * len1) / total));
  const n2 = Math.max(10, Math.round((n * len2) / total));
  const n3 = Math.max(10, Math.round((n * len3) / total));
  const n4 = Math.max(4, n - n1 - n2 - n3);
  const pts: FacePoint[] = [];
  pts.push(...sampleArc(a1, n1));
  pts.push(...sampleArc(a2, n2));
  pts.push(...sampleArc(a3, n3));
  for (let i = 0; i < n4; i++) {
    pts.push([30 + (11 - 30) * (i / n4), 32]);
  }
  return pts;
}

function sampleFaceRing(shape: null | string | undefined, steps = 52): FacePoint[] {
  const kind = (shape || "").startsWith("sigil-") ? "circle" : shape;
  if (kind === "drop" || kind === "teardrop") return sampleDropRing(steps);
  if (kind === "cloud") return sampleCloudRing(steps);
  const pts: FacePoint[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let rx = 16;
    let ry = 16;
    if (kind === "circle") {
      rx = ry = 16.2;
    } else if (kind === "blob") {
      rx = ry = 16 + 1.7 * Math.sin(3 * a) + 0.7 * Math.cos(5 * a);
    } else if (kind === "squircle") {
      const p = 5;
      const d = Math.pow(Math.abs(c) ** p + Math.abs(s) ** p, 1 / p) || 1;
      rx = ry = 16.2 / d;
    } else if (kind === "pill") {
      const d = Math.pow(Math.abs(c) ** 8 + Math.abs(s / 0.72) ** 8, 1 / 8) || 1;
      rx = ry = 16 / d;
    } else if (kind === "triangle" || kind === "tetrahedron" || kind === "wedge") {
      const u = (a + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      const sector = (u / ((Math.PI * 2) / 3)) % 1;
      rx = ry = 13.5 / Math.max(0.42, Math.cos((sector - 0.5) * 1.9));
    } else if (kind === "hexagon" || kind === "hex" || kind === "icosahedron" || kind === "dodecahedron") {
      const seg = Math.PI / 3;
      const hex = Math.cos(seg / 2) / Math.cos(a - seg * Math.round(a / seg));
      rx = ry = 16.2 * hex;
    } else if (kind === "cube" || kind === "octahedron") {
      const p = 3.1;
      const d = Math.pow(Math.abs(c) ** p + Math.abs(s) ** p, 1 / p) || 1;
      rx = ry = 16 / d;
    } else if (kind === "pebble") {
      rx = 16.4 * (1.04 - 0.14 * Math.cos(2 * a));
      ry = 15.2 * (1.06 + 0.08 * Math.sin(2 * a));
    } else {
      rx = ry = 16.2;
    }
    pts.push([20 + rx * c, 20 + ry * s]);
  }
  return pts;
}

function projectFacePoint(x: number, y: number, turn: number, tilt: number, roll: number): FacePoint {
  const dx = x - 20;
  const dy = y - 20;
  const r = (roll * Math.PI) / 180;
  const xr = dx * Math.cos(r) - dy * Math.sin(r);
  const yr = dx * Math.sin(r) + dy * Math.cos(r);
  const sx = 0.74 + 0.26 * Math.abs(Math.cos((turn * Math.PI) / 180));
  const sy = 0.8 + 0.2 * Math.abs(Math.cos((tilt * Math.PI) / 180));
  return [20 + xr * sx, 20 + yr * sy];
}

function ringToPath(pts: FacePoint[]) {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += `L${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  }
  return d + "Z";
}

export type FaceMood = "idle" | "work";

interface FacePose {
  blink: boolean;
  d0: number;
  d1: number;
  d2: number;
  gazeX: number;
  gazeY: number;
  roll: number;
  tilt: number;
  turn: number;
}

/** Grok 风格姿势。working 时倾斜摇摆，idle 是小正弦。 */
function facePose(mood: FaceMood | string, t: number): FacePose {
  if (mood === "work") {
    return {
      turn: -11 + Math.sin(t * 0.48) * 8,
      tilt: Math.sin(t * 0.42) * 8 + Math.sin(t * 1.1) * 1.6,
      roll: Math.sin(t * 0.75) * 4.2,
      gazeX: Math.sin(t * 0.55) * 3.6,
      gazeY: -1.6 + Math.sin(t * 0.38) * 2,
      blink: t % 1.45 > 1.26,
      d0: 0.2 + 0.8 * Math.max(0, Math.sin(t * 2.6)),
      d1: 0.2 + 0.8 * Math.max(0, Math.sin(t * 2.6 - 0.7)),
      d2: 0.2 + 0.8 * Math.max(0, Math.sin(t * 2.6 - 1.4)),
    };
  }
  return {
    turn: Math.sin(t * 0.5) * 1.5,
    tilt: Math.sin(t * 0.27),
    roll: Math.sin(t * 0.85) * 1.2,
    gazeX: 0,
    gazeY: 0,
    blink: t % 3.2 > 3.02,
    d0: 0,
    d1: 0,
    d2: 0,
  };
}

interface NumericAttrNode {
  setAttribute(name: string, value: number | string): void;
}

function paintMathFace(svg: SVGSVGElement, t: number) {
  const mood = svg.getAttribute("data-hb-mood") || "idle";
  const shape = svg.getAttribute("data-hb-shape") || "circle";
  const pose = facePose(mood, t);
  const body = svg.querySelector("[data-hb-body]");
  const open = svg.querySelector("[data-hb-open]");
  const shut = svg.querySelector("[data-hb-shut]");
  const el = svg.querySelector("[data-hb-el]") as NumericAttrNode | null;
  const er = svg.querySelector("[data-hb-er]") as NumericAttrNode | null;
  const dots = svg.querySelectorAll("[data-hb-dot]");

  if (body) {
    if (shape === "cloud") {
      body.setAttribute("d", "M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z");
    } else {
      const ring = sampleFaceRing(shape).map(([x, y]) => projectFacePoint(x, y, pose.turn, pose.tilt, pose.roll));
      body.setAttribute("d", ringToPath(ring));
    }
  }

  const eyeY = (shape === "cloud" ? 22 : 17.2) + pose.gazeY;
  const eyeL = 15.4 + pose.gazeX;
  const eyeR = 24.6 + pose.gazeX;

  if (el) {
    el.setAttribute("cx", String(eyeL));
    el.setAttribute("cy", String(eyeY));
  }
  if (er) {
    er.setAttribute("cx", String(eyeR));
    er.setAttribute("cy", String(eyeY));
  }

  const hl = svg.querySelector("[data-hb-hl-l]") as NumericAttrNode | null;
  const hr = svg.querySelector("[data-hb-hl-r]") as NumericAttrNode | null;
  if (hl) {
    hl.setAttribute("cx", String(eyeL - 0.6));
    hl.setAttribute("cy", String(eyeY - 0.7));
  }
  if (hr) {
    hr.setAttribute("cx", String(eyeR - 0.6));
    hr.setAttribute("cy", String(eyeY - 0.7));
  }

  if (open) open.setAttribute("opacity", pose.blink ? "0" : "1");
  if (shut) {
    shut.setAttribute("d", `M${eyeL - 2.6} ${eyeY} L${eyeL + 2.6} ${eyeY} M${eyeR - 2.6} ${eyeY} L${eyeR + 2.6} ${eyeY}`);
    shut.setAttribute("opacity", pose.blink ? "1" : "0");
  }

  dots.forEach((dot, i) => {
    const o = i === 0 ? pose.d0 : i === 1 ? pose.d1 : pose.d2;
    dot.setAttribute("opacity", String(o));
  });
  svg.style.transform = `rotate(${pose.tilt}deg)`;
  svg.style.transformOrigin = "50% 70%";
}

function walkMathFaces(root: Document | null, acc: SVGSVGElement[]): SVGSVGElement[] {
  if (!root || !root.querySelectorAll) return acc;
  root.querySelectorAll<SVGSVGElement>("svg[data-hb-math]").forEach((node) => acc.push(node));
  return acc;
}

/** 共享表情时钟：挂在 window 上，第二次加载会认领已有时钟而不是开对头循环。 */
interface FaceClock {
  stop: () => void;
  wake: () => void;
}

declare global {
  interface Window {
    __hbFaceClock?: FaceClock;
  }
}

export function startFaceClock() {
  if (typeof window === "undefined") return;
  if (window.__hbFaceClock) {
    window.__hbFaceClock.wake();
    return;
  }

  const t0 = performance.now();
  let faces: SVGSVGElement[] = [];
  let lastScan = -Infinity;
  let lastPaint = -Infinity;
  let rafId = 0;
  let stopped = false;

  const scanFaces = () => {
    faces = walkMathFaces(document, []);
  };

  const paint = (now: number) => {
    if (now - lastScan > 1000) {
      scanFaces();
      lastScan = now;
    }
    const t = (now - t0) / 1000;
    for (const svg of faces) {
      if (svg.isConnected) paintMathFace(svg, t);
    }
  };

  const tick = (now: number) => {
    if (stopped) return;
    rafId = 0;
    // 15fps 对头像尺度足够流畅，同时限制 SVG/DOM 开销；rAF 让 Chromium 在
    // 窗口被遮挡时自动暂停。
    if (!document.hidden && now - lastPaint >= 1000 / 15) {
      paint(now);
      lastPaint = now;
    }
    if (faces.length === 0) return; // 无脸可画：停摆，下一个 BotFace 挂载会唤醒
    rafId = window.requestAnimationFrame(tick);
  };

  const wake = () => {
    if (stopped) return;
    lastScan = -Infinity;
    if (!rafId) rafId = window.requestAnimationFrame(tick);
  };

  const stop = () => {
    stopped = true;
    if (rafId) window.cancelAnimationFrame(rafId);
    faces = [];
    delete window.__hbFaceClock;
  };

  window.__hbFaceClock = { stop, wake };
  rafId = window.requestAnimationFrame(tick);
}

export function stopFaceClock() {
  if (typeof window !== "undefined" && window.__hbFaceClock) {
    window.__hbFaceClock.stop();
  }
}

// ── BotFace：统一头像组件 ───────────────────────────────────────────────────

export interface BotFaceProps {
  color: string;
  image?: null | string;
  mood?: FaceMood;
  name?: string;
  shape: string;
  size?: number;
}

/** 照片走 <img>；形状头像保持 SVG（时钟才能动它）。 */
export function BotFace({ shape, color, image, size = 36, name = "agent", mood = "idle" }: BotFaceProps) {
  startFaceClock();

  if (image) {
    return (
      <img
        alt=""
        aria-hidden
        src={image}
        style={{
          width: size,
          height: size,
          borderRadius: "22%",
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }

  if (shape.startsWith("sigil-")) {
    const eyes = (
      <g>
        <circle cx={16} cy={14} fill={color} r={2.4} />
        <circle cx={24} cy={14} fill={color} r={2.4} />
      </g>
    );
    return (
      <svg aria-hidden data-bot-face={name} height={size} viewBox="0 0 40 40" width={size}>
        {shapeNode(shape, color, name)}
        {eyes}
      </svg>
    );
  }

  const working = mood === "work";
  const eyeFill = isDarkColor(color) ? "rgba(232,220,195,0.95)" : "rgba(0,0,0,0.85)";
  const hlFill = isDarkColor(color) ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.85)";
  const ring = sampleFaceRing(shape);
  const rest = facePose(working ? "work" : "idle", 0);
  const eyeY0 = shape === "cloud" ? 22 : 17.2;

  return (
    <svg
      aria-hidden
      className="block overflow-visible"
      data-bot-face={name}
      data-hb-math="1"
      data-hb-mood={working ? "work" : "idle"}
      data-hb-shape={shape || "circle"}
      height={size}
      viewBox="0 0 40 44"
      width={size}
    >
      <path
        d={shape === "cloud" ? "M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z" : ringToPath(ring)}
        data-hb-body="1"
        fill={color}
      />
      <g data-hb-open="1">
        <ellipse cx={15.4} cy={eyeY0} data-hb-el="1" fill={eyeFill} rx={2.2} ry={working ? 2.6 : 2.3} />
        <ellipse cx={24.6} cy={eyeY0} data-hb-er="1" fill={eyeFill} rx={2.2} ry={working ? 2.6 : 2.3} />
        <circle cx={14.8} cy={eyeY0 - 0.7} data-hb-hl-l="1" fill={hlFill} r={0.65} />
        <circle cx={24} cy={eyeY0 - 0.7} data-hb-hl-r="1" fill={hlFill} r={0.65} />
      </g>
      <path
        d={`M12.8 ${eyeY0} L18 ${eyeY0} M22 ${eyeY0} L27.2 ${eyeY0}`}
        data-hb-shut="1"
        fill="none"
        opacity={0}
        stroke={eyeFill}
        strokeLinecap="round"
        strokeWidth={2}
      />
      {working ? (
        <g>
          <circle cx={16.4} cy={41.2} data-hb-dot="1" fill={color} opacity={rest.d0} r={1.15} />
          <circle cx={20} cy={41.2} data-hb-dot="1" fill={color} opacity={rest.d1} r={1.15} />
          <circle cx={23.6} cy={41.2} data-hb-dot="1" fill={color} opacity={rest.d2} r={1.15} />
        </g>
      ) : null}
    </svg>
  );
}

// ── 颜色与外观解析 ─────────────────────────────────────────────────────────

const PRIMARY_AVATAR_COLOR = "#8b5cf6";

/** 名字派生的确定性色相（hermes profileColor 的本地替代）。 */
export function profileColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const sat = 62 + (hash % 18);
  const light = 46 + (hash % 10);
  return hslToHex(hue, sat, light);
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** 选过的颜色优先；没有则用名字的确定性色相。 */
export function avatarColor(color: null | string | undefined, name: string): string {
  return color || profileColor(name) || PRIMARY_AVATAR_COLOR;
}

/** 主环境（default）恒定友好紫方块；用户显式自定义（image/shape/color）优先。 */
export function botAppearance(
  name: string,
  meta: { shape?: null | string; color?: null | string; image?: null | string; custom?: boolean } | null | undefined,
): { shape: string; color: string; image: null | string } {
  const isPrimary = (name || "").trim().toLowerCase() === "default";
  const userCustomized = Boolean(meta?.custom);
  if (isPrimary && !userCustomized) {
    return { shape: "squircle", color: PRIMARY_AVATAR_COLOR, image: meta?.image || null };
  }
  return {
    shape: meta?.shape || defaultShapeFor(name),
    color: meta?.color || profileColor(name),
    image: meta?.image || null,
  };
}
