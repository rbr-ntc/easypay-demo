import { useState } from 'react'
import { fmt } from '../../format'
import { Chip, Empty } from '../ui'
import { fetchDecisions, useLoad } from './adminApi'
import { DecisionCard } from './DecisionCard'
import { dayLabel, hm, Loading } from './parts'

/** Долги и решения: всё, что требует действия, и история того, что решили. */
export function Debts() {
  const q = useLoad(fetchDecisions)
  const [tab, setTab] = useState<'open' | 'done'>('open')
  if (!q.data) return <Loading failed={q.failed} />
  const { open, done } = q.data
  const owed = open.filter(i => i.kind === 'debt').reduce((s, i) => s + i.amount, 0)

  return (
    <div className="max-w-[880px]">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip on={tab === 'open'} onClick={() => setTab('open')}>
          Открытые · {open.length}
        </Chip>
        <Chip on={tab === 'done'} onClick={() => setTab('done')}>
          Решённые · {done.length}
        </Chip>
        <span className="flex-1" />
        {owed > 0 && (
          <span className="text-[14px] text-c-mute">
            Гости должны: <b className="c-num text-c-bad-ink">{fmt(owed)}</b>
          </span>
        )}
      </div>

      {tab === 'open' &&
        (open.length === 0 ? (
          <Empty>Всё решено. Новые долги и забытые столы появятся здесь сами.</Empty>
        ) : (
          <div className="flex flex-col gap-2.5">
            {open.map(item => (
              <DecisionCard key={item.id} item={item} onDone={() => void q.reload()} />
            ))}
          </div>
        ))}

      {tab === 'done' &&
        (done.length === 0 ? (
          <Empty>Решений пока не было.</Empty>
        ) : (
          <div className="c-card overflow-hidden">
            {done.map(d => (
              <div key={d.id} className="flex items-start gap-4 border-b border-c-line2 px-4.5 py-3.5 last:border-0">
                <span className="c-num w-28 shrink-0 text-[13px] text-c-mute">
                  {d.at ? `${dayLabel(d.at)}, ${hm(d.at)}` : '—'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold">{d.title}</div>
                  {d.text && <div className="text-[13px] text-c-mute">{d.text}</div>}
                </div>
                {d.amount > 0 && <b className="c-num text-[15px]">{fmt(d.amount)}</b>}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
