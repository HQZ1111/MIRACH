const fs = require('fs');
const path = require('path');
const base = 'G:/deepseek-harness-master/packages/client';
let scanned = 0;
const hits = [];
for (const pkg of fs.readdirSync(base)) {
  const src = path.join(base, pkg, 'src');
  if (!fs.existsSync(src)) continue;
  const files = [];
  (function walk(d) {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const f of es) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else files.push(p);
    }
  })(src);
  for (const p of files) {
    if (!/\.(ts|tsx)$/.test(p)) continue;
    let s = '';
    try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
    scanned++;
    if (s.includes('input.plan')) hits.push(p);
  }
}
console.log('scanned', scanned);
console.log(hits.join('\n'));
