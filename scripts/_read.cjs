// 模型按钮的图标：ModelSelect.tsx 的 trigger 是否带图标（收起后只剩图标需有图标可显示）
const fs = require("fs");
const s = fs.readFileSync("G:/deepseek-harness-master/packages/client/ui-model-selection/src/client/ModelSelect.tsx", "utf8");
const i = s.indexOf("triggerLabel");
console.log(s.slice(Math.max(0, i - 1400), i + 900));
