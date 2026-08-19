/** Длительность в человекочитаемом виде: «17 мин», «2 мин 30 с», «1 ч 05 м». */
export function fmtDur(ms: number | null): string {
  if (ms === null || ms < 0 || !isFinite(ms)) return '—'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60

  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} м`
  // Раньше здесь было «17:45» — на карточке стола это читалось как время суток,
  // а не как «ждут семнадцать минут». Минуты называем словом.
  if (m > 0) return sec > 0 && m < 3 ? `${m} мин ${sec} с` : `${m} мин`
  return `${sec} с`
}
