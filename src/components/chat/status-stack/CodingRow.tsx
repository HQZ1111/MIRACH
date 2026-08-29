/**
 * CodingRow - Git 编码状态行
 *
 * 当前分支 + +/- 行数 + ahead/behind（只读摘要）。
 * 真实 Git 操作（暂存/提交/推送/PR）已移入顶栏下拉 → Git Review 弹窗，
 * 本行不再内置模拟下拉。
 */

import { GitBranch } from "lucide-react";
import { StatusRow } from "./StatusRow";

export function CodingRow({
  branch = "main",
  added = 0,
  removed = 0,
  ahead = 0,
  behind = 0,
}: {
  branch?: string;
  added?: number;
  removed?: number;
  ahead?: number;
  behind?: number;
}) {
  return (
    <StatusRow
      state="idle"
      icon={<GitBranch className="h-3.5 w-3.5 text-muted-foreground" />}
      title={branch}
      accessory={
        <span className="font-mono">
          <span className="text-green-600">+{added}</span>
          <span className="text-red-500"> -{removed}</span>
          {ahead > 0 && <span className="ml-1">↑{ahead}</span>}
          {behind > 0 && <span className="ml-1">↓{behind}</span>}
        </span>
      }
    />
  );
}
