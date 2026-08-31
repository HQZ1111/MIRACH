/**
 * paths — 前端侧用户目录/固定路径推导
 *
 * 主目录从 get_config().data_dir（%APPDATA%\<app>）上溯三级推得，
 * 避免为每个需求单独加 Rust 命令。非 Tauri 环境返回 null。
 */

import { invoke } from "@tauri-apps/api/core";

/** 用户主目录（C:\Users\<user>）；非 Tauri/解析失败返回 null */
export async function userHomeDir(): Promise<string | null> {
  try {
    const cfg = await invoke<{ data_dir: string }>("get_config");
    const parts = cfg.data_dir.replace(/\//g, "\\").split("\\").filter(Boolean);
    if (parts.length < 4) return null;
    return parts.slice(0, parts.length - 3).join("\\"); // 去掉 AppData\Roaming\<app>
  } catch {
    return null;
  }
}
