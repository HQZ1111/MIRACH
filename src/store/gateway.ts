/**
 * gateway - 引擎连接状态 store（S3-5，boot-failure / gateway-connecting 驱动）
 *
 * 状态机：idle（首次运行，未探测）→ connecting → open / error
 * - mock 模式恒 open（演示不打扰，故障浮层全部不触发）
 * - 真实模式：**Rust setup 自主预热引擎**（对齐 hermes"createWindow 时立即拉起
 *   后端"：冷启动与前端渲染并行，引擎就绪不等前端）。前端只做两件事：
 *   ① 轮询 dsh_engine_ready（sidecar ready ≠ 引擎 ready——假阳性修复核心）；
 *   ② 断线自愈（liveness 探测 + 单飞重连 + full-jitter 退避，hermes 模式）。
 * - 重连期间不弹全屏，只更新状态点；超时后升级为可见提示。
 *
 * 右栏网关状态点与故障浮层统一消费本 store。
 */

import { atom } from "nanostores";
import { invoke } from "@tauri-apps/api/core";
import { MOCK } from "@/lib/mock";
import {
  applyDesktopBootProgress,
  completeDesktopBoot,
  failDesktopBoot,
  setDesktopBootStep,
} from "@/store/boot";
import { reconnectBackoffDelayMs } from "@/lib/reconnect-backoff";
import { reconnectGateway, registerGatewayReconnect } from "@/store/gateway-reconnect";

export type GatewayState = "idle" | "connecting" | "open" | "error";

export const $gatewayState = atom<GatewayState>(MOCK ? "open" : "idle");
export const $gatewayError = atom<string | null>(null);

let probing = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 引擎冷启动预算（Rust setup 自主预热启动于进程创建时；实测可达数分钟，留足宽限）。 */
const ENGINE_BOOT_WAIT_MS = 300_000;
/** 重连重试上限（对齐 hermes BOOT_RETRY_MAX_ATTEMPTS）。 */
const BOOT_RETRY_MAX_ATTEMPTS = 5;

/** boot store 步进（真实阶段/进度，替代假动画）。 */
function bootStep(phase: string, message: string, progress: number, running = true, error?: string | null) {
  setDesktopBootStep({ phase, message, progress, running, error: error ?? null });
}

/** 探测引擎就绪（sidecar ready + engine ready 两层）。 */
async function probeEngineReady(): Promise<boolean> {
  try {
    return await invoke<boolean>("dsh_engine_ready");
  } catch {
    // 命令未注册（旧二进制）→ 退回 sidecar 探活（保守：至少不白屏）
    try {
      return await invoke<boolean>("dsh_sidecar_ready");
    } catch {
      return false;
    }
  }
}

/** 探活：idle/error → connecting → 轮询引擎就绪 → open/error（防并发）。
 *  引擎由 Rust setup 自主预热（不等前端），这里只探状态 + 等就绪。
 *  maxTries：sidecar 就绪轮询次数（750ms/次，Rust spawn 前的窗口）。 */
export async function pingGateway(maxTries = 8): Promise<boolean> {
  if (MOCK) {
    $gatewayState.set("open");
    $gatewayError.set(null);
    return true;
  }
  if (probing) {
    // 已有探测在跑：等它出结果（单飞语义），不重复触发任何启动动作
    while (probing) await sleep(250);
    return $gatewayState.get() === "open";
  }
  probing = true;
  $gatewayState.set("connecting");
  $gatewayError.set(null);
  applyDesktopBootProgress({
    error: null,
    fakeMode: false,
    message: "正在连接引擎…",
    phase: "renderer.gateway.connect",
    progress: 80,
    running: true,
    timestamp: Date.now(),
  });
  try {
    // 第一层：sidecar 就绪（Rust spawn → node 起来 → ready 信封）
    bootStep("backend.sidecar", "正在启动 sidecar…", 84);
    let sidecarOk = false;
    for (let i = 0; i < maxTries; i++) {
      try {
        if (await invoke<boolean>("dsh_sidecar_ready")) {
          sidecarOk = true;
          break;
        }
      } catch {
        /* sidecar 尚未注册命令，稍后重试 */
      }
      await sleep(750);
    }
    if (!sidecarOk) {
      $gatewayState.set("error");
      $gatewayError.set("sidecar 未就绪 — 请确认应用日志无 sidecar 启动错误");
      failDesktopBoot("sidecar 未就绪");
      return false;
    }
    // 第二层：引擎 runtime 就绪（Rust setup 已自主预热，这里纯轮询状态）
    bootStep("backend.engine", "正在等待引擎就绪（首次冷启动约 30 秒）…", 88);
    let engineOk = false;
    const deadline = Date.now() + ENGINE_BOOT_WAIT_MS;
    while (Date.now() < deadline) {
      if (await probeEngineReady()) {
        engineOk = true;
        break;
      }
      await sleep(1000);
    }
    if (!engineOk) {
      $gatewayState.set("error");
      $gatewayError.set("引擎启动超时（90s）— 查看应用日志或稍后重试");
      failDesktopBoot("引擎启动超时");
      return false;
    }
    $gatewayState.set("open");
    $gatewayError.set(null);
    completeDesktopBoot("引擎已连接");
    return true;
  } catch (err) {
    $gatewayState.set("error");
    $gatewayError.set(String(err));
    failDesktopBoot(String(err));
    return false;
  } finally {
    probing = false;
  }
}

// ── 断线自愈（hermes reconnect-backoff + 单飞重连模式）─────────────────────

/** 引擎就绪门（登录页"直接进入"/splash 等放行点统一走这里）：
 *  已 open 直接返回；否则 join 正在进行的探测/等待（不重复触发启动——
 *  引擎启动是 Rust setup 的职责，前端只探状态）。 */
