/**
 * 平台种子表一致性守卫
 *
 * module-loader-shim 的 PLATFORM 表是官方 `PLATFORM_MODULES`
 * （packages/client/web/src/platform.ts：打包外部依赖的共享清单）的手抄副本。
 * 官方新增种子时，这里必须同步，否则官方 bundle 会报 unresolved require。
 * 在官方 workspace 内运行时校验；独立仓库/打包环境自动跳过。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSeedKeys(): string[] {
  const shim = readFileSync(resolve(process.cwd(), "src/dsh-kernel/module-loader-shim.ts"), "utf8");
  const block = shim.match(/PLATFORM_SEED[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (block === null) throw new Error("module-loader-shim.ts 中找不到 PLATFORM 表");
  return [...block[1].matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm)].map(
    (m) => m[1] ?? m[2],
  );
}

describe("platform seed 表", () => {
  it("覆盖官方 PLATFORM_MODULES 的全部条目", () => {
    const official = resolve(process.cwd(), "../../packages/client/web/src/platform.ts");
    if (!existsSync(official)) return; // 独立仓库 / 打包环境：无法读取官方源码
    const source = readFileSync(official, "utf8");
    const block = source.match(/PLATFORM_MODULES\s*=\s*\[([\s\S]*?)\]\s*as const/);
    if (block === null) return;
    const officialNames = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(officialNames.length).toBeGreaterThan(0);
    const seeds = readSeedKeys();
    for (const name of officialNames) {
      expect(seeds, `官方平台模块 ${name} 未在 PLATFORM 表中`).toContain(name);
    }
  });
});
