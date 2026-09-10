// _serve_update.mjs — 静态文件服务器（自更新路径测试用）。
// 用法：node scripts/_serve_update.mjs <dir> <port>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8931);

http
  .createServer((req, res) => {
    const rel = new URL(req.url ?? "/", "http://x").pathname;
    const file = path.join(dir, rel);
    if (file.startsWith(dir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fs.readFileSync(file));
      return;
    }
    res.writeHead(404);
    res.end("nope");
  })
  .listen(port, "127.0.0.1", () => console.error(`serving ${dir} on ${port}`));
