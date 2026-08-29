import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
