import { readFileSync, writeFileSync } from "node:fs";

// 1) PluginsOverlay: engineFiltered memo + engine tab branch + tab labels
const po = "src/components/overlays/PluginsOverlay.tsx";
let s = readFileSync(po, "utf8");

if (!s.includes("engineFiltered")) {
  const anchor = "  const q = query.trim().toLowerCase();\n";
  if (!s.includes(anchor)) throw new Error("q anchor missing");
  s = s.replace(
    anchor,
    anchor +
      "\n  const engineFiltered = useMemo(() => {\n" +
      "    if (!enginePlugins) return null;\n" +
      "    if (!q) return enginePlugins;\n" +
      "    return enginePlugins.filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));\n" +
      "  }, [enginePlugins, q]);\n",
  );
}

if (!s.includes('"engine"')) {
  const tabsAnchor = '(["installed", "catalog"] as const).map((t) => (';
  if (!s.includes(tabsAnchor)) throw new Error("tabs anchor missing");
  s = s.replace(
    tabsAnchor,
    '(["installed", "catalog", "engine"] as const).map((t) => (',
  );
  const labelAnchor = '{t === "installed" ? `已安装 ${plugins.length}` : "插件目录"}';
  if (!s.includes(labelAnchor)) throw new Error("label anchor missing");
  s = s.replace(
    labelAnchor,
    '{t === "installed" ? `已安装 ${plugins.length}` : t === "catalog" ? "插件目录" : "引擎插件"}',
  );
}

if (!s.includes('tab === "engine"')) {
  const branchAnchor = '<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">\n          {tab === "installed" ? (';
  if (!s.includes(branchAnchor)) throw new Error("branch anchor missing");
  const engineBranch =
    '<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">\n' +
    '          {tab === "engine" ? (\n' +
    '            engineFiltered === null ? (\n' +
    '              <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">正在读取引擎插件…</p>\n' +
    '            ) : engineFiltered.length === 0 ? (\n' +
    '              <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">\n' +
    '                {query ? "没有匹配的插件" : "引擎插件清单为空"}\n' +
    '              </p>\n' +
    '            ) : (\n' +
    '              <div className="space-y-1.5">\n' +
    '                {engineFiltered.map((e) => (\n' +
    '                  <div key={e.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">\n' +
    '                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[#464646]">\n' +
    '                      <Package className="h-4 w-4" strokeWidth={2} />\n' +
    '                    </span>\n' +
    '                    <div className="min-w-0 flex-1">\n' +
    '                      <p className="truncate text-body-sm font-medium text-[#303030]">{e.id}</p>\n' +
    '                      <p className="truncate text-[11px] text-muted-foreground">{e.name}</p>\n' +
    '                    </div>\n' +
    '                    <span className="shrink-0 rounded-full bg-[#6366F1]/10 px-2 py-0.5 text-[10px] text-[#6366F1]">引擎装配</span>\n' +
    '                  </div>\n' +
    '                ))}\n' +
    '              </div>\n' +
    '            )\n' +
    '          ) : tab === "installed" ? (';
  s = s.replace(branchAnchor, engineBranch);
}
writeFileSync(po, s, "utf8");
console.log("PluginsOverlay patched");

// 2) client.ts: MockClient listEnginePlugins
const cl = "src/lib/api/client.ts";
let c = readFileSync(cl, "utf8");
if (!c.includes("listEnginePlugins")) {
  const mockAnchor = '  /** 订阅服务端事件流；返回取消订阅函数 */\n  subscribe(onEvent: (e: MirachEvent) => void): () => void;\n}';
  if (c.includes(mockAnchor)) {
    c = c.replace(
      mockAnchor,
      '  listEnginePlugins(): Promise<{ id: string; name: string }[]> {\n    return Promise.resolve([]);\n  }\n  /** 订阅服务端事件流；返回取消订阅函数 */\n  subscribe(onEvent: (e: MirachEvent) => void): () => void;\n}',
    );
  } else {
    throw new Error("mock anchor missing");
  }
  // RealClient 实现：getDSHModels 方法后面插
  const realAnchor = '  /** dsh 引擎模型目录（sidecar catalog()：内置 deepseek + 设置页配置的提供商） */';
  if (!c.includes(realAnchor)) throw new Error("real anchor missing");
  c = c.replace(
    realAnchor,
    '  /** 引擎插件清单（config.pluginEntries 装配镜像） */\n  async listEnginePlugins(): Promise<{ id: string; name: string }[]> {\n    try {\n      const raw = await invoke<unknown>("relay_rpc", { method: "config.pluginEntries", params: null });\n      const entries = ((raw as { result?: { entries?: unknown[] } } | null)?.result?.entries ?? []) as { id: string; name: string }[];\n      return entries.filter((e) => e && typeof e.id === "string");\n    } catch {\n      return [];\n    }\n  }\n\n' + realAnchor,
  );
  writeFileSync(cl, c, "utf8");
  console.log("client.ts patched");
}
console.log("DONE");