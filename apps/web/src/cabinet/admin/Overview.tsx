import { useState } from 'react'
import { fmt, plural } from '../../format'
import { useStore } from '../../store'
import { go, href } from '../route'
import { Empty, Kpi, Panel } from '../ui'
import { errorText, fetchDecisions, fetchShift, fetchShifts, openShift, useLoad } from './adminApi'
import { DecisionCard } from './DecisionCard'
import { dayLabel, hm, HoursChart, Loading, MethodSplit } from './parts'

/**
 * Обзор — X-отчёт идущей смены и очередь «требует решения». Главный вопрос
 * управляющей в течение вечера: сколько заработали и что горит.
 */
export function Overview() {
  const shift = useLoad(fetchShift)
  const queue = useLoad(fetchDecisions)
  const shifts = useLoad(fetchShifts, [], 60_000)

  if (!shift.data) return <Loading failed={shift.failed} />
  const { report: r, shift: s } = shift.data
  const refresh = () => {
    void shift.reload()
    void queue.reload()
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        {s ? (
          <section className="c-card p-5.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13px] font-bold text-c-mute">X-отчёт · смена идёт</span>
              <span className="text-[13px] text-c-mute">
                с {hm(s.openedAt)}
                {s.openedBy ? ` · открыл(а) ${s.openedBy}` : ''}
              </span>
            </div>
            <div className="c-num mt-2 text-[40px] leading-none font-bold">{fmt(r.revenue)}</div>
            <div className="mt-1.5 text-[13px] text-c-mute">
              выручка · чистыми {fmt(r.netRevenue)}
              {r.openRemaining > 0 && ` · ещё ${fmt(r.openRemaining)} ждут оплаты за открытыми столами`}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Чеков" value={r.checks} />
              <Kpi label="Гостей" value={r.guests} />
              <Kpi label="Средний чек" value={fmt(r.avgCheck)} />
              <Kpi label="Чаевые" value={fmt(r.tips)} hint="мимо кассы" />
              <Kpi label="Долг" value={fmt(r.debt)} tone={r.debt > 0 ? 'bad' : undefined} />
              <Kpi label="Открыто" value={`${r.openTables} ${plural(r.openTables, 'стол', 'стола', 'столов')}`} />
            </div>
          </section>
        ) : (
          <ClosedShift onOpened={refresh} lastClosed={shifts.data?.history[0]?.closedAt ?? null} />
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Выручка по часам">
            <div className="p-4.5">
              <HoursChart byHour={r.byHour} />
            </div>
          </Panel>
          <Panel title="Способы оплаты">
            <div className="p-4.5">
              <MethodSplit byMethod={r.byMethod} />
              {r.refunds > 0 && <div className="mt-3 text-[13px] text-c-mute">Возвращено гостям: {fmt(r.refunds)}</div>}
            </div>
          </Panel>
        </div>

        <Panel title="Последние смены" action={<a href={href({ ws: 'admin', page: 'shifts' })} className="text-[13px] font-bold">Все смены →</a>}>
          {shifts.data && shifts.data.history.length > 0 ? (
            shifts.data.history.slice(0, 4).map(h => (
              <a
                key={h.id}
                href={href({ ws: 'admin', page: 'shifts', sub: h.id })}
                className="flex items-center gap-4 border-b border-c-line2 px-4.5 py-3 text-[14px] last:border-0 hover:bg-c-chip"
              >
                <span className="w-32 shrink-0 font-bold">{dayLabel(h.openedAt)}</span>
                <span className="c-num w-28 shrink-0 text-c-mute">
                  {hm(h.openedAt)}–{hm(h.closedAt)}
                </span>
                <span className="flex-1 truncate text-c-mute">{h.summary.checks} чек. · {h.summary.guests} гост.</span>
                {h.summary.diff !== 0 && <span className="text-[12px] font-bold text-c-bad-ink">касса {fmt(h.summary.diff)}</span>}
                <b className="c-num">{fmt(h.summary.revenue)}</b>
              </a>
            ))
          ) : (
            <div className="p-4.5 text-[13px] text-c-mute">Закрытых смен пока нет — первая появится здесь после Z-отчёта.</div>
          )}
        </Panel>
      </div>

      <aside className="flex flex-col gap-3 xl:sticky xl:top-0">
        <div className="flex items-baseline gap-2 px-1">
          <span className="flex-1 text-[15px] font-bold">Требует решения</span>
          {queue.data && queue.data.open.length > 0 && (
            <span className="c-num rounded-full bg-c-bad-bg px-2 text-[13px] font-bold text-c-bad-ink">{queue.data.open.length}</span>
          )}
        </div>
        {!queue.data ? (
          <Loading failed={queue.failed} />
        ) : queue.data.open.length === 0 ? (
          <Empty>Всё решено. Долгов и забытых столов нет.</Empty>
        ) : (
          <>
            {queue.data.open.slice(0, 5).map(item => (
              <DecisionCard key={item.id} item={item} onDone={refresh} compact />
            ))}
            {queue.data.open.length > 5 && (
              <button onClick={() => go({ ws: 'admin', page: 'debts' })} className="h-10 rounded-xl border border-c-line bg-c-card text-[14px]">
                Ещё {queue.data.open.length - 5} →
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

function ClosedShift({ onOpened, lastClosed }: { onOpened: () => void; lastClosed: number | null }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    const r = await openShift()
    setBusy(false)
    if (!r.ok) return toast(errorText(r))
    toast('Смена открыта — столы принимают заказы')
    onOpened()
  }
  return (
    <section className="c-card flex flex-wrap items-center gap-4 p-5.5">
      <div className="min-w-0 flex-1">
        <div className="text-[20px] font-bold">Смена закрыта</div>
        <div className="mt-1 text-[14px] text-c-mute">
          {lastClosed ? `Последняя закрыта в ${hm(lastClosed)}. ` : ''}Пока смена не открыта, новые столы не принимают гостей.
        </div>
      </div>
      <button onClick={open} disabled={busy} className="h-12 rounded-xl bg-c-ink px-5.5 text-[15px] font-bold text-white disabled:opacity-50">
        {busy ? 'Секунду…' : 'Открыть смену'}
      </button>
    </section>
  )
}
