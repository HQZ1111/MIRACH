// 主应用不包 StrictMode：其开发期"挂载→卸载→重挂"双跑会释放仍在使用的终端 id
// （unmount cleanup 被伪卸载执行），随后新终端复用该号 → 命名重复/跳号
import "@/lib/migrate-keys";
import ReactDOM from "react-dom/client";
import App from "./App";
import { OverlayApp } from "./components/overlay/OverlayApp";
import { QuickEntryApp } from "./components/quick-entry/QuickEntryApp";
import { LoginPage } from "./components/layout/LoginPage";
import "./index.css";
import { HapticsProvider } from "./hooks/useHaptics";
import { I18nProvider } from "./lib/i18n";

// 覆盖层 webview（overlay-webview）创建时注入了 __OVERLAY_WEBVIEW__ 标记；
// 同一前端 bundle 按标记分流：覆盖层只渲染弹窗页，主窗口渲染完整应用。
const isOverlay =
  (window as { __OVERLAY_WEBVIEW__?: boolean }).__OVERLAY_WEBVIEW__ === true;

// quick entry 迷你窗口（?win=quick-entry）只渲染单输入框
const isQuickEntry =
  new URLSearchParams(window.location.search).get("win") === "quick-entry";

// 登录页独立预览（?win=login）：不启动完整应用，只渲染登录页，方便单独打磨 UI
const isLogin =
  new URLSearchParams(window.location.search).get("win") === "login";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isOverlay ? (
    <OverlayApp />
  ) : isQuickEntry ? (
    <QuickEntryApp />
  ) : isLogin ? (
    <I18nProvider>
      <LoginPage preview />
    </I18nProvider>
  ) : (
    <I18nProvider>
      <HapticsProvider>
        <App />
      </HapticsProvider>
    </I18nProvider>
  ),
);
