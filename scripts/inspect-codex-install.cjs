const fs = require("fs");
// 1) 装到真实 profile 的包：版本 + 是否带 cordis.patch.yml / bundle 清单
const base = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules/@deepseek-ai/dsh-subagent-codex";
console.log("exists:", fs.existsSync(base));
if (fs.existsSync(base)) {
  const pkg = JSON.parse(fs.readFileSync(base + "/package.json", "utf8"));
  console.log("version:", pkg.version);
  console.log("dsh field:", JSON.stringify(pkg.dsh ?? null));
  for (const f of ["cordis.patch.yml", "cordis.yml"]) {
    console.log("-- " + f + ":", fs.existsSync(base + "/" + f) ? fs.readFileSync(base + "/" + f, "utf8").slice(0, 800) : "(none)");
  }
}
// 2) profile 的 patch/依赖现状
const prof = "C:/Users/Administrator/.mirach/profiles/mirach";
console.log("== profile package.json ==");
console.log(fs.readFileSync(prof + "/package.json", "utf8"));
console.log("== profile cordis.patch.yml 尾部 ==");
const patch = fs.readFileSync(prof + "/cordis.patch.yml", "utf8");
console.log(patch.slice(-1200));
