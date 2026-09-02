const fs = require("fs");
const t = fs.readFileSync("C:/Users/Administrator/.mirach/dsh-plugins/node_modules/dsh-pocket/client/client.js", "utf8");
console.log("== tail ==");
console.log(t.slice(-900));
const a = t.indexOf("apply");
console.log("== first apply at", a, "==");
console.log(t.slice(a - 200, a + 300));
