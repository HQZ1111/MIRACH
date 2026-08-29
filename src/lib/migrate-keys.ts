/**
 * migrate-keys — 一次性 localStorage 键名迁移（hermes.* → mirach.*）
 *
 * 软件由 Mirach 更名 Mirach（2026-08-28）：所有持久化键统一前缀。本模块必须
 * 先于任何 store 模块求值（main.tsx 首个 import），把旧键值拷到新键后删除旧键；
 * 幂等——新键已存在时只清旧键，绝不覆盖新数据。
 */

const LEGACY = "hermes.";
const CURRENT = "mirach.";

export function migrateLegacyKeys(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LEGACY)) continue;
      const next = CURRENT + key.slice(LEGACY.length);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(next) === null) {
        localStorage.setItem(next, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    /* 隐私模式等：迁移失败静默，各 store 走默认值 */
  }
}

migrateLegacyKeys();
