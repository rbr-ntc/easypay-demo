import { fmt } from '../format'
import { fmtDur } from './duration'
import type { TableMetrics } from './tableMetrics'

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="stat px-3 py-2">
      <div className="stat-title text-xs">{label}</div>
      <div className={`stat-value text-xl ${accent ? 'text-success' : ''}`}>{value}</div>
      {hint && <div className="stat-desc">{hint}</div>}
    </div>
  )
}

export function MetricsRow({
  metrics,
  closed,
  guests,
  tipsTotal
}: {
  metrics: TableMetrics
  closed: boolean
  guests: number
  tipsTotal: number
}) {
  return (
    <div className="stats stats-vertical w-full bg-base-100 sm:stats-horizontal">
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
      <Metric
        label="Чаевые"
        value={tipsTotal > 0 ? fmt(tipsTotal) : '—'}
        hint="напрямую официанту"
        accent={tipsTotal > 0}
      />
    </div>
  )
}
