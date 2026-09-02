const fs = require("fs");
const t = fs.readFileSync("C:/Users/Administrator/.mirach/dsh-plugins/node_modules/dsh-pocket/client/client.js", "utf8");
// zh2 词典定义形态
const i = t.indexOf("subtitle");
console.log(t.slice(Math.max(0, i - 400), i + 300));
