# 官方投影面调研备忘（quick notes）

> 补充 official-internals-map.md 的细节。2026-09-05。

## sessions.list 快照字段（api/session-controller/src/list.ts + service.ts:579）

```ts
{
  ids, current, phase,
  byId,                    // SessionSummary（blank/updatedAt/running/title...）
  subagentsByParent,       // Record<dshId, …>（形态演进，防御式计数）
  jobsBySession,           // Record<dshId, SessionJob[]>
  currentAddress,          // 子代理直连地址（kind:'subagent'）
}
```

SessionJob（types.ts:15955 附近）：
`{ id, kind, label, status: 'running'|'stopping'|'completed'|'killed'|'failed', detail?, startedAt, finishedAt? }`

## faceOf 投影 key 全集（全仓 grep 实测）

- `permissions`（ui-permission-presets）
- `modelSelection`（ui-model-selection）
- `goal`（ui-goal）—— mirach GoalBar/StatusWindow 在用

其余数据不是投影：
- 待办 = 会话 input machine 内部（`conversation.composer.dock` 槽 TodoDock 渲染）
- 队列 = input machine（`queues` 在 control baseline 里，UI 无独立面板）
- 后台任务/子代理 = sessions.list 快照（不是投影）

## faceOf 用法

```ts
const face = sessions.binding(dshId)?.session.projections.faceOf('goal');
// face: { getSnapshot(): { goal: {...}|null }, subscribe(fn) }
```

## 官方包一句话定位

- ui-jobs：会话头"后台任务"按钮（读 jobsBySession，零 RPC 零状态）
- ui-subagent：子代理目录 + @ 引用
- ui-goal：输入条上方目标条
- ui-schedule：定时提醒只读目录
- ui-deliverables：回合结束产物行 + 内联文件链接
- ui-workspace：侧栏工作区/会话浏览（WorkspaceBrowser）+ 新任务流（uiWorkspace.startSession）
- ui-sidebar：侧栏壳（新任务按钮 + 折叠 rail 都在这里，不是独立组件）
- ui-layout：三栏 AppFrame（root 槽，折叠后 `data-sidebar-collapsed`）
- ui-conversation：ConversationRoot + InputBar + 输入槽位声明
- ui-renderer / ui-slots：槽位系统（register/inject/renderSlot）
