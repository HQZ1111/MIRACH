/**
 * 示例插件 — 演示插件系统贡献点（顶栏工具下拉菜单 + 独立页面路由）
 *
 * viewPage 贡献点：注册一个可路由的独立页面（id plugin-hello）。
 * 插件管理器中点击「打开」→ 主内容区切换到该页面（ViewPages 默认分支解析）。
 */

import { registerPlugin } from "../registry";

function HelloView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-member font-medium text-[#303030]">👋 插件扩展页</p>
      <p className="max-w-sm text-body-sm text-muted-foreground">
        此页面由插件的 viewPage 贡献点渲染（src/plugins/samples/hello.tsx）。
        注册的独立路由页面在 ViewPages 默认分支按 view id 解析。
      </p>
      <p className="text-[11px] text-muted-foreground">
        插件：示例插件 v0.1.0 · 路由：plugin-hello
      </p>
    </div>
  );
}

registerPlugin({
  id: "hello-sample",
  name: "示例插件",
  version: "0.1.0",
  toolMenu: [
    {
      id: "hello",
      label: "示例插件：你好",
      icon: "sparkles",
      run: () => window.alert("你好！这是插件系统骨架的示例插件（src/plugins/samples/hello.tsx）。"),
    },
  ],
  viewPage: {
    id: "plugin-hello",
    label: "示例插件页",
    render: () => <HelloView />,
  },
});
