import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { ThemeProvider } from "@/hooks/useTheme";
import { TerminalStatusProvider } from "@/hooks/useTerminalStatus";
import { AppLayout } from "@/components/layout";
import { KernelMirrorHost } from "@/components/layout/KernelMirrorHost";
import { MOCK } from "@/lib/mock";
import { getApi } from "@/lib/api";
import { appendSystemMessage, appendUserMessage, SESSION_ID } from "@/store/chat";
import { initLogger } from "@/lib/logger";
import { initUiSettings } from "@/store/ui-settings";
import { initConversationWidthAutoscale } from "@/lib/conversation-width";
import { notify } from "@/lib/notify";
import { initWindowState, initQuitGuard } from "@/lib/windowState";
import { $bgState, type BackgroundProcess } from "@/store/background-processes";
import { openSessionWindow } from "@/lib/sessionWindow";
import { createUnlistenCollector } from "@/lib/tauri-listen";
import { ResizeHandles } from "@/components/window/ResizeHandles";
import { SetupFlow } from "@/components/setup/SetupFlow";
import { $setupOpen, initBootstrap } from "@/store/bootstrap";
import { useStore } from "@nanostores/react";
import { watchHudState } from "@/store/hud";
// 插件注册（模块导入即注册到 registry）
import "@/plugins/samples/hello";
import "@/plugins/plugin-wake-word";
import "@/plugins/plugin-sound-cues";

/** 后台进程完成/失败 → 桌面通知 */
function NotifyBridge() {
  useEffect(() => {
    const seen = new Set<string>();
    const check = (procs: BackgroundProcess[]) => {
      procs.forEach((p) => {
        if (seen.has(p.id)) return;
        if (p.status === "completed" || p.status === "failed") {
          seen.add(p.id);
          notify(
            p.status === "completed" ? "后台任务完成" : "后台任务失败",
            p.name,
          );
        }
      });
    };
    // 先记录当前已完成进程（不通知历史），再订阅后续变化
    check($bgState.get().processes);
    return $bgState.subscribe((s) => check(s.processes));
  }, []);
  return null;
}

/** 处理 quick entry 提交（全局快捷键迷你窗 → 主窗口 dsh 引擎流式发送） */
function handleQuickSubmit(text: string): void {
  appendUserMessage(text);
  if (MOCK) {
    appendSystemMessage(`（quick entry）已收到：${text.slice(0, 40)}`);
    return;
  }
  // 真实模式：走 dsh 流式通道（与主对话区同管道），完成/失败落一条系统消息
  void getApi()
    .submitPromptStream(SESSION_ID, text, (e) => {
      if (e.type === "message.complete") {
        if (e.text) appendSystemMessage(`⚡ ${e.text.slice(0, 200)}`);
      } else if (e.type === "message.error") {
        appendSystemMessage(`提交失败：${e.message}`);
      }
    })
    .catch(() => appendSystemMessage("提交失败"));
}

/**
 * CrashBoundary — 主界面渲染崩溃的 fail-loud 边界。
 * React 渲染抛错（如 hooks 数量不一致）会让整棵树白屏且没有任何可见线索；
 * 这里显式展示错误 + 组件栈（DEV 下 componentStack 指向出错的组件），不静默。
 */
import { Component, type ReactNode } from "react";

class CrashBoundary extends Component<{ children: ReactNode }, { err: Error | null; info: string }> {
  state = { err: null as Error | null, info: "" };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("[crash-boundary]", err, info.componentStack ?? "(no component stack)");
    this.setState({ info: info.componentStack ?? "" });
  }
  render() {
    if (this.state.err) {
      return (
        <div className="fixed inset-0 z-[999] overflow-auto bg-white p-8 font-mono text-xs text-[#303030]">
          <h1 className="mb-2 text-sm font-bold text-[#EF4444]">界面渲染崩溃（fail-loud）</h1>
          <pre className="whitespace-pre-wrap">{String(this.state.err.stack ?? this.state.err.message).slice(0, 3000)}</pre>
          {this.state.info && <pre className="mt-4 whitespace-pre-wrap text-[11px] text-muted-foreground">Component stack:{this.state.info}</pre>}
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const setupOpen = useStore($setupOpen);
  useEffect(() => {
    // 日志捕获（导出日志弹窗用）
    initLogger();
    // 首次启动安装门（本地依赖缺失时全屏接管）
    void initBootstrap();
    // 对话宽度 CSS 变量初始化（设置-通用设置；参考 zosma chat-width）
    initUiSettings();
    // 对话内容宽随窗口等比缩放（官方偏好为绝对 px，最大化/还原不跟随 + 手柄贴边失效的补丁）
    initConversationWidthAutoscale();
    // 窗口几何持久化 + 关闭确认（仅主窗口）
    void initWindowState();
    void initQuitGuard();
    // HUD 旗标跟随真实窗口（HUD 自己关掉后主窗要归位，否则下次快捷键变"关不掉"）
    const stopHudWatch = watchHudState();
    // quick entry 提交事件
    const subs = createUnlistenCollector();
    void listen<{ text: string }>("quick-entry:submit", (e) => {
      handleQuickSubmit(e.payload.text);
    }).then(subs.track);
    // deep link（hermes:// 协议；Windows 需安装/注册 scheme，不可用时忽略）
    try {
      onOpenUrl((urls) => {
        if (urls[0]) notify("Mirach 链接", urls[0]);
      });
    } catch {
      /* 插件不可用 */
    }
    // ⌘N / Ctrl+Shift+N：打开新实例窗口
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openSessionWindow(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopHudWatch();
      subs.dispose();
    };
  }, []);

  return (
    <ThemeProvider>
      <TerminalStatusProvider>
        <NotifyBridge />
        <ResizeHandles />
        <KernelMirrorHost />
        {setupOpen && <SetupFlow />}
        <CrashBoundary>
          <AppLayout />
        </CrashBoundary>
      </TerminalStatusProvider>
    </ThemeProvider>
  );
}

export default App;
