/**
 * HeaderRule — 顶部容器底部分割线（描边）
 *
 * 两端各留 15px 空白（inset-x-[15px]），不顶满左右边缘。
 * 配合绝对定位使用：父容器需为 relative，本元素贴在父容器底部。
 */
export function HeaderRule() {
  return <div className="pointer-events-none absolute inset-x-[15px] bottom-0 border-b border-border" />;
}
