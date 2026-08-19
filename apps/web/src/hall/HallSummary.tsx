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
        hint={`по всему залу · закрыто ${fmt(summary.closedRevenue)}${
          summary.overpaid > 0 ? ` · заработано ${fmt(summary.netRevenue)}` : ''
        } · средний чек ${summary.avgCheck ? fmt(summary.avgCheck) : '—'}`}
        tone="money"
      />
      {summary.debt > 0 && (
        <Stat
          label="Ушли не заплатив"
          value={fmt(summary.debt)}
          hint="столы закрыты с долгом"
          tone="alert"
        />
      )}
      {summary.overpaid > 0 && (
        <Stat label="Переплата" value={fmt(summary.overpaid)} hint="вернуть гостям" tone="alert" />
      )}
      {summary.writtenOff > 0 && (
        <Stat
          label="Списано с кухни"
          value={fmt(summary.writtenOff)}
          hint="еду не отдали — это не долг гостя"
        />
      )}
      {summary.tips > 0 && (
        <Stat label="Чаевые" value={fmt(summary.tips)} hint="официантам, мимо счёта" tone="money" />
      )}
      <Stat
        label="Требуют внимания"
        value={String(summary.attention)}
        hint={summary.attention ? 'столов с просрочкой' : 'всё спокойно'}
        tone={summary.attention ? 'alert' : undefined}
      />
    </div>
  )
}
