const fs = require("fs");
const p = "G:/deepseek-harness-master/apps/mirach/src/components/settings/AgentTeam.tsx";
let lines = fs.readFileSync(p, "utf8").split("\n");
// 删 1 基 61..126（NativeTavernPanel 注释/令牌再导出/CSS/组件）
lines.splice(60, 126 - 61 + 1);
let t = lines.join("\n");
// 删使用块（isChat && NativeTavernPanel）
t = t.replace(`      {/* 聊天环境：原生酒馆面板置于智能体上方 */}
      {isChat && (
        <div className="mb-3">
          <NativeTavernPanel />
        </div>
      )}

`, "");
// 清导入
t = t.replace(`import { nativeTavernSection } from "@/dsh-kernel/boot";
import { OfficialEntry, type OfficialEntryLike } from "@/components/settings/OfficialContent";
`, "");
t = t.replace(`export { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";
import { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";
`, "");
fs.writeFileSync(p, t);
console.log("AgentTeam cleaned; lines:", t.split("\n").length);
// 检查残留
if (/NativeTavernPanel|OfficialEntry|DSW_ALIAS_VARS|nativeTavernSection/.test(t)) console.log("⚠ 残留引用存在");
else console.log("无残留");
