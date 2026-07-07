/** 把 ISO 时间格式化成草稿箱风格的相对时间（刚刚 / N 分钟前 / 今天 14:32 / 昨天 21:07 / 3月5日）。 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 6 * 3_600_000) return `${Math.floor(diff / 3_600_000)} 小时前`;

  const d = new Date(t);
  const n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, n)) return `今天 ${hm}`;
  if (sameDay(d, new Date(now - 86_400_000))) return `昨天 ${hm}`;
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
