const fs = require("fs");
const p = "G:/deepseek-harness-master/apps/mirach/src-tauri/tauri.conf.json";
const t = fs.readFileSync(p, "utf8");
if (t.includes("additionalBrowserArgs")) { console.log("already present"); process.exit(0); }
const next = t.replace('"shadow": false\n      }', '"shadow": false,\n        "additionalBrowserArgs": "--remote-debugging-port=9222"\n      }');
if (next === t) { console.log("replace failed"); process.exit(1); }
fs.writeFileSync(p, next);
console.log("port added");
