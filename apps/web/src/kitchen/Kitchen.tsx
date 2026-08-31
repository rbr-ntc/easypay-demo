import { useEffect, useState } from 'react'
import { dismissCancelled, handOver, markReady, subscribeKitchen, takeToWork } from '../kitchenApi'
import type { KitchenPayload } from '../kitchenApi'
import { useStore } from '../store'
import { fmtDur } from '../waiter/duration'
import { Ticket } from './Ticket'
import { summarizeKitchen, ticketState } from '@easypay/domain/kitchen'
import { ROLE_LABEL } from '@easypay/domain/roles'

function Counter({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: '#9FB5A8' }}>
        {label}
      </div>
      <div
        className="ep-sum text-[26px] leading-tight font-extrabold"
        style={{ color: alert ? '#FF8A63' : '#FAF5EA' }}
      >
        {value}
      </div>
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
  // Готово, но ещё не унесли: раньше этого состояния не существовало вовсе —
  // повар нажимал «готово», и блюдо мгновенно считалось поданным гостю
  const ready = tickets.filter(t => ticketState(t) === 'ready')

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

  // Что-то пошло не так — повар должен это увидеть, а не гадать на серую кнопку
  const [failed, setFailed] = useState<string | null>(null)

  const act = async (ticket: (typeof tickets)[number]) => {
    setBusy(ticket.uid)
    setFailed(null)
    const done = ticket.readyAt
      ? await handOver(ticket.tableId, ticket.uid, ticket.sessionId)
      : ticket.startedAt
        ? await markReady(ticket.tableId, ticket.uid, ticket.sessionId)
        : await takeToWork(ticket.tableId, ticket.uid, ticket.sessionId)
    if (!done) setFailed('Не прошло — проверьте связь и нажмите ещё раз')
    setBusy(null)
  }

  // Отмена уходит с экрана только когда повар подтвердил, что снял блюдо с плиты
  const dismiss = async (ticket: (typeof cancelled)[number]) => {
    setBusy(ticket.uid)
    const done = await dismissCancelled(ticket.tableId, ticket.uid, ticket.sessionId)
    if (!done) setFailed('Не прошло — проверьте связь и нажмите ещё раз')
    setBusy(null)
  }

  return (
    <div className="ep-forest flex h-full flex-col" style={{ background: '#041712' }}>
      <div
        className="flex shrink-0 flex-wrap items-center gap-5 px-5.5 py-4"
        style={{ borderBottom: '1px solid #123227' }}
      >
        <div
          className="flex size-10.5 shrink-0 items-center justify-center rounded-[13px] text-[19px] font-extrabold"
          style={{ background: '#D5F94E', color: '#062119' }}
        >
          e
        </div>
        <div>
          <div className="text-[20px] font-extrabold tracking-tight">Кухня</div>
          <div className="text-[13px] font-semibold" style={{ color: '#9FB5A8' }}>
            очередь по всему залу{connected ? '' : ' · нет связи…'}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-6">
          <Counter label="В очереди" value={String(summary.queued)} />
          <Counter label="В работе" value={String(summary.cooking)} />
          <Counter label="На раздаче" value={String(ready.length)} alert={ready.length > 2} />
          <Counter label="Столов" value={String(summary.tables)} />
          {/* Жёлтые считались только красными: к моменту сигнала кофе уже нельзя пить */}
          <Counter label="Подгорает" value={String(warn)} alert={warn > 0} />
          <Counter
            label="Самое долгое"
            value={summary.oldestWaitMs === null ? '—' : fmtDur(summary.oldestWaitMs)}
            alert={summary.overdue > 0}
          />
          {may('hall') && (
            <a
              href={`${window.location.pathname}#/hall`}
              className="inline-flex h-11 items-center rounded-[14px] px-4.5 text-[14px] font-bold"
              style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }}
            >
              в зал
            </a>
          )}
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

