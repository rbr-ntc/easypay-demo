import { href } from '../route'
import { Empty, Panel } from '../ui'
import { fetchChecks, useLoad } from './adminApi'
import { hm } from './parts'

const LABEL = {
  good: 'Понравилось',
  ok: 'Нормально',
  bad: 'Замечание'
} as const

/**
 * Что гости написали за смену: замечания сверху. Раньше «замечаний 1» в обзоре
 * было числом без содержания — текст жил только в журнале и в карточке чека
 * (смена №6, О2). Полный раздел «Гости и качество» — отдельной задачей.
 */
export function RatingsFeed() {
  const checks = useLoad(() => fetchChecks('current'), [], 30_000)
  const rows = (checks.data?.checks ?? [])
    .flatMap(c =>
      (c.ratings ?? []).map(r => ({
        ...r,
        tableId: c.tableId,
        waiter: c.waiter,
        at: c.closedAt ?? c.openedAt
      }))
    )
    .sort((a, b) => Number(b.rating === 'bad') - Number(a.rating === 'bad') || b.at - a.at)

  return (
    <Panel
      title={`Отзывы гостей за смену · ${rows.length}`}
      action={
        <a href={href({ ws: 'admin', page: 'checks', sub: 'current' })} className="text-[13px] font-bold">
          Чеки →
        </a>
      }
    >
      {rows.length === 0 ? (
        <Empty>Гости пока не оставили оценок</Empty>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="flex gap-3 border-b border-c-line2 px-4.5 py-2.5 text-[14px] last:border-0">
            <span className="c-num w-12 shrink-0 text-c-mute">{hm(r.at)}</span>
            <span className="min-w-0 flex-1">
              <b className={r.rating === 'bad' ? 'text-c-bad-ink' : ''}>{LABEL[r.rating]}</b>
              <span className="text-c-mute">
                {' '}
                · стол {r.tableId} · {r.guest ?? 'гость'}
                {r.waiter ? ` · ${r.waiter}` : ''}
              </span>
              {r.note && <span className="mt-0.5 block">«{r.note}»</span>}
            </span>
          </div>
        ))
      )}
    </Panel>
  )
}
