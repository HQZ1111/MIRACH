/**
 * current-view — AppLayout 当前视图（mirach/chat/code/…）的全局镜像
 *
 * AppLayout 的主动视图由它自己的 state 持有；dsh-kernel 侧栏外壳（官方
 * sidebar 槽内的组件）不在 AppLayout 的 React 树里，需要跨树读取当前视图
 * （会话列表的环境过滤/文案标签）。AppLayout 用 useEffect 把 activeView
 * 写入本 store，侧栏外壳用 useStore 订阅。
 */
import { atom } from "nanostores";

/** 当前视图 id（与 AppLayout 的 ViewId 同值域；默认 mirach 主环境） */
export const currentView = atom<string>("mirach");

/** AppLayout 同步 activeView 到全局（useEffect 调用） */
export function setCurrentView(view: string): void {
  currentView.set(view);
}
