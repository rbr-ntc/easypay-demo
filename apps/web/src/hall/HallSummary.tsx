import { fmt } from '../format'
import type { HallSummary as Summary } from '@easypay/domain/hall'

function Stat({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: string
  hint?: string
  tone?: 'alert' | 'money'
}) {
  const cls = tone ? `ep-h-stat ep-h-stat--${tone}` : 'ep-h-stat'
  return (
    <div className={cls}>
      <div className="ep-h-stat-label">{label}</div>
      <div className="ep-h-stat-value">{value}</div>
      {hint && <div className="ep-h-stat-hint">{hint}</div>}
    </div>
  )
}

/** Сводка смены: занятость, гости, деньги в работе, кухня, что горит. */
export function HallSummary({ summary }: { summary: Summary }) {
  const load = summary.tables ? Math.round((summary.occupied / summary.tables) * 100) : 0
  return (
    <div className="ep-h-summary">
      <Stat
        label="Занято столов"
        value={`${summary.occupied} / ${summary.tables}`}
        hint={`загрузка ${load}%`}
      />
      <Stat label="Гостей сейчас" value={String(summary.guests)} hint={`посадка ${summary.seatsTotal} мест`} />
      <Stat
        label="В работе"
        value={fmt(summary.openBalance)}
        hint="неоплаченный остаток по открытым"
      />
      <Stat label="На кухне" value={String(summary.kitchenPending)} hint="позиций готовится" />
      <Stat
        label="Выручка смены"
        value={fmt(summary.shiftRevenue)}
        hint={summary.avgCheck ? `средний чек ${fmt(summary.avgCheck)}` : 'средний чек — после закрытий'}
        tone="money"
      />
      <Stat
        label="Требуют внимания"
        value={String(summary.attention)}
        hint={summary.attention ? 'столов с просрочкой' : 'всё спокойно'}
        tone={summary.attention ? 'alert' : undefined}
      />
    </div>
  )
}
