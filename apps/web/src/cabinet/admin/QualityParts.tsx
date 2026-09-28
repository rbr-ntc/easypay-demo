import { useState } from 'react'
import type { QualityCounts, QualityRemark, QualityReport } from '@easypay/domain/quality'
import { fmt } from '../../format'
import { useStore } from '../../store'
import { Confirm, Empty, Panel } from '../ui'
import { errorText, resolveRemark } from './adminApi'
import { dayLabel, hm } from './parts'

const RATING = { good: 'Понравилось', ok: 'Нормально', bad: 'Замечание' } as const

/** Индекс словами и цветом: цифра без шкалы ничего не говорит. */
export function IndexValue({ index }: { index: number | null }) {
  if (index === null) return <span className="text-c-mute">—</span>
  const tone = index >= 60 ? 'text-c-ok-ink' : index < 20 ? 'text-c-bad-ink' : ''
  return <span className={`c-num font-bold ${tone}`}>{index > 0 ? `+${index}` : index}</span>
}

/** Полоса «понравилось / нормально / замечание» — видно соотношение, а не три числа. */
export function RatingBar({ c }: { c: QualityCounts }) {
  if (c.rated === 0) return <div className="h-2.5 rounded-full bg-c-chip" />
  const part = (n: number) => `${(n / c.rated) * 100}%`
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-c-chip" aria-label={`понравилось ${c.good}, нормально ${c.ok}, замечаний ${c.bad}`}>
      <span style={{ width: part(c.good), background: '#2E8A55' }} />
      <span style={{ width: part(c.ok), background: '#C9C2B5' }} />
      <span style={{ width: part(c.bad), background: '#C4492B' }} />
    </div>
  )
}

const min = (x: number | null) => (x === null ? '—' : `${x} мин`)
const sec = (x: number | null) => (x === null ? '—' : x < 90 ? `${x} с` : `${Math.round(x / 60)} мин`)
const pct = (x: number | null) => (x === null ? '—' : `${x}%`)

const TH = 'px-3 py-2 text-left text-[12px] font-bold text-c-mute whitespace-nowrap'
const TD = 'px-3 py-2.5 text-[14px] whitespace-nowrap'

