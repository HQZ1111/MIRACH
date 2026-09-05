// 找 hooks 崩溃组件：扫描每个组件文件，检查“同一组件函数体内，hook 调用出现在
// 任何 return 语句之后”的情况（更宽松的直接判定），并检查 OfficialWorkspaceBrowser。
const s = require("fs").readFileSync("src/components/layout/LeftSidebar.tsx", "utf8");
const lines = s.split("\n");

// OfficialWorkspaceBrowser 函数体
const owStart = lines.findIndex((l) => l.includes("function OfficialWorkspaceBrowser"));
console.log("OfficialWorkspaceBrowser at", owStart + 1);
let end = lines.length;
for (let j = owStart + 1; j < lines.length; j++) {
  if (/^}/.test(lines[j])) { end = j; break; }
}
for (let i = owStart; i <= end; i++) {
  const l = lines[i];
  if (/use(State|Effect|Store|Memo|Ref|Callback)\(/.test(l)) console.log((i + 1) + " [hook]: " + l.trim().slice(0, 80));
  if (/return\b/.test(l)) console.log((i + 1) + " [ret ]: " + l.trim().slice(0, 80));
}
