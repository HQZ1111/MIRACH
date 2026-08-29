import { readFileSync, writeFileSync } from "node:fs";

const p = "src/components/chat/Composer.tsx";
let s = readFileSync(p, "utf8");

const literals = [
  // 剩余 setText("") 全部替换（字符串 replace 只换第一处，改全局正则）
  [/setText\(""\)/g, 'setTextSync("")'],
  // 读值
  [/\btext\.slice\(0, caret\)/g, "textRef.current.slice(0, caret)"],
  [/\btext\.slice\(caret\)/g, "textRef.current.slice(caret)"],
  [/\btext\.startsWith\("\/"\)/g, 'textRef.current.startsWith("/")'],
  [/\btext\.slice\(1\)/g, "textRef.current.slice(1)"],
];

for (const [re, to] of literals) {
  const count = (s.match(re) ?? []).length;
  if (!count) throw new Error(`NOT FOUND: ${re}`);
  s = s.replace(re, to);
}

writeFileSync(p, s, "utf8");
console.log("OK");