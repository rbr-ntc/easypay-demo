import { fmt } from '../format'
import { fmtDur } from './duration'
import type { TableMetrics } from './tableMetrics'

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="ep-w-metric">
      <div className="ep-w-metric-label">{label}</div>
      <div className={accent ? 'ep-w-metric-value ep-w-metric-value--accent' : 'ep-w-metric-value'}>{value}</div>
      {hint && <div className="ep-w-metric-hint">{hint}</div>}
    </div>
  )
}

export function MetricsRow({
  metrics,
  closed,
  guests
}: {
  metrics: TableMetrics
  closed: boolean
  guests: number
}) {
  return (
    <div className="ep-w-metrics">
      <Metric
        label={closed ? 'Стол обслужен за' : 'Стол открыт'}
        value={fmtDur(metrics.tableDur)}
        hint={closed ? 'итог сессии' : 'идёт сейчас'}
        accent={closed}
      />
      <Metric label="До первого заказа" value={fmtDur(metrics.toFirstOrder)} hint="сели → на кухню" />
      <Metric
        label="Кухня, среднее"
        value={fmtDur(metrics.kitchenAvg)}
        hint={metrics.kitchenDoneCount ? `по ${metrics.kitchenDoneCount} поз.` : 'ещё нет поданных'}
      />
      <Metric
        label="Подача → оплата"
        value={fmtDur(metrics.payWait)}
        hint={metrics.payWait === null ? 'после полной оплаты' : 'ожидание денег'}
      />
      <Metric
        label="Темп выручки"
        value={metrics.revPerHour ? `${Math.round(metrics.revPerHour).toLocaleString('ru-RU')} ₽/ч` : '—'}
        hint={metrics.revPerHour ? 'оплачено / время стола' : 'считаем после 10 минут'}
      />
      <Metric
        label="Чек на гостя"
        value={metrics.perGuest ? fmt(metrics.perGuest) : '—'}
        hint={`счёт / ${guests} гост.`}
      />
    </div>
  )
}
