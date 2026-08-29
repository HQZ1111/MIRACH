/**
 * TerminalSection — 底部 PowerShell 终端
 *
 * 通过 Tauri 命令与 Rust 侧 portable-pty 桥接：
 * - open_terminal：启动 powershell.exe（工作目录 = hermes 文件夹）
 * - terminal-output 事件：Rust 推送 PowerShell 输出 → xterm 渲染
 * - terminal_write：xterm 输入 → 写入 pty stdin
 * - terminal_resize：窗口尺寸变化 → pty resize
 *
 * 渲染修复（参考 hermes-agent-main apps/desktop 终端做法）：
 * - 创建前预热等宽字体（document.fonts.load），避免 fallback 字体
 *   被烘进字符缓存导致渲染错乱（选中重绘后"恢复正常"的症状即由此而来）
 * - open + fit 后强制全量重绘 term.refresh(0, rows-1)
 * - ResizeObserver 通过 rAF 合并，避免过渡期同步 fit 抖动渲染器
 */

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 终端配色跟随应用主题：背景透明，透出面板底色（浅色白 / 深色 #202020），
 *  前景/光标随主题切换保证可读。透明需配合 allowTransparency: true——
 *  默认 false 会把背景色强制转不透明。 */
function terminalTheme(dark: boolean) {
  return dark
    ? {
        background: "rgba(0, 0, 0, 0)",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#3a3a3a",
      }
    : {
        background: "rgba(0, 0, 0, 0)",
        foreground: "#1f1f1f",
        cursor: "#1f1f1f",
        selectionBackground: "#d4d4d4",
      };
}

export function TerminalSection({ terminalId = "Powershell01" }: { terminalId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let ro: ResizeObserver | undefined;
    let rafId: number | undefined;
    let dataDisposable: { dispose: () => void } | undefined;
    let term: XTerm | undefined;
    let fit: FitAddon | undefined;
    let mo: MutationObserver | undefined;

    (async () => {
      // 预热等宽字体，确保字符宽度测量使用真实字体而非 fallback
      try {
        await Promise.all([
          document.fonts.load('12px "Cascadia Code"'),
          document.fonts.load("12px Consolas"),
          document.fonts.load('bold 12px "Cascadia Code"'),
          document.fonts.load("bold 12px Consolas"),
        ]);
        await document.fonts.ready;
      } catch {
        /* 忽略字体加载异常 */
      }
      if (disposed) return;

      term = new XTerm({
        fontSize: 12,
        // Windows 11 自带 Cascadia Code（Windows Terminal 字体），优先于 Consolas
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        lineHeight: 1.5,
        letterSpacing: 0,
        fontWeight: "normal",
        fontWeightBold: "bold",
        // 允许透明背景（默认 false：渲染器会把背景色强制不透明，画布成实心色块）
        allowTransparency: true,
        theme: terminalTheme(document.documentElement.classList.contains("dark")),
        cursorBlink: true,
        scrollback: 2000,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);

      // WebGL 渲染器（原型桌面版做法）：字形图集重建干净，
      // 避免 canvas 渲染器特定字形（a/e/标点）烘错后"选中重绘才正常"的问题；
      // WebGL 不可用时回退 canvas
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
        });
        term.loadAddon(webgl);
      } catch (err) {
        console.warn("[hermes-terminal] WebGL unavailable; falling back to canvas", err);
      }

      fit.fit();

      // 强制全量重绘：字体就绪后刷新画布，消除 fallback 渲染错乱
      term.refresh(0, term.rows - 1);

      // 跟随应用深浅色主题：html.dark 切换时更新 xterm 配色并重绘
      mo = new MutationObserver(() => {
        const t = term;
        if (!t) return;
        t.options.theme = terminalTheme(
          document.documentElement.classList.contains("dark"),
        );
        t.refresh(0, t.rows - 1);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

      try {
        // 先注册监听再启动终端，避免丢失启动初期的输出
        const un = await listen<{ id: string; data: string }>("terminal-output", (e) => {
          if (e.payload.id === terminalId) term?.write(e.payload.data);
        });
        if (disposed) {
          un();
          return;
        }
        unlisten = un;
        await invoke("open_terminal", { id: terminalId });
      } catch (err) {
        term?.writeln(`\r\n\x1b[31m[hermes] 无法启动 PowerShell: ${String(err)}\x1b[0m`);
      }

      // 键盘输入 → 写入 pty
      dataDisposable = term?.onData((data) => {
        invoke("terminal_write", { id: terminalId, data }).catch(() => {});
      });

      // 尺寸变化 → rAF 合并后 fit + pty resize（避免过渡期抖动）
      const resize = () => {
        if (rafId !== undefined) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          fit?.fit();
          invoke("terminal_resize", {
            id: terminalId,
            rows: term?.rows ?? 24,
            cols: term?.cols ?? 80,
          }).catch(() => {});
        });
      };
      ro = new ResizeObserver(resize);
      ro.observe(container);
    })();

    return () => {
      disposed = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      unlisten?.();
      ro?.disconnect();
      mo?.disconnect();
      dataDisposable?.dispose();
      invoke("close_terminal", { id: terminalId }).catch(() => {});
      term?.dispose();
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
    />
  );
}
