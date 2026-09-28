import { useState } from 'react'
import { Chip, Kpi } from '../ui'
import { fetchQuality, useLoad, type QualityPeriod } from './adminApi'
import { Loading } from './parts'
import { ByDay, ByTable, ByWaiter, IndexValue, RatingBar, Remarks } from './QualityParts'

const PERIODS: { id: QualityPeriod; label: string }[] = [
  { id: 'shift', label: 'Смена' },
  { id: 'prev', label: 'Прошлая смена' },
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' }
]

/**
 * Гости и качество: что гости думают о визите и почему. Не KPI для отчёта
 * владельцу, а рабочий инструмент управляющей: где проседает, у кого, что
 * написали гости и что с этим сделали.
 */
export function Quality() {
  const [period, setPeriod] = useState<QualityPeriod>('shift')
  const q = useLoad(() => fetchQuality(period), [period], 30_000)

  return (
    <div className="flex max-w-[1100px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map(p => (
          <Chip key={p.id} on={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Chip>
        ))}
      </div>

      {/* Ответ прошлого периода, пришедший после переключения, не показываем под новой вкладкой */}
      {!q.data || q.data.period !== period ? (
        <Loading failed={q.failed} />
      ) : (
        <Body data={q.data} reload={() => void q.reload()} />
      )}
    </div>
  )
}

function Body({ data, reload }: { data: NonNullable<Awaited<ReturnType<typeof fetchQuality>>>; reload: () => void }) {
  const t = data.report.totals
  return (
    <>
      <section className="c-card p-5.5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Гостей" value={t.guests} hint={`${t.visits} посадок`} />
          <Kpi label="Оценили" value={t.rated} hint={t.responseRate === null ? 'нет гостей' : `${t.responseRate}% гостей`} />
          <Kpi label="Индекс качества" value={<IndexValue index={t.index} />} hint="понравилось − замечания" />
          <Kpi label="Замечаний" value={t.bad} tone={t.openRemarks > 0 ? 'bad' : undefined} hint={t.openRemarks > 0 ? `к разбору отзывов: ${t.openRemarks}` : 'всё разобрано'} />
          <Kpi label="Ответ на вызов" value={t.callAvgSec === null ? '—' : t.callAvgSec < 90 ? `${t.callAvgSec} с` : `${Math.round(t.callAvgSec / 60)} мин`} hint="в среднем" />
          <Kpi label="Кухня → стол" value={t.kitchenAvgMin === null ? '—' : `${t.kitchenAvgMin} мин`} hint="от заказа до подачи" />
        </div>
        <div className="mt-4">
          <RatingBar c={t} />
          <div className="mt-1.5 flex gap-4 text-[12px] text-c-mute">
            <span>понравилось {t.good}</span>
            <span>нормально {t.ok}</span>
            <span>замечаний {t.bad}</span>
            {data.truncated && <span>· показаны последние посадки</span>}
          </div>
        </div>
      </section>

      <Remarks rows={data.report.remarks} onDone={reload} />
      <ByWaiter rows={data.report.byWaiter} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <ByTable rows={data.report.byTable} />
        <ByDay rows={data.report.byDay} />
      </div>
    </>
  )
}
