/**
 * KernelMirrorHost — 官方根树隐藏宿主（声明链激活器）
 *
 * 官方 SlotCore 的 slot 声明是嵌套 effect：父条目被渲染时 children 声明
 * 才写入 ledger（"a parent entry's children table must declare it"）。官方
 * web 靠 renderSlot('root') 挂载整棵 AppFrame 树；mirach 之前从不挂载——
 * sidebar/settings.section 声明链从未 live，官方设置分区包（settings-
 * general/models/plugins…）的 lazy inject 永远不注册（表现为"官方设置项
 * 没有"）。
 *
 * 本组件把官方根树挂进 display:none 容器（root→sidebar 声明链 live），
 * 随即补登记 mirach 声明骨架（deliverSlotDeclarations：sidebar →
 * sidebar.settings → settings.section，占位组件渲染自己的子槽使声明逐级
 * 落地）——官方设置分区随即注册进 slots，mirach 设置页显示「官方/插件」
 * 分组。整树包错误边界：官方隐藏树任何渲染崩溃只降级声明链，不碰 mirach。
 */

import { Component, useEffect, useState, type ReactNode } from "react";
import { deliverSlotDeclarations, kernelContext, nativeRenderReady, nativeRootTree } from "@/dsh-kernel/boot";

const RETRY_MS = 1500;
const RETRY_MAX = 20;

/** 官方树错误边界：隐藏树内任何渲染崩溃只降级声明链，不打爆 mirach 界面 */
class KernelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[dsh-kernel] hidden official tree crashed (degraded):", err);
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function KernelMirrorHost() {
  const [node, setNode] = useState<ReactNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const attempt = (): void => {
      if (cancelled) return;
      if (!nativeRenderReady()) {
        tries += 1;
        if (tries <= RETRY_MAX) window.setTimeout(attempt, RETRY_MS);
        return;
      }
      const tree = nativeRootTree();
      if (tree !== null) {
        setNode(tree);
        // 官方根树挂载后（root→sidebar 声明写入 ledger），补登记声明骨架
        const ctx = kernelContext();
        if (ctx !== null) deliverSlotDeclarations(ctx);
      }
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, []);

  if (node === null) return null;
  return (
    <KernelBoundary>
      <div data-kernel-mirror aria-hidden style={{ display: "none" }}>
        {node}
      </div>
    </KernelBoundary>
  );
}
