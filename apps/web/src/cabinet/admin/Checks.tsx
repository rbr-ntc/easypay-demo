import { useMemo, useState } from 'react'
import { fmt } from '../../format'
import { go } from '../route'
import { Chip, Empty } from '../ui'
import { fetchChecks, fetchShifts, useLoad, type CheckRow } from './adminApi'
import { CheckDetail } from './CheckDetail'
import { dayLabel, hm, Loading, StatusTag, type CheckStatus } from './parts'

/**
 * Реестр чеков — по сменам, а не «всё с первого дня». Фильтры отвечают на
 * вопросы сверки: где долг, где возврат, где снимали блюда, что ещё открыто.
 */

type Filter = 'all' | 'debt' | 'refund' | 'cancel' | 'open'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'debt', label: 'Только с долгом' },
  { id: 'refund', label: 'Возвраты' },
  { id: 'cancel', label: 'С отменами' },
  { id: 'open', label: 'Открытые' }
]

export function statusOf(c: CheckRow): CheckStatus {
  if (c.closedAt === null) return 'open'
  if (c.debt - c.settled > 0.01) return 'debt'
  if (c.overpaid > 0.01 || (c.refunded ?? 0) > 0) return 'refund'
  if (c.cancelledTotal > 0) return 'cancel'
  return 'ok'
}

const matches = (c: CheckRow, f: Filter) =>
  f === 'all' ||
  (f === 'open' && c.closedAt === null) ||
  (f === 'debt' && c.debt > 0.01) ||
  (f === 'refund' && (c.overpaid > 0.01 || (c.refunded ?? 0) > 0)) ||
  (f === 'cancel' && c.cancelledTotal > 0)

export function Checks({ shift }: { shift: string | null }) {
  const shiftId = shift ?? 'current'
  const q = useLoad(() => fetchChecks(shiftId), [shiftId])
  const shifts = useLoad(fetchShifts, [], 0)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data?.checks ?? [])
      .filter(c => matches(c, filter))
      .filter(c => !s || c.tableId.toLowerCase() === s || (c.waiter ?? '').toLowerCase().includes(s) || c.lines.some(l => l.name.toLowerCase().includes(s)))
      .sort((a, b) => (b.closedAt ?? Infinity) - (a.closedAt ?? Infinity))
  }, [q.data, filter, search])

  const picked = rows.find(c => c.sessionId === open) ?? null
  const options = [
    ...(shifts.data?.current ? [{ id: 'current', label: `Текущая · с ${hm(shifts.data.current.openedAt)}` }] : []),
    ...(shifts.data?.history ?? []).map(h => ({ id: h.id, label: `${dayLabel(h.openedAt)} · ${hm(h.openedAt)}–${hm(h.closedAt)}` }))
  ]

  return (
    <div className="flex items-start gap-5">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Стол, официант или блюдо"
            aria-label="Поиск по чекам"
            className="h-9 w-60 rounded-full border border-c-line bg-c-card px-3.5 text-[13px] outline-none focus:border-c-ink"
          />
          <select
            value={shiftId}
            onChange={e => go({ ws: 'admin', page: 'checks', sub: e.target.value })}
            aria-label="Смена"
            className="h-9 rounded-full border border-c-line bg-c-card px-3 text-[13px]"
          >
            {options.length === 0 && <option value={shiftId}>Смена</option>}
            {options.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="mx-1 h-5 w-px bg-c-line" />
          {FILTERS.map(f => (
            <Chip key={f.id} on={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </Chip>
          ))}
        </div>

        {!q.data ? (
          <Loading failed={q.failed} />
        ) : rows.length === 0 ? (
          <Empty>{q.data.checks.length ? 'Под фильтр ничего не попало' : 'В этой смене чеков пока нет'}</Empty>
        ) : (
          <div className="c-card overflow-x-auto">
            <table className="w-full min-w-[760px] text-[14px]">
              <thead>
                <tr className="border-b border-c-line text-left text-[12px] text-c-mute">
                  <th className="px-4 py-3 font-bold">Чек</th>
                  <th className="px-4 py-3 font-bold">Стол</th>
                  <th className="px-4 py-3 font-bold">Время</th>
                  <th className="px-4 py-3 font-bold">Официант</th>
                  <th className="px-4 py-3 text-right font-bold">Гостей</th>
                  <th className="px-4 py-3 text-right font-bold">Сумма</th>
                  <th className="px-4 py-3 text-right font-bold">Оплачено</th>
                  <th className="px-4 py-3 font-bold">Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr
                    key={c.sessionId}
                    onClick={() => setOpen(c.sessionId === open ? null : c.sessionId)}
                    aria-selected={c.sessionId === open}
                    className={`cursor-pointer border-b border-c-line2 last:border-0 ${c.sessionId === open ? 'bg-c-chip' : 'hover:bg-c-chip'}`}
                  >
                    <td className="c-num px-4 py-3 font-bold">№ {c.sessionId.slice(0, 6).toUpperCase()}</td>
                    <td className="px-4 py-3">{c.tableId}</td>
                    <td className="c-num px-4 py-3 text-c-mute">
                      {hm(c.openedAt)}–{c.closedAt ? hm(c.closedAt) : '…'}
                    </td>
                    <td className="px-4 py-3">{c.waiter ?? '—'}</td>
                    <td className="c-num px-4 py-3 text-right">{c.guests}</td>
                    <td className="c-num px-4 py-3 text-right font-bold">{fmt(c.total)}</td>
                    <td className="c-num px-4 py-3 text-right">{fmt(c.paid)}</td>
                    <td className="px-4 py-3">
                      <StatusTag status={statusOf(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {picked && <CheckDetail check={picked} status={statusOf(picked)} onClose={() => setOpen(null)} />}
    </div>
  )
}
