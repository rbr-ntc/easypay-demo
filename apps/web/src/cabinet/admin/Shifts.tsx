import { fmt } from '../../format'
import { href } from '../route'
import { Empty, Kpi, Panel } from '../ui'
import { fetchShiftCard, fetchShifts, useLoad, type ShiftRow } from './adminApi'
import { ZTable } from './CloseShift'
import { Bars, dayLabel, hm, HoursChart, Loading } from './parts'

/** Смены: история с Z-отчётами. Строка — сводка, клик — карточка смены. */
export function Shifts({ id }: { id: string | null }) {
  return id ? <ShiftCard id={id} /> : <ShiftList />
}

const COLS = ['Дата', 'Часы', 'Открыл', 'Выручка', 'Чеков', 'Гостей', 'Средний', 'Чаевые', 'Долг', 'Сверка']

function ShiftList() {
  const q = useLoad(fetchShifts, [], 30_000)
  if (!q.data) return <Loading failed={q.failed} />
  const rows: ShiftRow[] = [...(q.data.current ? [q.data.current] : []), ...q.data.history]
  if (rows.length === 0) return <Empty>Смен ещё не было.</Empty>
  return (
    <div className="c-card overflow-x-auto">
      <table className="w-full min-w-[960px] text-[14px]">
        <thead>
          <tr className="border-b border-c-line text-left text-[12px] text-c-mute">
            {COLS.map((c, i) => (
              <th key={c} className={`px-4 py-3 font-bold ${i >= 3 ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr
              key={s.id}
              onClick={() => (window.location.hash = href({ ws: 'admin', page: 'shifts', sub: s.id }))}
              className="cursor-pointer border-b border-c-line2 last:border-0 hover:bg-c-chip"
            >
              <td className="px-4 py-3 font-bold">
                <a href={href({ ws: 'admin', page: 'shifts', sub: s.id })}>{dayLabel(s.openedAt)}</a>
                {s.live && <span className="ml-2 rounded-full bg-c-ok-bg px-2 py-0.5 text-[11px] text-c-ok-fg">идёт</span>}
              </td>
              <td className="c-num px-4 py-3 text-c-mute">
                {hm(s.openedAt)}–{s.closedAt ? hm(s.closedAt) : '…'}
              </td>
              <td className="px-4 py-3">{s.openedBy ?? <span className="text-c-mute">при запуске</span>}</td>
              <td className="c-num px-4 py-3 text-right font-bold">{fmt(s.summary.revenue)}</td>
              <td className="c-num px-4 py-3 text-right">{s.summary.checks}</td>
              <td className="c-num px-4 py-3 text-right">{s.summary.guests}</td>
              <td className="c-num px-4 py-3 text-right">{fmt(s.summary.avgCheck)}</td>
              <td className="c-num px-4 py-3 text-right">{fmt(s.summary.tips)}</td>
              <td className={`c-num px-4 py-3 text-right ${s.summary.debt > 0 ? 'text-c-bad-ink' : ''}`}>{fmt(s.summary.debt)}</td>
              <td className="px-4 py-3 text-right">
                {s.live ? (
                  <span className="text-c-mute">—</span>
                ) : Math.abs(s.summary.diff) < 0.01 ? (
                  <span className="font-bold text-c-ok-ink">✓ сошлась</span>
                ) : (
                  <span className="c-num font-bold text-c-bad-ink">
                    {s.summary.diff > 0 ? '+' : ''}
                    {fmt(s.summary.diff)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ShiftCard({ id }: { id: string }) {
  const q = useLoad(() => fetchShiftCard(id), [id], 0)
  if (!q.data) return <Loading failed={q.failed} />
  const { shift, z, live } = q.data
  if (!z) return <Empty>Отчёт этой смены не сохранился.</Empty>
  const r = z.report

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <a href={href({ ws: 'admin', page: 'shifts' })} className="text-[14px] text-c-mute">
          ← Все смены
        </a>
        <span className="text-[16px] font-bold">
          {dayLabel(shift.openedAt)} · {hm(shift.openedAt)}–{shift.closedAt ? hm(shift.closedAt) : 'идёт'}
        </span>
        <span className="text-[13px] text-c-mute">
          {[shift.openedBy && `открыл(а) ${shift.openedBy}`, shift.closedBy && `закрыл(а) ${shift.closedBy}`].filter(Boolean).join(' · ')}
        </span>
        <span className="flex-1" />
        <a
          href={href({ ws: 'admin', page: 'checks', sub: live ? 'current' : shift.id })}
          className="flex h-10 items-center rounded-xl border border-c-line bg-c-card px-4 text-[14px]"
        >
          Чеки этой смены →
        </a>
        <button onClick={() => window.print()} className="h-10 rounded-xl bg-c-ink px-4 text-[14px] font-bold text-white">
          Распечатать
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Выручка" value={fmt(r.revenue)} />
        <Kpi label="Чеков" value={r.checks} />
        <Kpi label="Гостей" value={r.guests} />
        <Kpi label="Средний чек" value={fmt(r.avgCheck)} />
        <Kpi label="Чаевые" value={fmt(r.tips)} />
        <Kpi label="Долг" value={fmt(r.debt)} tone={r.debt > 0 ? 'bad' : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Выручка по часам">
          <div className="p-4.5">
            <HoursChart byHour={r.byHour} />
          </div>
        </Panel>
        <Panel title="Официанты">
          <div className="p-4.5">
            {r.waiters.length ? (
              <Bars rows={r.waiters.map(w => ({ label: w.name, value: w.revenue, hint: `${w.tables} стол. · чаевые ${fmt(w.tips)}` }))} />
            ) : (
              <div className="text-[13px] text-c-mute">Столы не были закреплены за официантами</div>
            )}
          </div>
        </Panel>
        <DishList title="Чаще всего заказывали" rows={r.top} />
        <DishList title="Реже всего" rows={r.low} />
      </div>

      <ZTable z={z} />
    </div>
  )
}

function DishList({ title, rows }: { title: string; rows: { name: string; qty: number }[] }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <div className="p-4.5 text-[13px] text-c-mute">Нет данных</div>
      ) : (
        rows.map((d, i) => (
          <div key={d.name} className="flex items-center gap-3 border-b border-c-line2 px-4.5 py-2.5 text-[14px] last:border-0">
            <span className="c-num w-5 text-c-mute">{i + 1}</span>
            <span className="flex-1 truncate">{d.name}</span>
            <b className="c-num">{d.qty} шт.</b>
          </div>
        ))
      )}
    </Panel>
  )
}
