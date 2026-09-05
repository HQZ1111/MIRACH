/**
 * HeaderRule — 顶部容器底部分割线（描边）
 *
 * 两端各留 15px 空白（inset-x-[15px]），不顶满左右边缘。
 * 配合绝对定位使用：父容器需为 relative，本元素贴在父容器底部。
 * 颜色取灰中深（#D1D5DB）：在 E3E6EC 背景面上仍清晰可辨（border-border
 * 的 #E5E5E5 与 E3E6EC 几乎同色，顶栏下描边会"消失"）。
 */
export function HeaderRule() {
  return <div className="pointer-events-none absolute inset-x-[15px] bottom-0 border-b border-[#D1D5DB]" />;
}
