import { useEffect, useState } from 'react'
import { markReady, subscribeKitchen, takeToWork } from '../kitchenApi'
import type { KitchenPayload } from '../kitchenApi'
import { useStore } from '../store'
import { fmtDur } from '../waiter/duration'
import { Ticket } from './Ticket'
import { summarizeKitchen, ticketState } from '../../shared/kitchen.js'
import { ROLE_LABEL } from '../../shared/roles.js'
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
  const queued = tickets.filter(t => ticketState(t) === 'queued')
  const cooking = tickets.filter(t => ticketState(t) === 'cooking')

  const act = async (ticket: (typeof tickets)[number]) => {
    setBusy(ticket.uid)
    const done = ticket.startedAt
      ? await markReady(ticket.tableId, ticket.uid, ticket.sessionId)
      : await takeToWork(ticket.tableId, ticket.uid, ticket.sessionId)
    if (!done) console.error('действие кухни не прошло')
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
          <div className="ep-k-lane-title">Отменено · снять с плиты</div>
          <div className="ep-k-list">
            {cancelled.map(t => (
              <Ticket key={`c-${t.tableId}-${t.uid}`} ticket={t} now={now} busy={false} onAction={() => {}} />
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
            {queued.map(t => (
              <Ticket key={`${t.tableId}-${t.uid}`} ticket={t} now={now} busy={busy === t.uid} onAction={() => void act(t)} />
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
