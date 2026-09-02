const { execSync } = require("child_process");
const opt = { cwd: "G:/deepseek-harness-master", encoding: "utf8" };
try { console.log("HEAD:", execSync("git log --oneline -2", opt).trim()); } catch (e) { console.log("log ERR"); }
try { console.log("status:", execSync("git status --short | Select-Object -First 3", opt).trim().slice(0, 300) || "(clean)"); } catch {}
