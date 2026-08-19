import { useEffect, useState } from 'react'
import { dismissCancelled, markReady, subscribeKitchen, takeToWork } from '../kitchenApi'
import type { KitchenPayload } from '../kitchenApi'
import { useStore } from '../store'
import { fmtDur } from '../waiter/duration'
import { Ticket } from './Ticket'
import { summarizeKitchen, ticketState } from '@easypay/domain/kitchen'
import { ROLE_LABEL } from '@easypay/domain/roles'
import '../kitchen.css'

function Counter({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="ep-k-counter">
      <div className="ep-k-counter-label">{label}</div>
      <div className={alert ? 'ep-k-counter-value ep-k-counter-value--alert' : 'ep-k-counter-value'}>{value}</div>
    </div>
  )
}

// Экран кухни: очередь позиций по всему ресторану, самое старое — сверху.
export function Kitchen() {
  const { staff, signOutStaff, may } = useStore()
  const [data, setData] = useState<KitchenPayload | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => subscribeKitchen(setData, setConnected), [])

  const tickets = data?.tickets ?? []
  const cancelled = data?.cancelled ?? []
  const summary = summarizeKitchen(tickets, now)
  const warn = (data?.summary as any)?.warn ?? 0
  const queued = tickets.filter(t => ticketState(t) === 'queued')
  const cooking = tickets.filter(t => ticketState(t) === 'cooking')

  /**
   * Волна = один стол, одна отправка. Такие позиции обязаны выйти вместе:
   * подать тар-тар, пока лазанья ещё двадцать минут в печи, — испортить стол.
   */
  const byWave = (list: typeof tickets) => {
    const waves = new Map<string, typeof tickets>()
    for (const ticket of list) {
      const key = `${ticket.tableId}:${(ticket as any).waveAt ?? ticket.sentAt}`
      const bucket = waves.get(key)
      if (bucket) bucket.push(ticket)
      else waves.set(key, [ticket])
    }
    return [...waves.entries()].map(([key, items]) => ({ key, items }))
  }

  const act = async (ticket: (typeof tickets)[number]) => {
    setBusy(ticket.uid)
    const done = ticket.startedAt
      ? await markReady(ticket.tableId, ticket.uid, ticket.sessionId)
      : await takeToWork(ticket.tableId, ticket.uid, ticket.sessionId)
    if (!done) console.error('действие кухни не прошло')
    setBusy(null)
  }

  // Отмена уходит с экрана только когда повар подтвердил, что снял блюдо с плиты
  const dismiss = async (ticket: (typeof cancelled)[number]) => {
    setBusy(ticket.uid)
    const done = await dismissCancelled(ticket.tableId, ticket.uid, ticket.sessionId)
    if (!done) console.error('подтверждение отмены не прошло')
    setBusy(null)
  }

  return (
    <div className="ep-k">
      <div className="ep-k-top">
        <div className="ep-w-logo">e</div>
        <div>
          <div className="ep-k-title">Кухня</div>
          <div className="ep-k-sub">
            очередь по всему залу{connected ? '' : ' · нет связи…'}
          </div>
        </div>
        <div className="ep-k-spacer" />
        <div className="ep-k-counters">
          <Counter label="В очереди" value={String(summary.queued)} />
          <Counter label="В работе" value={String(summary.cooking)} />
          <Counter label="Столов" value={String(summary.tables)} />
          <Counter label="Бар" value={String(tickets.filter(t => t.station === 'bar').length)} />
          {/* Жёлтые считались только красными: к моменту сигнала кофе уже нельзя пить */}
          <Counter label="Подгорает" value={String(warn)} alert={warn > 0} />
          <Counter
            label="Самое долгое"
            value={summary.oldestWaitMs === null ? '—' : fmtDur(summary.oldestWaitMs)}
            alert={summary.overdue > 0}
          />
        </div>
        {may('hall') && (
          <a className="ep-w-link" href={`${window.location.pathname}#/hall`}>
            в зал
          </a>
        )}
        <div className="ep-s-who">
          <span className="ep-s-who-name">{staff?.name}</span>
          <span className="ep-s-role">{staff ? ROLE_LABEL[staff.role] : ''}</span>
        </div>
        <button className="ep-w-btn ep-w-btn--quiet" onClick={() => void signOutStaff()}>
          Выйти
        </button>
      </div>

      {cancelled.length > 0 && (
        <div className="ep-k-cancelled">
          <div className="ep-k-lane-title">Отменено · снять с плиты и подтвердить</div>
          <div className="ep-k-list">
            {cancelled.map(t => (
              <Ticket key={`c-${t.tableId}-${t.uid}`} ticket={t} now={now} busy={busy === t.uid} onAction={() => void dismiss(t)} />
            ))}
          </div>
        </div>
      )}

      <div className="ep-k-lanes">
        <div>
          <div className="ep-k-lane-title">
            Очередь <span>{queued.length}</span>
          </div>
          <div className="ep-k-list">
            {byWave(queued).map(wave => (
              <div key={wave.key} className={wave.items.length > 1 ? 'ep-k-wave' : undefined}>
                {wave.items.length > 1 && (
                  <div className="ep-k-wave-head">
                    Стол №{wave.items[0].tableId} · {wave.items.length} поз. · отдавать вместе
                  </div>
                )}
                {wave.items.map(t => (
                  <Ticket key={`${t.tableId}-${t.uid}`} ticket={t} now={now} busy={busy === t.uid} onAction={() => void act(t)} />
                ))}
              </div>
            ))}
            {queued.length === 0 && <div className="ep-k-empty">Новых позиций нет</div>}
          </div>
        </div>

        <div>
          <div className="ep-k-lane-title">
            В работе <span>{cooking.length}</span>
          </div>
          <div className="ep-k-list">
            {cooking.map(t => (
              <Ticket key={`${t.tableId}-${t.uid}`} ticket={t} now={now} busy={busy === t.uid} onAction={() => void act(t)} />
            ))}
            {cooking.length === 0 && <div className="ep-k-empty">Ничего не готовится</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
