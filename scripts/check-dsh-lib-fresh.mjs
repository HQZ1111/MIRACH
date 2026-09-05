/**
 * check-dsh-lib-fresh — 官方 lib 产物新鲜度守卫（mirach 侧，官方零改动）
 *
 * mirach 经 node_modules junction 直接消费 packages/<group>/<pkg>/lib 产物
 * （`@deepseek-ai/dsh-*` 的 exports "./client" → lib/client.js）。官方源码
 * 同步（树级 sync / git 操作）只更新 src，lib 是本地构建产物且被 gitignore——
 * 不同步重建就会出现"跑的是旧构建"的静默错位（本文件要拦的正是这个）。
 *
 * 官方仓库没有针对"lib 产物消费者"的现成拦截：官方 web 面从源码现构建
 * （dev-web.ts 三段 watch），门禁（verify-built-package-invariants 等）只验
 * 产物结构不验新旧。故此守卫加在 mirach：vite dev/build 启动时比较每个
 * 官方包 lib 产物与其 src 的最新修改时间，发现陈旧产物 → fail-loud 并给出
 * 修复命令。已知取舍：git 只碰 mtime 不改内容的操作（切分支等）会误报，
 * 重跑一次 build:lib 即解除——宁可误报也不静默跑旧 UI。
 *
 * 用法：node scripts/check-dsh-lib-fresh.mjs [--root <仓库根>]
 * 退出码：0 = 全部新鲜；1 = 发现陈旧产物或缺产物。
 * 注意：本模块会被 vite.config 导入，必须保持导入零副作用——CLI 参数解析
 * 只能发生在 main()（vite 转发过来的 argv 会让顶层 parseArgs 抛错）。
 */

import { existsSync, globSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const mirachRoot = resolve(import.meta.dirname, "..");

/** 最新源码 mtime（src/ 全树递归；无 src 的包返回 0） */
function newestSrcMtime(pkgDir) {
  const srcDir = join(pkgDir, "src");
  if (!existsSync(srcDir)) return 0;
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          const m = statSync(p).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* 文件消失竞态：忽略 */
        }
      }
    }
  };
  walk(srcDir);
  return newest;
}

/** @returns 陈旧条目列表 */
export function findStaleLibs(repoRoot) {
  const root = repoRoot ?? resolve(mirachRoot, "..", "..");
  const stale = [];
  for (const manifestPath of globSync("packages/*/*/package.json", { cwd: root }).sort()) {
    const pkgDir = dirname(join(root, manifestPath));
    const artifacts = [
      ["lib/client.js", join(pkgDir, "lib", "client.js")],
      ["lib/index.js", join(pkgDir, "lib", "index.js")],
    ];
    // 只检查确实有产物的包（没构建过的包不属于"旧构建"）
    if (!artifacts.some(([, p]) => existsSync(p))) continue;
    const newestSrc = newestSrcMtime(pkgDir);
    if (newestSrc === 0) continue;
    for (const [label, artifact] of artifacts) {
      if (!existsSync(artifact)) continue;
      const built = statSync(artifact).mtimeMs;
      if (built < newestSrc) {
        stale.push({
          pkg: manifestPath.split(sep).slice(-3, -1).join("/"),
          reason: `${label} 产物（${new Date(built).toLocaleString()}）旧于 src（${new Date(newestSrc).toLocaleString()}）`,
        });
      }
    }
  }
  return stale;
}

function main() {
  const rootIdx = process.argv.indexOf("--root");
  const rootArg = rootIdx >= 0 ? process.argv[rootIdx + 1] : undefined;
  const stale = findStaleLibs(rootArg ? resolve(rootArg) : undefined);
  if (stale.length === 0) {
    console.log("[dsh-lib-fresh] 官方 lib 产物全部新鲜");
    return;
  }
  console.error(
    [
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "⚠ 官方源码比 lib 产物新 —— 继续运行会打开【旧构建】的官方 UI！",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ...stale.map((s) => `  ${s.pkg}: ${s.reason}`),
      "",
      "修复：在仓库根执行一次官方全量构建，然后重启应用：",
      "  cd G:\\deepseek-harness-master && npm run build:lib",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// 仅作为 CLI 直接运行时执行；被 vite.config 导入时零副作用
const invoked = process.argv[1] ?? "";
if (invoked && resolve(invoked) === fileURLToPath(import.meta.url)) {
  main();
}
