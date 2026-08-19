import { useEffect, useState } from 'react'
import { subscribeHall } from '../hallApi'
import type { HallPayload } from '../hallApi'
import { useStore } from '../store'
import { HallSummary } from './HallSummary'
import { ShiftLog } from './ShiftLog'
import { TableCard } from './TableCard'
import { describeTable, summarizeHall } from '@easypay/domain/hall'
import { fmtDur } from '../waiter/duration'
import { getStaffToken } from '../staff'
import type { HallCard } from '@easypay/domain/hall'
import { ownsTable, ROLE_LABEL } from '@easypay/domain/roles'
import '../hall.css'

function useNow(stepMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs)
    return () => clearInterval(t)
  }, [stepMs])
  return now
}

function AttentionBar({ cards, now, onAck }: { cards: HallCard[]; now: number; onAck: (id: string, callId?: string) => void }) {
  const hot = cards
    .map(card => ({ card, ...describeTable(card, now) }))
    .filter(d => d.alerts.some(a => a.severity === 'warn' || a.severity === 'danger'))
    // Кто ждёт дольше — тот первый: срочность важнее номера стола
    .sort((a, b) => {
      const worst = (d: typeof a) => (d.alerts.some(x => x.severity === 'danger') ? 0 : 1)
      const oldest = (d: typeof a) => Math.min(...d.alerts.map(x => x.since ?? now))
      return worst(a) - worst(b) || oldest(a) - oldest(b)
    })
  if (hot.length === 0) return null

  return (
    <div className="ep-h-attention">
      <span className="ep-h-attention-title">Требуют внимания</span>
      {hot.map(({ card, alerts }) => (
        <span key={card.id} className="ep-h-attention-item">
          {card.call && (
            <button
              className="ep-h-ack"
              title="Сказать гостю «иду»"
              onClick={() => void onAck(card.id, card.call?.id)}
            >
              Иду
            </button>
          )}
          <a
            className="ep-h-attention-chip"
            href={`${window.location.pathname}?t=${encodeURIComponent(card.id)}#/waiter`}
          >
          <b>№{card.id}</b> {alerts.map(a => a.label).join(' · ')}
          {(card.calls ?? 0) > 1 && <span className="ep-h-attention-more">+{(card.calls ?? 1) - 1}</span>}
          {(() => {
            // Возраст ожидания прямо на чипе: без него все вызовы одинаковые
            const since = Math.min(...alerts.map(a => a.since ?? now))
            return Number.isFinite(since) && since < now ? (
              <span className="ep-h-attention-age">{fmtDur(now - since)}</span>
            ) : null
          })()}
          </a>
        </span>
      ))}
    </div>
  )
}

// Экран зала: план столов ресторана с живыми статусами и сводкой смены.
export function Hall() {
  const { staff, signOutStaff, may, shiftTips } = useStore()
  const [hall, setHall] = useState<HallPayload | null>(null)
  const [connected, setConnected] = useState(false)
  const [onlyMine, setOnlyMine] = useState(staff?.role === 'waiter')
  const now = useNow()

  useEffect(() => subscribeHall(setHall, setConnected), [])

  const allCards = hall?.tables ?? []
  const hasOwnTables = (staff?.tables ?? []).length > 0
  const cards = onlyMine && hasOwnTables ? allCards.filter(c => ownsTable(staff, c.id)) : allCards
  // Считаем сводку локально: таймеры и «внимание» так обновляются каждую секунду
  const summary = summarizeHall(cards, hall?.shift ?? null, now)

  /** «Иду» можно сказать прямо из зала: раньше за этим шли на экран стола. */
  const ack = async (id: string, callId?: string) => {
    try {
      await fetch(`/api/t/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-token': getStaffToken() },
        body: JSON.stringify({ callId })
      })
    } catch (err) {
      console.error('не удалось снять вызов:', err)
    }
  }

  /** Стол убран — это факт от человека, а не истёкшие пять минут. */
  const clean = async (id: string) => {
    try {
      await fetch(`/api/t/${encodeURIComponent(id)}/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-token': getStaffToken() },
        body: '{}'
      })
    } catch (err) {
      console.error('не удалось отметить уборку:', err)
    }
  }
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
            {shiftTips > 0 ? ` · ваши чаевые: ${Math.round(shiftTips)} ₽` : ''}
          </div>
        </div>
        <div className="ep-h-spacer" />

        {hasOwnTables && (
          <button className="ep-w-btn ep-w-btn--quiet" onClick={() => setOnlyMine(!onlyMine)}>
            {onlyMine ? 'Показать весь зал' : 'Только мои столы'}
          </button>
        )}
        {may('kitchen') && (
          <a className="ep-w-link" href={`${window.location.pathname}#/kitchen`}>
            Кухня{summary.kitchenPending > 0 ? ` · ${summary.kitchenPending}` : ''}
          </a>
        )}
        <a className="ep-w-link" href={`${window.location.pathname}#/qr`}>
          QR-коды столов
        </a>
        <div className="ep-s-who">
          <span className="ep-s-who-name">{staff?.name}</span>
          <span className="ep-s-role">{staff ? ROLE_LABEL[staff.role] : ''}</span>
        </div>
        <button className="ep-w-btn ep-w-btn--quiet" onClick={() => void signOutStaff()}>
          Выйти
        </button>
      </div>

      <HallSummary summary={summary} />
      <AttentionBar cards={cards} now={now} onAck={ack} />

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
                <TableCard key={card.id} card={card} now={now} onClean={clean} mine={ownsTable(staff, card.id)} />
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
              <TableCard key={card.id} card={card} now={now} mine={ownsTable(staff, card.id)} />
            ))}
          </div>
        </div>
      )}

      {may('log') && <ShiftLog />}
    </div>
  )
}
