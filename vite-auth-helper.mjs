/**
 * vite-auth-helper — vite.config 用的核心鉴权 cookie 助手（薄封装）。
 * 实现在 agent-sidecar/src/dsh-auth.mjs（sidecar 与 vite 共用的唯一实现；
 * 随 sidecar 预编译一起进 dist，升级检查点见该文件头）。
 */
import { browserAuthCookie } from "./agent-sidecar/src/dsh-auth.mjs";

export function coreAuthCookie(coreUrl) {
  return browserAuthCookie(coreUrl);
}
