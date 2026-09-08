// mirach 适配：hermes 的 @/lib/time 只被 starmap 的 text.ts 用到 fmtDate
// 一个实例——内联同款（日期 only，"5 Jun 2026" 风格 tooltip）。
export const fmtDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
