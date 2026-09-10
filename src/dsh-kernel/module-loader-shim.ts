/**
 * dsh-kernel/module-loader-shim — 官方 client 模块系统的页面门面（queue 模式）
 *
 * 官方 client 包以 bundle 格式产出（lib/client.js 首行
 * `window.__ModuleLoader__.load({id, factory})`），由官方 HTML 门面
 * （packages/client/modules/src/index.ts → bootInjections 的内联脚本）收集，
 * 再由 `create({boot, staticModules})` 交给官方 ClientModuleSystem 实例化。
 * 本模块按官方门面原样安装 queue 模式全局，boot.ts 在任何 bundle import 之前
 * import 本模块，随后调用 `createModuleSystem()`。
 *
 * 与官方桌面/Web 壳的唯一差异：mirach 的 bundle 由 Vite 在构建期打进应用
 * （静态 import），因此 create() 时所有工厂已入队就绪——官方 loadBundle 永不
 * 被调用，离线可用且无需放宽 CSP（不引入 blob/eval 或外部脚本源）。
 * 模块解析语义（strip /client、重复注册拒绝、require 环检测、样式归属）全部
 * 由官方 ClientModuleSystem 负责，mirach 不再自实现。
 */
import * as CORDIS from "@deepseek-ai/cordis";
import * as CLIENT_STORE from "@deepseek-ai/dsh-client-store";
import * as UI_SLOTS from "@deepseek-ai/dsh-client-ui-slots";
import * as UI_PRIMITIVES from "@deepseek-ai/dsh-client-ui-primitives";
import * as UI_DOCKKIT from "@deepseek-ai/dsh-client-ui-dockkit";
import * as REACT from "react";
import * as REACT_JSX from "react/jsx-runtime";
import * as REACT_DOM from "react-dom";
import * as REACT_DOM_CLIENT from "react-dom/client";
import * as CLSX from "clsx";
import type {
  ClientBundleRegistration,
  ClientModuleLoaderTarget,
  ClientModuleSystem,
  WebBootGraph,
} from "@deepseek-ai/dsh-client-modules/client";

/** 引导模块（模块系统自身）的包名——官方 PARSER_PRELOAD_IDS 同值。 */
export const CLIENT_MODULES_ID = "@deepseek-ai/dsh-client-modules";

/** 平台外部依赖种子表（官方 PLATFORM_MODULES 的超集；漂移守卫见 platform-seed.test.ts）。 */
export const PLATFORM_SEED: Record<string, unknown> = {
  "@deepseek-ai/cordis": CORDIS,
  "@deepseek-ai/dsh-client-store": CLIENT_STORE,
  // 官方 bundle 内部组件的平台外部依赖（缺一个内核 boot 即挂）
  "@deepseek-ai/dsh-client-ui-slots": UI_SLOTS,
  "@deepseek-ai/dsh-client-ui-primitives": UI_PRIMITIVES,
  // 官方右侧栏（ui-sidebar-right）的停靠套件依赖（纯库，非 bundle）
  "@deepseek-ai/dsh-client-ui-dockkit": UI_DOCKKIT,
  clsx: CLSX,
  react: REACT,
  "react/jsx-runtime": REACT_JSX,
  "react-dom": REACT_DOM,
  "react-dom/client": REACT_DOM_CLIENT,
};

/** 图版本：静态 bundle 无 HMR 换代，值只需在会话内稳定。 */
const BOOT_REV = "mirach-static-1";

/** 官方 stripClientSuffix 语义（bundle 注册 id 与图行 id 都去 /client 后缀）。 */
function stripClientSuffix(spec: string): string {
  return spec.endsWith("/client") ? spec.slice(0, -"/client".length) : spec;
}

/**
 * 为已静态注册的 bundle 构造 `__DSH_BOOT__` 图。
 * url 仅为占位：工厂已入队就绪，官方 arrive() 不会触发 loadBundle。
 * 按去后缀 id 去重（引导模块可能同时出现在调用方列表里）。
 */
export function buildBootGraph(ids: readonly string[]): WebBootGraph {
  const seen = new Set<string>();
  const entries = ids.flatMap((raw) => {
    const id = stripClientSuffix(raw);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, url: `mirach-static://${id}`, rev: BOOT_REV, immediately: true }];
  });
  return {
    rev: BOOT_REV,
    entries,
    batches: [
      { phase: "application", url: "mirach-static://bundle", rev: BOOT_REV, entries: entries.map((e) => e.id) },
    ],
  };
}

/**
 * 安装官方 queue 门面（模块副作用，必须最先执行）。
 * create() 的实现逐行对齐官方 HTML 内联脚本：取出引导模块注册项、直接实例化
 * 其工厂（引导例外：加载器不能经自身加载）、校验引导面、委托构造。
 */
(function installModuleLoaderFacade(): void {
  const pendingQueue: ClientBundleRegistration[] = [];
  const facade = {
    mode: "queue" as "queue" | "live",
    pendingQueue,
    load(registration: ClientBundleRegistration): void {
      pendingQueue.push(registration);
    },
    create(options: { boot: unknown; staticModules: Record<string, unknown> }): ClientModuleSystem {
      if (facade.mode !== "queue") {
        throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot");
      }
      const index = pendingQueue.findIndex((registration) => registration.id === CLIENT_MODULES_ID);
      const registration = pendingQueue[index];
      if (registration === undefined) {
        throw new Error(`client-modules: 引导 bundle ${CLIENT_MODULES_ID} 未注册（import 顺序错误？）`);
      }
      pendingQueue.splice(index, 1);
      const exports = registration.factory((specifier: string) => {
        throw new Error(
          `client-modules: ${CLIENT_MODULES_ID}/client.js 在模块系统建立前请求外部依赖 "${specifier}"`,
        );
      }) as { createClientModuleSystem?: unknown; apply?: unknown };
      if (
        typeof exports !== "object" ||
        exports === null ||
        typeof exports.createClientModuleSystem !== "function" ||
        typeof exports.apply !== "function"
      ) {
        throw new Error("client-modules: 引导 bundle 未导出 createClientModuleSystem/apply");
      }
      const create = exports.createClientModuleSystem as (
        target: ClientModuleLoaderTarget,
        bootstrap: { id: string; exports: unknown },
        options: { boot: unknown; staticModules: Record<string, unknown> },
      ) => ClientModuleSystem;
      return create(facade, { id: registration.id, exports }, options);
    },
  };
  (window as unknown as { __ModuleLoader__: ClientModuleLoaderTarget }).__ModuleLoader__ = facade;
})();
