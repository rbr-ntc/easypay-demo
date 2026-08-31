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
    <div className="rounded-[20px] px-4.5 py-4" style={{ background: '#2A1410', border: '1.5px solid #C4451F' }}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="ep-pulse size-2.5 rounded-full" style={{ background: '#FF8A63' }} />
        <span className="text-[15px] font-extrabold" style={{ color: '#FFE3D8' }}>
          Сначала это — {hot.length} {hot.length === 1 ? 'стол ждёт' : hot.length < 5 ? 'стола ждут' : 'столов ждут'}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {hot.map(({ card, alerts }) => {
          const since = Math.min(...alerts.map(a => a.since ?? now))
          return (
            <div
              key={card.id}
              className="flex min-w-82 flex-1 items-center gap-3 rounded-field px-3.5 py-3"
              style={{ background: 'rgba(250,245,234,.08)' }}
            >
              <div className="min-w-11.5 text-[22px] font-extrabold" style={{ color: '#FAF5EA' }}>
                №{card.id}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold" style={{ color: '#FAF5EA' }}>
                  {alerts[0].label}
                </div>
                <div className="text-[13px] font-semibold" style={{ color: '#FFC9B6' }}>
                  {Number.isFinite(since) && since < now ? `ждёт ${fmtDur(now - since)}` : 'только что'}
                  {alerts.length > 1 ? ` · и ещё ${alerts.length - 1}` : ''}
                </div>
              </div>
              {card.call ? (
                <button
                  onClick={() => void onAck(card.id, card.call?.id)}
                  className="h-11 shrink-0 rounded-field px-4.5 text-[14px] font-extrabold"
                  style={{ background: '#D5F94E', color: '#062119' }}
                >
                  Иду
                </button>
              ) : (
                <a
                  href={`${window.location.pathname}?t=${encodeURIComponent(card.id)}#/waiter`}
                  className="flex h-11 shrink-0 items-center rounded-field px-4.5 text-[14px] font-extrabold"
                  style={{ border: '1px solid rgba(250,245,234,.3)', color: '#FAF5EA' }}
                >
                  Открыть
                </a>
              )}
            </div>
          )
        })}
      </div>
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
    <div className="ep-forest min-h-full">
      <div
        className="flex flex-wrap items-center gap-4.5 px-5.5 py-4.5"
        style={{ borderBottom: '1px solid #123227' }}
      >
        <div
          className="flex size-10.5 shrink-0 items-center justify-center rounded-[13px] text-[19px] font-extrabold"
          style={{ background: '#D5F94E', color: '#062119' }}
        >
          e
        </div>
        <div>
          <div className="text-[20px] font-extrabold tracking-tight">{hall?.restaurant ?? '—'} · зал</div>
          <div className="text-[13px] font-semibold" style={{ color: '#9FB5A8' }}>
            Смена {staff?.name ?? '—'}
            {connected ? '' : ' · нет связи…'}
            {summary.closedTables > 0 ? ` · закрыто столов: ${summary.closedTables}` : ''}
            {shiftTips > 0 ? ` · ваши чаевые: ${Math.round(shiftTips)} ₽` : ''}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {hasOwnTables && (
            <div className="flex gap-1.5 rounded-[14px] p-1.5" style={{ background: 'rgba(250,245,234,.1)' }}>
              <SegBtn active={onlyMine} onClick={() => setOnlyMine(true)}>
                Мои столы
              </SegBtn>
              <SegBtn active={!onlyMine} onClick={() => setOnlyMine(false)}>
                Весь зал
              </SegBtn>
            </div>
          )}
          {may('kitchen') && (
            <a
              href={`${window.location.pathname}#/kitchen`}
              className="inline-flex h-11 items-center gap-2 rounded-[14px] px-4.5 text-[14px] font-bold"
              style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }}
            >
              Кухня
              {summary.kitchenPending > 0 && (
                <span
                  className="inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full px-1.5 text-[12px] font-extrabold"
                  style={{ background: '#D5F94E', color: '#062119' }}
                >
                  {summary.kitchenPending}
                </span>
              )}
            </a>
          )}
          <a
            href={`${window.location.pathname}#/qr`}
            className="inline-flex h-11 items-center rounded-[14px] px-4.5 text-[14px] font-bold"
            style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }}
          >
            QR-тенты
          </a>
          <div className="text-right">
            <div className="text-[14px] font-bold">{staff?.name}</div>
            <div className="text-[12px] font-semibold" style={{ color: '#9FB5A8' }}>
              {staff ? ROLE_LABEL[staff.role] : ''}
            </div>
          </div>
          <button
            onClick={() => void signOutStaff()}
            className="h-11 rounded-[14px] px-4 text-[14px] font-bold"
            style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }}
          >
            Выйти
          </button>
        </div>
      </div>

      <div className="grid gap-4.5 px-5.5 pt-4.5 pb-5.5 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <AttentionBar cards={cards} now={now} onAck={ack} />

          {!hall && (
            <div className="flex items-center justify-center gap-3 rounded-[20px] p-8" style={{ background: '#0C2C21' }}>
              <span className="loading loading-spinner" /> Загружаем зал…
            </div>
          )}

          {zones.map(zone => {
            const zoneCards = cards.filter(c => c.zoneId === zone.id)
            if (zoneCards.length === 0) return null
            const busy = zoneCards.filter(c => c.status === 'open').length
            return (
              <div key={zone.id}>
                <div className="mb-3 flex items-baseline gap-2.5">
                  <span className="text-[15px] font-extrabold">{zone.name}</span>
                  <span className="text-[13px] font-semibold" style={{ color: '#9FB5A8' }}>
                    занято {busy} из {zoneCards.length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                  {zoneCards.map(card => (
                    <TableCard
                      key={card.id}
                      card={card}
                      now={now}
                      onClean={clean}
                      mine={hasOwnTables && ownsTable(staff, card.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {offPlan.length > 0 && (
            <div>
              <div className="mb-3 flex items-baseline gap-2.5">
                <span className="text-[15px] font-extrabold">Вне плана зала</span>
                <span className="text-[13px] font-semibold" style={{ color: '#9FB5A8' }}>
                  открыты по произвольному QR
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                {offPlan.map(card => (
                  <TableCard key={card.id} card={card} now={now} mine={hasOwnTables && ownsTable(staff, card.id)} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <HallSummary summary={summary} />
          {may('log') && <ShiftChecks />}
          {may('log') && <ShiftLog />}
        </div>
      </div>
    </div>
  )
}

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="h-9.5 rounded-[10px] px-4 text-[14px]"
      style={
        active
          ? { background: '#D5F94E', color: '#062119', fontWeight: 800 }
          : { color: '#C6D5CC', fontWeight: 700 }
      }
    >
      {children}
    </button>
  )
}
