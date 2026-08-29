/**
 * useMockStatus - 播种模拟数据（演示用）
 *
 * 首次挂载时注入 mock goal + todos。
 * VITE_MOCK=0 时跳过（接真实后端后删除此 hook 即可）。
 */

import { useEffect } from "react";
import { addTodo, updateTodoStatus } from "@/store/todos";
import { setGoal } from "@/store/goals";
import { addToolCall } from "@/store/tool-calls";
import { addSubagent } from "@/store/subagents";
import { addBackgroundProcess } from "@/store/background-processes";
import { MOCK } from "@/lib/mock";

let seeded = false;

export function useMockStatus() {
  useEffect(() => {
    if (!MOCK || seeded) return;
    seeded = true;

    // 模拟目标
    setGoal("完成用户认证模块的重构");

    // 模拟待办
    const t1 = addTodo("分析现有认证流程");
    updateTodoStatus(t1, "completed");

    const t2 = addTodo("设计新的 JWT 方案");
    updateTodoStatus(t2, "completed");

    addTodo("实现 token 刷新逻辑");

    const t4 = addTodo("编写单元测试");
    updateTodoStatus(t4, "in_progress");

    addTodo("更新 API 文档");

    // 模拟工具调用
    addToolCall({
      name: "explore",
      category: "explore",
      status: "completed",
      title: "探索项目",
      detail: "列出 24 个文件 · 读取 package.json · 搜索组件引用",
      durationSec: 8,
      completedAt: Date.now() - 60000,
    });

    addToolCall({
      name: "edit_file",
      category: "edit",
      status: "completed",
      title: "编辑文件",
      detail: "修改 src/App.tsx · 更新 index.css · 格式化代码",
      filesChanged: ["src/App.tsx", "index.css"],
      diffStats: { added: 24, removed: 8 },
      durationSec: 5,
      completedAt: Date.now() - 30000,
    });

    // 模拟子代理
    addSubagent("Research Agent", "分析现有代码库", "kimi-k2");

    // 模拟后台进程
    addBackgroundProcess("npm run build");
  }, []);
}
