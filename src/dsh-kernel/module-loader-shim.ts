/**
 * dsh-kernel/module-loader-shim — 官方 client 包是 modules 系统 bundle 格式
 * （lib/client.js 首行 `window.__ModuleLoader__.load({id, factory})`，预期经
 * web 启动器的加载器实例化）。本 shim 在任何 bundle import 之前装好这个全局，
 * 收集工厂；boot.ts 用 bundleRequire() 实例化并喂给 cordis。
 * 平台外部依赖（react/cordis/store 等）由 vite 静态导入映射提供；
 * 跨 bundle 引用经 factories 递归实例化。必须最先被 import。
 */
import * as CORDIS from "@deepseek-ai/cordis";
import * as CLIENT_STORE from "@deepseek-ai/dsh-client-store";
import * as UI_SLOTS from "@deepseek-ai/dsh-client-ui-slots";
import * as UI_PRIMITIVES from "@deepseek-ai/dsh-client-ui-primitives";
import * as REACT from "react";
import * as REACT_JSX from "react/jsx-runtime";
import * as REACT_DOM from "react-dom";
import * as REACT_DOM_CLIENT from "react-dom/client";
import * as CLSX from "clsx";

type Factory = (require: (name: string) => unknown) => unknown;

const factories = new Map<string, Factory>();
const cache = new Map<string, unknown>();

const PLATFORM: Record<string, unknown> = {
  "@deepseek-ai/cordis": CORDIS,
  "@deepseek-ai/dsh-client-store": CLIENT_STORE,
  // 官方 bundle 内部组件的平台外部依赖（缺一个内核 boot 即挂）
  "@deepseek-ai/dsh-client-ui-slots": UI_SLOTS,
  "@deepseek-ai/dsh-client-ui-primitives": UI_PRIMITIVES,
  clsx: CLSX,
  react: REACT,
  "react/jsx-runtime": REACT_JSX,
  "react-dom": REACT_DOM,
  "react-dom/client": REACT_DOM_CLIENT,
};

export function registerBundle(id: string, factory: Factory): void {
  factories.set(id, factory);
}

/** 实例化一个（已注册的）bundle，返回其 module.exports。 */
export function bundleRequire(name: string): unknown {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const platformValue = PLATFORM[name];
  if (platformValue !== undefined) return platformValue;
  // bundle 注册 id = 去掉 /client 后缀的包名（官方 stripClientSuffix 语义）
  const stripped = name.replace(/\/client$/, "");
  const factory = factories.get(name) ?? factories.get(stripped);
  if (factory === undefined) {
    throw new Error(`[dsh-kernel] unresolved module require: ${name}; registered=[${[...factories.keys()].join(",")}]`);
  }
  const module = { exports: {} as Record<string, unknown> };
  cache.set(name, module.exports); // 先占位防循环 require 死递归
  const exports = factory((n: string) => bundleRequire(n)) as Record<string, unknown>;
  const finalExports = exports ?? module.exports;
  cache.set(name, finalExports);
  return finalExports;
}

// 全局安装（bundle 文件在 import 时即调用 load）
(window as unknown as { __ModuleLoader__: unknown }).__ModuleLoader__ = {
  mode: "live",
  load: (reg: { id: string; factory: Factory }) => registerBundle(reg.id, reg.factory),
  create: (opts: unknown) => opts,
};
