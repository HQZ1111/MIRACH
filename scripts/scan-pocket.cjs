const fs = require("fs");
const t = fs.readFileSync("C:/Users/Administrator/.mirach/dsh-plugins/node_modules/dsh-pocket/client/client.js", "utf8");
const requires = [...new Set([...t.matchAll(/require\((?:"([^"]+)"|'([^']+)')\)/g)].map((m) => m[1] ?? m[2]))];
console.log("requires:", requires.join(" | "));
// 也看看 load 调用与 setup 形态
const i = t.indexOf("__ModuleLoader__");
console.log(t.slice(i, i + 200));