export async function ensureGatewayReady(): Promise<boolean> {
  if (MOCK) return true;
  if ($gatewayState.get() === "open") return true;
  return pingGateway();
}

let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
/** 重连首次失败时刻（升级提示计时用；成功重连清零。hermes RECONNECT_ESCALATE_AFTER_MS 语义） */
let reconnectStartedAt = 0;

/** 重连 5 分钟仍失败 → 一条非阻塞升级提示（hermes RECONNECT_ESCALATE_AFTER_MS=300_000）。
 *  聊天保持可读可打字，后台静默重试。 */
const RECONNECT_ESCALATE_AFTER_MS = 300_000;

/** 引擎真探活（hermes liveness-policy 语义：5s 有界 ping 往返，不是 flag 读——
 *  flag 无法发现"进程活着但 event loop 僵死"；RPC 往返超时即视为失联）。 */
async function probeEngineLiveness(): Promise<boolean> {
  try {
    await invoke("get_active_model");
    return true;
  } catch {
    return false;
  }
}

/** 引擎失联（liveness 失败 / dsh_lost 事件）→ 退避重连；boot 已完成时
 *  不弹全屏（hermes"冷启动后永不复活全屏"闩锁语义），只更新状态点；
 *  5 分钟失败升级为一条非阻塞提示。 */
function scheduleReconnect(reason: string): void {
  if (MOCK || reconnectTimer !== null) return;
  if (reconnectStartedAt === 0) reconnectStartedAt = Date.now();
  // 升级提示：每 5 分钟一条（不在 scheduleReconnect 里重复弹，靠此闸门）
  const elapsed = Date.now() - reconnectStartedAt;
  if (elapsed >= RECONNECT_ESCALATE_AFTER_MS && (reconnectAttempt % BOOT_RETRY_MAX_ATTEMPTS === 0)) {
    import("@/lib/notify").then(({ notify }) => {
      notify("与引擎断开较久", "正在后台重试重连，你可以继续浏览和草拟内容。");
    }).catch(() => {});
  }
  const attempt = reconnectAttempt++;
  const delay = reconnectBackoffDelayMs(attempt);
  applyDesktopBootProgress({
    error: null,
    fakeMode: false,
    message: `与引擎断开（${reason}），${Math.round(delay / 100) / 10}s 后重连…`,
    phase: "renderer.reconnect",
    progress: 90,
    running: true,
    timestamp: Date.now(),
  });
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void reconnectGateway().catch(() => {
      // 重连失败 → 继续退避（次数不限，对齐 hermes 后台静默重试）
      scheduleReconnect(reason);
    });
  }, delay);
}

registerGatewayReconnect(async () => {
  $gatewayState.set("connecting");
  try {
    // sidecar 死亡由 Rust 自愈重 spawn + auto prewarm；这里轮询等就绪
    let ok = false;
    const deadline = Date.now() + ENGINE_BOOT_WAIT_MS;
    while (Date.now() < deadline) {
      if (await probeEngineLiveness()) {
        ok = true;
        break;
      }
      await sleep(1000);
    }
    if (!ok) throw new Error("引擎重连超时");
    $gatewayState.set("open");
    $gatewayError.set(null);
    reconnectAttempt = 0;
    reconnectStartedAt = 0;
    completeDesktopBoot("引擎已重连");
  } catch (err) {
    $gatewayState.set("error");
    $gatewayError.set(String(err));
    throw err;
  }
});

/** liveness 探测（composer 发送前/窗口聚焦时调用）：真 RPC 往返（hermes
 *  liveness-policy：5s 有界 ping，flag 读发现不了"活着但僵死"的引擎）。
 *  失联即触发退避重连。 */
export async function ensureEngineAlive(): Promise<boolean> {
  if (MOCK) return true;
  // 快路径：两层 flag 任一为 false → 直接失联（进程没了，无需 5s 往返）
  if (!(await probeEngineReady())) {
    $gatewayState.set("error");
    $gatewayError.set("引擎无响应 — 正在重连");
    scheduleReconnect("引擎无响应");
    return false;
  }
  // 慢路径：flag 为 true 也要真往返（僵死检测）
  if (await probeEngineLiveness()) return true;
  $gatewayState.set("error");
  $gatewayError.set("引擎无响应 — 正在重连");
  scheduleReconnect("引擎无响应");
  return false;
}

// Rust 侧 dsh_lost（sidecar 死亡）→ 触发重连（Rust 自愈会重 spawn +
// auto prewarm，这里把前端状态拉回 connecting 并等 prewarm 重新点亮）
// + 已连接时每 15s 真 RPC 往返探活（网关状态点不能是假按钮）。
// 模块级单例：HMR 重新执行本模块时先注销旧监听/定时器，避免叠加。
let gatewayWatchdogUnlisten: (() => void) | null = null;
let gatewayWatchdogTimer: number | null = null;

if (!MOCK && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen("dsh_lost", () => {
        $gatewayState.set("error");
        $gatewayError.set("sidecar 已退出 — 正在自动恢复");
        scheduleReconnect("sidecar 退出");
      }),
    )
    .then((unlisten) => {
      gatewayWatchdogUnlisten = unlisten;
    })
    .catch(() => {});
  gatewayWatchdogTimer = window.setInterval(() => {
    if ($gatewayState.get() === "open") void ensureEngineAlive();
  }, 15_000);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      gatewayWatchdogUnlisten?.();
      gatewayWatchdogUnlisten = null;
      if (gatewayWatchdogTimer !== null) {
        window.clearInterval(gatewayWatchdogTimer);
        gatewayWatchdogTimer = null;
      }
    });
  }
}
