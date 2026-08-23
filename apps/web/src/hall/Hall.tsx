import { useEffect, useState } from 'react'
import { subscribeHall } from '../hallApi'
import type { HallPayload } from '../hallApi'
import { useStore } from '../store'
import { HallSummary } from './HallSummary'
import { ShiftLog } from './ShiftLog'
import { ShiftChecks } from './ShiftChecks'
import { TableCard } from './TableCard'
import { describeTable, summarizeHall } from '@easypay/domain/hall'
import { fmtDur } from '../waiter/duration'
import { getStaffToken } from '../staff'
import type { HallCard } from '@easypay/domain/hall'
import { ownsTable, ROLE_LABEL } from '@easypay/domain/roles'

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
    <div className="flex flex-wrap items-center gap-2 rounded-box bg-error/10 p-3">
      <span className="text-sm font-bold uppercase">Требуют внимания</span>
      {hot.map(({ card, alerts }) => (
        <span key={card.id} className="join">
          {card.call && (
            <button
              className="btn join-item btn-sm btn-primary"
              title="Сказать гостю «иду»"
              onClick={() => void onAck(card.id, card.call?.id)}
            >
              Иду
            </button>
          )}
          <a
            className="btn join-item btn-sm"
            href={`${window.location.pathname}?t=${encodeURIComponent(card.id)}#/waiter`}
          >
            <b>№{card.id}</b> {alerts.map(a => a.label).join(' · ')}
            {(card.calls ?? 0) > 1 && <span className="badge badge-xs">+{(card.calls ?? 1) - 1}</span>}
            {(() => {
              // Возраст ожидания прямо на чипе: без него все вызовы одинаковые
              const since = Math.min(...alerts.map(a => a.since ?? now))
              return Number.isFinite(since) && since < now ? (
                <span className="font-mono tabular-nums opacity-60">{fmtDur(now - since)}</span>
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
    <div className="flex min-h-full flex-col gap-3 bg-base-200 p-3">
      <div className="navbar min-h-0 flex-wrap gap-3 rounded-box bg-base-100 p-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-field bg-primary text-lg font-bold text-primary-content">
          e
        </div>
        <div>
          <div className="text-lg font-bold">Зал · {hall?.restaurant ?? '—'}</div>
          <div className="text-xs text-base-content/60">
            смена идёт{connected ? '' : ' · нет связи…'}
            {summary.closedTables > 0 ? ` · закрыто столов: ${summary.closedTables}` : ''}
            {shiftTips > 0 ? ` · ваши чаевые: ${Math.round(shiftTips)} ₽` : ''}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {hasOwnTables && (
            <button className="btn btn-sm" onClick={() => setOnlyMine(!onlyMine)}>
              {onlyMine ? 'Показать весь зал' : 'Только мои столы'}
            </button>
          )}
          {may('kitchen') && (
            <a className="btn btn-ghost btn-sm" href={`${window.location.pathname}#/kitchen`}>
              Кухня{summary.kitchenPending > 0 ? ` · ${summary.kitchenPending}` : ''}
            </a>
          )}
          <a className="btn btn-ghost btn-sm" href={`${window.location.pathname}#/qr`}>
            QR-коды столов
          </a>
          <div className="text-right">
            <div className="text-sm font-semibold">{staff?.name}</div>
            <div className="text-xs text-base-content/60">{staff ? ROLE_LABEL[staff.role] : ''}</div>
          </div>
          <button className="btn btn-sm" onClick={() => void signOutStaff()}>
            Выйти
          </button>
        </div>
      </div>

      <HallSummary summary={summary} />
      <AttentionBar cards={cards} now={now} onAck={ack} />

      {!hall && (
        <div className="flex items-center justify-center gap-3 rounded-box bg-base-100 p-8">
          <span className="loading loading-spinner" /> Загружаем зал…
        </div>
      )}

      {zones.map(zone => {
        const zoneCards = cards.filter(c => c.zoneId === zone.id)
        if (zoneCards.length === 0) return null
        const busy = zoneCards.filter(c => c.status === 'open').length
        return (
          <div className="rounded-box bg-base-100 p-3" key={zone.id}>
            <div className="mb-2.5 flex items-baseline gap-2">
              <span className="font-bold uppercase">{zone.name}</span>
              <span className="text-xs text-base-content/60">
                занято {busy} из {zoneCards.length}
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2.5">
              {zoneCards.map(card => (
                <TableCard key={card.id} card={card} now={now} onClean={clean} mine={ownsTable(staff, card.id)} />
              ))}
            </div>
          </div>
        )
      })}

      {offPlan.length > 0 && (
        <div className="rounded-box bg-base-100 p-3">
          <div className="mb-2.5 flex items-baseline gap-2">
            <span className="font-bold uppercase">Вне плана зала</span>
            <span className="text-xs text-base-content/60">открыты по произвольному QR</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2.5">
            {offPlan.map(card => (
              <TableCard key={card.id} card={card} now={now} mine={ownsTable(staff, card.id)} />
            ))}
          </div>
        </div>
      )}

      {may('log') && <ShiftChecks />}
      {may('log') && <ShiftLog />}
    </div>
  )
}
