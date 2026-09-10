// _find_im_plugin.mjs — 在 npm 上找"通讯/IM"类 dsh 插件（关键字 dsh-plugin）
const QUERIES = [
  "keywords:dsh-plugin im",
  "keywords:dsh-plugin messaging",
  "keywords:dsh-plugin chat",
  "keywords:dsh-plugin telegram",
  "dsh-im",
];

const seen = new Map();
for (const q of QUERIES) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=50`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.log(`query "${q}" -> HTTP ${res.status}`);
      continue;
    }
    const j = await res.json();
    for (const o of j.objects ?? []) {
      const p = o.package ?? {};
      if (!seen.has(p.name)) {
        seen.set(p.name, {
          version: p.version,
          description: (p.description ?? "").slice(0, 110),
          keywords: (p.keywords ?? []).join(","),
          date: o.updated ?? "",
        });
      }
    }
  } catch (e) {
    console.log(`query "${q}" -> ERR ${e.message}`);
  }
}
console.log(`--- ${seen.size} unique packages ---`);
for (const [name, info] of [...seen.entries()].sort()) {
  const looksIm = /im$|instant|messag|telegram|wechat|weixin|chat|bot|qq|dingtalk|feishu/i.test(
    name + " " + info.description + " " + info.keywords,
  );
  console.log(`${looksIm ? "*" : " "} ${name}@${info.version} — ${info.description}`);
}
