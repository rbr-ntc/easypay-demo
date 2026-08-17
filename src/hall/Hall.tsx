import { useEffect, useState } from 'react'
import { subscribeHall } from '../hallApi'
import type { HallPayload } from '../hallApi'
import { useStore } from '../store'
import { ManagerLogin } from '../waiter/ManagerLogin'
import { HallSummary } from './HallSummary'
import { TableCard } from './TableCard'
import { describeTable, summarizeHall } from '../../shared/hall.js'
import type { HallCard } from '../../shared/hall.js'
import '../hall.css'

function useNow(stepMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs)
    return () => clearInterval(t)
  }, [stepMs])
  return now
}

function AttentionBar({ cards, now }: { cards: HallCard[]; now: number }) {
  const hot = cards
    .map(card => ({ card, ...describeTable(card, now) }))
    .filter(d => d.alerts.some(a => a.severity === 'warn' || a.severity === 'danger'))
  if (hot.length === 0) return null

  return (
    <div className="ep-h-attention">
      <span className="ep-h-attention-title">Требуют внимания</span>
      {hot.map(({ card, alerts }) => (
        <a
          key={card.id}
          className="ep-h-attention-chip"
          href={`${window.location.pathname}?t=${encodeURIComponent(card.id)}#/waiter`}
        >
          <b>№{card.id}</b> {alerts.map(a => a.label).join(' · ')}
        </a>
      ))}
    </div>
  )
}

// Экран зала: план столов ресторана с живыми статусами и сводкой смены.
export function Hall() {
  const { managerAuthed, checkManager, signOutManager } = useStore()
  const [hall, setHall] = useState<HallPayload | null>(null)
  const [connected, setConnected] = useState(false)
  const now = useNow()

  useEffect(() => {
    void checkManager()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!managerAuthed) return
    return subscribeHall(setHall, setConnected)
  }, [managerAuthed])

  if (managerAuthed === null) {
    return (
      <div className="ep-w-login">
        <div className="ep-w-login-card ep-w-login-hint">Проверяем доступ…</div>
      </div>
    )
  }
  if (!managerAuthed) return <ManagerLogin />

  const cards = hall?.tables ?? []
  // Считаем сводку локально: таймеры и «внимание» так обновляются каждую секунду
  const summary = summarizeHall(cards, hall?.shift ?? null, now)
  const zones = hall?.zones ?? []
  const offPlan = cards.filter(c => !zones.some(z => z.id === c.zoneId))

  return (
    <div className="ep-h">
      <div className="ep-h-top">
        <div className="ep-w-logo">e</div>
        <div>
          <div className="ep-h-title">Зал · {hall?.restaurant ?? '—'}</div>
          <div className="ep-h-sub">
            смена идёт{connected ? '' : ' · нет связи…'}
            {summary.closedTables > 0 ? ` · закрыто столов: ${summary.closedTables}` : ''}
          </div>
        </div>
        <div className="ep-h-spacer" />
        <a className="ep-w-link" href={`${window.location.pathname}#/qr`}>
          QR-коды столов
        </a>
        <button className="ep-w-btn ep-w-btn--quiet" onClick={signOutManager}>
          Выйти
        </button>
      </div>

      <HallSummary summary={summary} />
      <AttentionBar cards={cards} now={now} />

      {!hall && <div className="ep-h-zone ep-h-empty">Загружаем зал…</div>}

      {zones.map(zone => {
        const zoneCards = cards.filter(c => c.zoneId === zone.id)
        if (zoneCards.length === 0) return null
        const busy = zoneCards.filter(c => c.status === 'open').length
        return (
          <div className="ep-h-zone" key={zone.id}>
            <div className="ep-h-zone-title">
              <span className="ep-h-zone-name">{zone.name}</span>
              <span className="ep-h-sub">
                занято {busy} из {zoneCards.length}
              </span>
            </div>
            <div className="ep-h-grid">
              {zoneCards.map(card => (
                <TableCard key={card.id} card={card} now={now} />
              ))}
            </div>
          </div>
        )
      })}

      {offPlan.length > 0 && (
        <div className="ep-h-zone">
          <div className="ep-h-zone-title">
            <span className="ep-h-zone-name">Вне плана зала</span>
            <span className="ep-h-sub">открыты по произвольному QR</span>
          </div>
          <div className="ep-h-grid">
            {offPlan.map(card => (
              <TableCard key={card.id} card={card} now={now} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