export function ByWaiter({ rows }: { rows: QualityReport['byWaiter'] }) {
  return (
    <Panel title="По официантам">
      {rows.length === 0 ? (
        <Empty>Пока нет посадок</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-c-line2">
                <th className={TH}>Официант</th>
                <th className={TH}>Гостей</th>
                <th className={TH}>Оценили</th>
                <th className={TH}>Индекс</th>
                <th className={TH}>Замечаний</th>
                <th className={TH}>Ответ на вызов</th>
                <th className={TH}>Кухня → стол</th>
                <th className={TH}>Чаевые</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(w => (
                <tr key={w.waiterId ?? 'none'} className="border-b border-c-line2 last:border-0">
                  <td className={`${TD} font-bold`}>{w.waiter}</td>
                  <td className={`${TD} c-num`}>{w.guests}</td>
                  <td className={`${TD} c-num`}>
                    {w.rated} <span className="text-c-mute">· {pct(w.responseRate)}</span>
                  </td>
                  <td className={TD}>
                    <IndexValue index={w.index} />
                  </td>
                  <td className={`${TD} c-num ${w.bad > 0 ? 'font-bold text-c-bad-ink' : ''}`}>{w.bad}</td>
                  <td className={`${TD} c-num`}>{sec(w.callAvgSec)}</td>
                  <td className={`${TD} c-num`}>{min(w.kitchenAvgMin)}</td>
                  <td className={`${TD} c-num`}>{fmt(w.tips)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

export function ByTable({ rows }: { rows: QualityReport['byTable'] }) {
  return (
    <Panel title="По столам">
      {rows.length === 0 ? (
        <Empty>Пока нет посадок</Empty>
      ) : (
        rows.slice(0, 12).map(t => (
          <div key={t.tableId} className="flex items-center gap-3 border-b border-c-line2 px-4.5 py-2.5 text-[14px] last:border-0">
            <b className="w-16">Стол {t.tableId}</b>
            <span className="w-24 truncate text-c-mute">{t.zone ?? ''}</span>
            <span className="flex-1">
              <RatingBar c={t} />
            </span>
            <span className="c-num w-20 text-right text-c-mute">{t.guests} гост.</span>
            <span className={`c-num w-12 text-right ${t.bad > 0 ? 'font-bold text-c-bad-ink' : 'text-c-mute'}`}>{t.bad > 0 ? `⚑ ${t.bad}` : ''}</span>
          </div>
        ))
      )}
    </Panel>
  )
}

/** Динамика по дням: индекс и отклик — растёт ли качество, а не как прошёл один вечер. */
export function ByDay({ rows }: { rows: QualityReport['byDay'] }) {
  if (rows.length < 2) return null
  return (
    <Panel title="По дням">
      <div className="flex items-end gap-1.5 overflow-x-auto px-4.5 pt-4 pb-3">
        {rows.map(d => {
          const h = d.index === null ? 4 : Math.max(4, ((d.index + 100) / 200) * 90)
          return (
            <div key={d.day} className="flex min-w-9 flex-1 flex-col items-center gap-1" title={`индекс ${d.index ?? '—'}, отклик ${pct(d.responseRate)}`}>
              <span className="c-num text-[11px] text-c-mute">{d.index === null ? '' : d.index}</span>
              <span className="w-full rounded-t-md" style={{ height: h, background: d.index === null ? '#E6E2DA' : d.index < 20 ? '#D9876F' : '#2E8A55' }} />
              <span className="text-[11px] text-c-mute">{d.day.slice(8)}.{d.day.slice(5, 7)}</span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** Лента замечаний: сначала неразобранные «плохо», у каждого — сигналы визита и «разобрано». */
export function Remarks({ rows, onDone }: { rows: QualityRemark[]; onDone: () => void }) {
  const { toast } = useStore()
  const [open, setOpen] = useState<QualityRemark | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!open || busy) return
    if (text.trim().length < 3) return toast('Напишите, что сделали — это прочтёт владелец')
    setBusy(true)
    const r = await resolveRemark(open.sessionId, open.guestId, text.trim())
    setBusy(false)
    if (!r.ok) return toast(errorText(r))
    toast('Отмечено как разобранное')
    setOpen(null)
    onDone()
  }

  return (
    <Panel title={`Замечания и отзывы с текстом · ${rows.length}`}>
      {rows.length === 0 ? (
        <Empty>Замечаний нет — или гости их не оставляли</Empty>
      ) : (
        rows.map(r => (
          <div key={`${r.sessionId}:${r.guestId}`} className={`border-b border-c-line2 px-4.5 py-3 last:border-0 ${r.resolvedAt ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
              <b className={r.rating === 'bad' ? 'text-c-bad-ink' : ''}>{RATING[r.rating]}</b>
              <span className="text-c-mute">
                {dayLabel(r.at)} {hm(r.at)} · стол {r.tableId} · {r.guest ?? 'гость'}
                {r.waiter ? ` · ${r.waiter}` : ''}
              </span>
              <span className="flex-1" />
            </div>
            {r.note && <div className="mt-1 text-[15px]">«{r.note}»</div>}
            <div className="mt-1 text-[12px] text-c-mute">
              кухня → стол {min(r.kitchenAvgMin)} · ответ на вызов {sec(r.callAvgSec)}
            </div>
            {r.rating === 'good' ? null : r.resolvedAt ? (
              <div className="mt-1.5 text-[13px]">
                ✓ Разобрано{r.resolvedBy ? ` · ${r.resolvedBy}` : ''}: {r.resolution}
              </div>
            ) : (
              <button
                onClick={() => {
                  setText('')
                  setOpen(r)
                }}
                className="mt-2 h-9 rounded-lg border border-c-line px-3 text-[13px] font-bold"
              >
                Разобрано…
              </button>
            )}
          </div>
        ))
      )}
      {open && (
        <Confirm
          title={`Стол ${open.tableId}: что сделали?`}
          ok="Отметить"
          busy={busy}
          onCancel={() => setOpen(null)}
          onOk={() => void save()}
          body={
            <>
              {open.note ? `«${open.note}»` : RATING[open.rating]}
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={3}
                maxLength={300}
                aria-label="Что сделали"
                placeholder="Позвонили, извинились, десерт в подарок в следующий раз"
                className="mt-3 w-full resize-none rounded-xl border border-c-line bg-c-bg p-3 text-[14px] text-c-ink outline-none focus:border-c-ink"
              />
            </>
          }
        />
      )}
    </Panel>
  )
}