{!connected && (
        <div
          className="mx-5.5 mt-4 flex flex-wrap items-center gap-3 rounded-[20px] px-4.5 py-4"
          style={{ background: '#2A1410', border: '1.5px solid #C4451F' }}
        >
          <span className="ep-pulse size-2.5 rounded-full" style={{ background: '#FF8A63' }} />
          <span className="flex-1 text-[15px] font-bold" style={{ color: '#FFE3D8' }}>
            Нет связи с рестораном — показываем последнее известное состояние. Действия сейчас могут не дойти.
          </span>
          <button
            onClick={() => window.location.reload()}
            className="h-11 rounded-[14px] px-4.5 text-[14px] font-extrabold"
            style={{ border: '1px solid rgba(250,245,234,.3)', color: '#FAF5EA' }}
          >
            Обновить
          </button>
        </div>
      )}

      {failed && (
        <div
          className="mx-5.5 mt-4 rounded-field px-4 py-3 text-[14px] font-bold"
          style={{ background: '#2A1410', color: '#FFC9B6', border: '1.5px solid #C4451F' }}
        >
          {failed}
        </div>
      )}

      <div className="ep-scroll grid gap-4 px-5.5 py-4.5 lg:grid-cols-3">
        <div>
          <LaneTitle>Очередь · {queued.length}</LaneTitle>
          <div className="flex flex-col gap-3">
            {cancelled.length > 0 && (
              <div
                className="flex flex-col gap-2.5 rounded-[20px] p-3"
                style={{ border: '2px solid #C4451F', background: 'rgba(196,69,31,.08)' }}
              >
                <div className="text-[12px] font-extrabold tracking-widest uppercase" style={{ color: '#FF8A63' }}>
                  снять с плиты · подтвердить
                </div>
                {cancelled.map(t => (
                  <Ticket
                    key={`c-${t.tableId}-${t.uid}`}
                    ticket={t}
                    now={now}
                    busy={busy === t.uid}
                    onAction={() => void dismiss(t)}
                  />
                ))}
              </div>
            )}

            {byWave(queued).map(wave => (
              <div
                key={wave.key}
                // «Отдавать вместе»: подать тар-тар, пока лазанья ещё двадцать
                // минут в печи, — испортить стол
                className={
                  wave.items.length > 1 ? 'flex flex-col gap-2.5 rounded-[20px] p-3' : 'flex flex-col gap-2.5'
                }
                style={wave.items.length > 1 ? { border: '1.5px dashed #2A4C3D' } : undefined}
              >
                {wave.items.length > 1 && (
                  <div className="text-[12px] font-extrabold tracking-widest uppercase" style={{ color: '#D5F94E' }}>
                    стол {wave.items[0].tableId} · отдавать вместе
                  </div>
                )}
                {wave.items.map(t => (
                  <Ticket
                    key={`${t.tableId}-${t.uid}`}
                    ticket={t}
                    now={now}
                    busy={busy === t.uid}
                    onAction={() => void act(t)}
                  />
                ))}
              </div>
            ))}
            {queued.length === 0 && cancelled.length === 0 && <Empty>Новых позиций нет</Empty>}
          </div>
        </div>

        <div>
          <LaneTitle>В работе · {cooking.length}</LaneTitle>
          <div className="flex flex-col gap-3">
            {cooking.map(t => (
              <Ticket key={`${t.tableId}-${t.uid}`} ticket={t} now={now} busy={busy === t.uid} onAction={() => void act(t)} />
            ))}
            {cooking.length === 0 && <Empty>Ничего не готовится</Empty>}
          </div>
        </div>

        <div>
          <LaneTitle>На раздаче · {ready.length}</LaneTitle>
          <div className="flex flex-col gap-3">
            {ready.map(t => (
              <Ticket
                key={`r-${t.tableId}-${t.uid}`}
                ticket={t}
                now={now}
                busy={busy === t.uid}
                onAction={() => void act(t)}
              />
            ))}
            {ready.length === 0 && <Empty>Раздача пуста</Empty>}
          </div>
        </div>
      </div>
    </div>
  )
}

function LaneTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 text-[14px] font-extrabold tracking-wider uppercase" style={{ color: '#FAF5EA' }}>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] py-10 text-center text-[14px] font-semibold" style={{ background: '#0C2C21', color: '#9FB5A8' }}>
      {children}
    </div>
  )
}
