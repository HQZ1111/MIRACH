import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const eng = "G:/mirach/dist-portable/Mirach/runtime/deepseek-harness";
const src = "C:/Users/Administrator/.hermes/dsh-sessions/cordis.generated.yml";
const dst = eng + "/_smoke.yml";

// rewrite absolute engine paths in the generated config to the staging copy
const yml = readFileSync(src, "utf8").replaceAll("D:\\deepseek-harness-master", eng);
writeFileSync(dst, yml, "utf8");

const child = spawn("D:/node.exe", ["--import", "tsx", "packages/examples/jsonrpc-demo/lib/bin.js", dst], {
  cwd: eng,
  stdio: ["pipe", "pipe", "pipe"],
});
let out = "", err = "";
child.stdout.on("data", (c) => (out += c));
child.stderr.on("data", (c) => (err += c));
const timer = setTimeout(() => {
  const alive = child.exitCode === null;
  console.log("SMOKE RESULT:", alive ? "ALIVE (waiting for RPC input = activated)" : "EXITED " + child.exitCode);
  const tail = (err || out).split("\n").filter(Boolean).slice(-12).join("\n");
  console.log("--- last output ---\n" + tail);
  child.kill();
  process.exit(0);
}, 12000);
child.on("exit", (code) => {
  clearTimeout(timer);
  console.log("SMOKE RESULT: EXITED early code=" + code);
  console.log("--- output ---\n" + (err || out).split("\n").filter(Boolean).slice(-15).join("\n"));
  process.exit(0);
});