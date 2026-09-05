import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { coreAuthCookie } from "./vite-auth-helper.mjs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// B 阶段：核心（profile 模式引擎）的 web 面地址；内核链经 vite 代理同源访问
// @ts-expect-error process is a nodejs global
const core = process.env.MIRACH_CORE_URL ?? "http://127.0.0.1:3212";
// 酒馆插件 client bundle（社区插件装在 ~/.mirach/dsh-plugins，非 workspace 依赖，
// vite 静态解析不到 → 显式别名指向绝对路径；boot.ts 侧载后经 kernel 挂原生面板）
// @ts-expect-error process is a nodejs global
const tavernBundle = path.join(
  process.env.USERPROFILE ?? "",
  ".mirach",
  "dsh-plugins",
  "node_modules",
  "dsh-tavern",
  "lib",
  "client.manager.bundle.js",
);
// dsh-pocket 插件 client bundle（手机扫码访问 DSH；同 tavern 模式侧载）
// @ts-expect-error process is a nodejs global
const pocketBundle = path.join(
  process.env.USERPROFILE ?? "",
  ".mirach",
  "dsh-plugins",
  "node_modules",
  "dsh-pocket",
  "client",
  "client.js",
);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    // ── 官方 lib 产物新鲜度守卫：junction 消费 packages/*/lib，官方 src 同步
    //    后若未重跑 build:lib 会静默打开旧构建。官方无现成消费者门禁 → mirach 侧拦截。
    {
      name: "mirach-dsh-lib-freshness",
      async buildStart() {
        const { findStaleLibs } = await import("./scripts/check-dsh-lib-fresh.mjs");
        const stale = findStaleLibs();
        if (stale.length > 0) {
          const list = stale.map((s) => `  ${s.pkg}: ${s.reason}`).join("\n");
          throw new Error(
            [
              "官方 lib 产物比 src 旧（继续启动会打开旧构建的官方 UI）：",
              list,
              "修复：cd G:\\deepseek-harness-master && npm run build:lib，然后重启。",
            ].join("\n"),
          );
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "dsh-tavern/client": tavernBundle,
      "dsh-pocket/client": pocketBundle,
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and `vendor/`（dsh 引擎 junction）
      ignored: ["**/src-tauri/**", "**/vendor/**"],
    },
    // B 阶段：官方客户端内核（VITE_KERNEL=1）访问核心的 /api 与 /api/remote.mux——
    // dev 期经 vite 代理同源化；发布期由核心 frontend-static 直接服务 mirach dist。
    proxy: {
      "/api": {
        target: core,
        changeOrigin: true, // Host → 核心（信任栅栏 Host 检查通过）
        ws: true,
        // 栅栏还要求 Origin === Host；且 WS 升级需 browserAuth cookie。
        // 代理层统一补齐：Origin 重写 + 按核心 credentials 铸造的鉴权 cookie。
        configure: (proxy) => {
          const fixHeaders = (proxyReq) => {
            proxyReq.setHeader("Origin", core);
            const ck = coreAuthCookie(core);
            if (ck) proxyReq.setHeader("Cookie", ck);
            console.log("[proxy] headers fixed:", proxyReq.path, "cookie=", ck ? "yes" : "NO");
          };
          proxy.on("proxyReq", fixHeaders);
          proxy.on("proxyReqWs", fixHeaders);
        },
      },
      // dsh-pocket 插件的 RPC 通道（手机访问设置页的 status/qr/开关）
      "/dsh-pocket": {
        target: core,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          const fixHeaders = (proxyReq) => {
            proxyReq.setHeader("Origin", core);
            const ck = coreAuthCookie(core);
            if (ck) proxyReq.setHeader("Cookie", ck);
          };
          proxy.on("proxyReq", fixHeaders);
          proxy.on("proxyReqWs", fixHeaders);
        },
      },
    },
  },
  // 依赖扫描只认根入口 index.html：vendor/（dsh 引擎 junction）里也有 html，
  // 默认全盘扫描会把引擎的 apps/web/index.html 误当前端入口
  optimizeDeps: {
    entries: ["index.html"],
  },
  // 4. 分包：把 react/katex/highlight 拆出主包，减小首包体积、利于缓存
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/katex/")) {
            return "katex";
          }
          if (
            id.includes("node_modules/highlight.js/") ||
            id.includes("node_modules/lowlight/")
          ) {
            return "highlight";
          }
        },
      },
    },
  },
}));
