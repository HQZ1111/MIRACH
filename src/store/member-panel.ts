/**
 * member-panel — 成员对话面板（子对话栏）的全局开关
 *
 * 成员列表在 dsh-kernel 侧栏外壳内渲染（官方 sidebar 槽），而成员对话面板
 * （MemberChatPanel + ensureMemberThread/历史回放）归属 AppLayout。
 * 通过本 store 跨树桥接：侧栏点击成员 → memberPanelOpenId.set(id)；
 * AppLayout 订阅后打开面板（同一成员再点关闭）；面板关闭 → set(null)。
 */
import { atom } from "nanostores";

/** 当前打开面板的成员 id；null = 面板关闭 */
export const memberPanelOpenId = atom<string | null>(null);

/** 侧栏成员点击：同一成员切换关闭，否则打开 */
export function toggleMemberPanel(id: string): void {
  memberPanelOpenId.set(memberPanelOpenId.get() === id ? null : id);
}

/** 关闭成员对话面板 */
export function closeMemberPanel(): void {
  memberPanelOpenId.set(null);
}
