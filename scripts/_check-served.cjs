// 检查 served sidebar-shell 内容
const http = require("http");
http
  .get("http://localhost:1420/src/dsh-kernel/sidebar-shell.tsx", (r) => {
    let d = "";
    r.on("data", (c) => (d += c));
    r.on("end", () => {
      console.log("status", r.statusCode, "len", d.length);
      console.log("has Mirach brand:", d.includes("Mirach"));
      console.log("has 新建任务:", d.includes("新建任务"));
      console.log("has 已置顶会话:", d.includes("已置顶会话"));
      process.exit(0);
    });
  })
  .on("error", (e) => {
    console.log("ERR", e.message);
    process.exit(1);
  });
