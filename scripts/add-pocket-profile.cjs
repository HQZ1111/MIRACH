const fs = require("fs");
const p = "C:/Users/Administrator/.mirach/profiles/mirach/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (!j.dependencies["dsh-pocket"]) j.dependencies["dsh-pocket"] = "^2.10.0";
if (!j.dsh.profile.bundles.includes("dsh-pocket")) j.dsh.profile.bundles.push("dsh-pocket");
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("profile manifest updated:", JSON.stringify(j.dsh.profile.bundles));
