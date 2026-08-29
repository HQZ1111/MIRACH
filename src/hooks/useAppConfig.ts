/**
 * useAppConfig — 读取 Rust 侧应用配置（工作目录 / Mirach 文件夹 / 浏览器首页）
 *
 * 配置解析在 Rust 侧完成（环境变量 → %APPDATA%\my-hermes-rs\config.json → 内置默认值），
 * 前端通过 get_config 命令一次性拉取并缓存。非 Tauri 环境（浏览器调试）回退到默认值。
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  /** 项目工作目录（终端 cwd + Git 审查范围） */
  workspace: string;
  /** Mirach 文件夹（顶栏"打开 Mirach 文件夹"） */
  mirachHome: string;
  /** 浏览器默认首页 */
  browserHome: string;
  /** Agent 引擎地址（hermes-http） */
  engineBase: string;
  /** api_server 基址（8090，cron /api/jobs） */
  apiBase: string;
  /** api_server Bearer token（可选） */
  apiToken: string;
  /** hermes CLI 可执行文件路径（ACP 边车用；留空走 PATH） */
  hermesBin: string;
  /** 应用数据目录（%APPDATA%\my-hermes-rs，日志/配置存放处） */
  dataDir: string;
}

const DEFAULT_CONFIG: AppConfig = {
  workspace: "",
  mirachHome: "",
  browserHome: "https://www.bing.com",
  engineBase: "",
  apiBase: "",
  apiToken: "",
  hermesBin: "",
  dataDir: "",
};

let cache: AppConfig | null = null;

/** 配置变更广播事件（对齐 zosma config-reload：set_config 后通知各消费方自动重拉） */
export const CONFIG_RELOAD_EVENT = "hermes-config-reload";

async function fetchConfig(): Promise<AppConfig> {
  const c = await invoke<AppConfig>("get_config");
  cache = c;
  return c;
}

export function useAppConfig(): { config: AppConfig; reload: () => Promise<void> } {
  const [config, setConfig] = useState<AppConfig>(cache ?? DEFAULT_CONFIG);

  // reload：重拉并广播（通知其它 useAppConfig 实例刷新）
  const reload = useCallback(async () => {
    try {
      const c = await fetchConfig();
      setConfig(c);
      window.dispatchEvent(new Event(CONFIG_RELOAD_EVENT));
    } catch {
      /* 非 Tauri 环境使用默认值 */
    }
  }, []);

  // 监听外部 config-reload → 自动重拉（不重复广播，避免循环）
  useEffect(() => {
    const onReload = () => {
      void fetchConfig()
        .then(setConfig)
        .catch(() => {});
    };
    window.addEventListener(CONFIG_RELOAD_EVENT, onReload);
    return () => window.removeEventListener(CONFIG_RELOAD_EVENT, onReload);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, reload };
}
