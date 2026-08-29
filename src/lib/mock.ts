/**
 * 模拟数据总开关
 *
 * VITE_MOCK=0（构建/启动时设置）时关闭演示数据源：
 * - useMockStatus 不再播种 goal/todos/toolCalls/subagent/background
 * - MainPanel 不再生成 400 条假聊天消息（显示空状态占位）
 * - Composer 发送后不再模拟 2.5s busy（等待真实后端响应）
 *
 * 接真实 Mirach 后端时，把启动命令设为 VITE_MOCK=0 并实现
 * src/lib/api/ 下的真实 Adapter（见 docs/api-contract.md）。
 */
export const MOCK = import.meta.env.VITE_MOCK !== "0";
