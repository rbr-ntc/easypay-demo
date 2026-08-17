/** Длительность в человекочитаемом виде: «12:07» или «1 ч 05 м». */
export function fmtDur(ms: number | null): string {
  if (ms === null || ms < 0 || !isFinite(ms)) return '—'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} м`
  return `${m}:${String(sec).padStart(2, '0')}`
}
