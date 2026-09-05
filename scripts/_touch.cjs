// touch 新文件（网络盘 watcher 失效兜底）
const fs = require("fs");
const now = new Date();
for (const f of [
  "src/dsh-kernel/sidebar-shell.tsx",
  "src/dsh-kernel/boot.ts",
]) {
  try {
    fs.utimesSync(f, now, now);
    console.log("touched", f);
  } catch (e) {
    console.log("touch failed", f, e.message);
  }
}
