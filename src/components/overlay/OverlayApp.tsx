/**
 * OverlayApp — 透明覆盖层 webview 的页面入口（仅在 overlay-webview 中渲染）
 *
 * 覆盖层承载浏览器区域弹窗（标签下拉 ▾ / 快速打开 + / 适应窗口下拉），
 * 弹窗渲染在覆盖层里即可真正盖在 native 浏览器 webview 之上（覆盖层在浏览器之后创建，z 序更高）。
 *
 * 与主应用的通信（见 ./events.ts）：
 *   - 主应用 emit("overlay:show", payload) → 渲染对应弹窗
 *   - 主应用 emit("overlay:hide")          → 清空
 *   - 用户操作 → emit("overlay:action", …) → 主应用执行
 *   - 弹窗要关闭（Esc / 失焦 / 点卡片外）→ emit("overlay:close")
 *
 * 本页面 html/body 必须透明（覆盖层 webview 已设 transparent + 透明底色）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { TabsPopup } from "./popups/TabsPopup";
import { ZoomPopup } from "./popups/ZoomPopup";
import { QuickOpenPopup } from "./popups/QuickOpenPopup";
import { OVERLAY_PAD, type OverlayShowPayload } from "./events";

export function OverlayApp() {
  const [popup, setPopup] = useState<OverlayShowPayload | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // 覆盖层页面背景必须透明，才能透出下层内容（浏览器/主应用 DOM）
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // 页面就绪后通知主应用：若弹窗正开着，主应用会重发内容（覆盖"覆盖层 bundle 加载慢于首次弹窗"的竞态）
  useEffect(() => {
    void emit("overlay:ready");
  }, []);

  // 监听主应用事件：show 渲染 / hide 清空
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    void listen<OverlayShowPayload>("overlay:show", (e) => setPopup(e.payload)).then((u) =>
      unsubs.push(u),
    );
    void listen("overlay:hide", () => setPopup(null)).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, []);

  // Esc 关闭；失焦（点击浏览器 webview / 主应用 / 其他窗口）→ 弹窗自动关闭
  useEffect(() => {
    if (!popup) return;
    const close = () => void emit("overlay:close");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // 点卡片外的透明留白（阴影区）→ 关闭（遮罩语义）
    const onDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [popup]);

  // 卡片实际尺寸上报：覆盖层 bounds = 卡片 ± 留白（阴影不裁剪、命中区域贴合）
  const reportSize = useCallback((el: HTMLDivElement) => {
    void invoke("overlay_resize", {
      w: el.offsetWidth + OVERLAY_PAD * 2,
      h: el.offsetHeight + OVERLAY_PAD * 2,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!popup || !cardRef.current) return;
    const el = cardRef.current;
    reportSize(el);
    const ro = new ResizeObserver(() => reportSize(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [popup, reportSize]);

  if (!popup) return null;

  return (
    <>
      {popup.type === "tabs" && popup.tabs && (
        <TabsPopup {...popup.tabs} cardRef={cardRef} />
      )}
      {popup.type === "zoom" && (
        <ZoomPopup percent={popup.zoom?.percent ?? 100} cardRef={cardRef} />
      )}
      {popup.type === "quick" && <QuickOpenPopup cardRef={cardRef} />}
    </>
  );
}
