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
    <div className="stat px-3 py-2">
      <div className="stat-title text-xs">{label}</div>
      <div className={`stat-value text-2xl ${alert ? 'text-error' : ''}`}>{value}</div>
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
    <div className="flex h-full flex-col gap-3 bg-base-200 p-3">
      <div className="navbar min-h-0 gap-3 rounded-box bg-base-100 p-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-field bg-primary text-lg font-bold text-primary-content">
          e
        </div>
        <div>
          <div className="text-lg font-bold">Кухня</div>
          <div className="text-xs text-base-content/60">
            очередь по всему залу{connected ? '' : ' · нет связи…'}
          </div>
        </div>
        <div className="stats stats-horizontal ml-auto overflow-x-auto bg-base-100">
          <Counter label="В очереди" value={String(summary.queued)} />
          <Counter label="В работе" value={String(summary.cooking)} />
          <Counter label="На раздаче" value={String(ready.length)} alert={ready.length > 2} />
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
          <a className="btn btn-ghost btn-sm" href={`${window.location.pathname}#/hall`}>
            в зал
          </a>
        )}
        <div className="text-right">
          <div className="text-sm font-semibold">{staff?.name}</div>
          <div className="text-xs text-base-content/60">{staff ? ROLE_LABEL[staff.role] : ''}</div>
        </div>
        <button className="btn btn-sm" onClick={() => void signOutStaff()}>
          Выйти
        </button>
      </div>

      {failed && (
        <div role="alert" className="alert alert-error">
          <span>{failed}</span>
        </div>
      )}

      <div className="ep-scroll flex flex-col gap-3">
        {cancelled.length > 0 && (
          <div className="rounded-box border-2 border-error bg-error/5 p-3">
            <div className="mb-2 font-bold text-error">Отменено · снять с плиты и подтвердить</div>
            <div className="flex flex-col gap-2">
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
          </div>
        )}

        {ready.length > 0 && (
          // Доска при восьми тикетах выше экрана, а раздача — то, за чем повар
          // и официант следят чаще всего: она не уезжает вверх при прокрутке
          <div className="sticky top-0 z-10 rounded-box border-2 border-success bg-success/10 p-3">
            <div className="mb-2 font-bold">
              На раздаче · забрать в зал <span className="badge badge-success">{ready.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {ready.map(t => (
                <Ticket
                  key={`r-${t.tableId}-${t.uid}`}
                  ticket={t}
                  now={now}
                  busy={busy === t.uid}
                  onAction={() => void act(t)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-base font-bold">
              Очередь <span className="badge">{queued.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {byWave(queued).map(wave => (
                <div
                  key={wave.key}
                  // «Отдавать вместе» должно читаться от плиты: рамка была
                  // светло-серой по светло-серому, контраст 1.06:1
                  className={
                    wave.items.length > 1
                      ? 'flex flex-col gap-2 rounded-box border-2 border-dashed border-base-content/40 bg-base-content/5 p-2.5'
                      : undefined
                  }
                >
                  {wave.items.length > 1 && (
                    <div className="text-sm font-bold uppercase">
                      Стол №{wave.items[0].tableId} · {wave.items.length} поз. · отдавать вместе
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
              {queued.length === 0 && <div className="py-6 text-center text-base-content/60">Новых позиций нет</div>}
            </div>
          </div>

          <div>
            <div className="mb-2 text-base font-bold">
              В работе <span className="badge">{cooking.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {cooking.map(t => (
                <Ticket
                  key={`${t.tableId}-${t.uid}`}
                  ticket={t}
                  now={now}
                  busy={busy === t.uid}
                  onAction={() => void act(t)}
                />
              ))}
              {cooking.length === 0 && (
                <div className="py-6 text-center text-base-content/60">Ничего не готовится</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
