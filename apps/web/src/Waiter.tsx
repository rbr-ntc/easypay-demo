import { useEffect, useRef, useState } from 'react'
import { HALL_LABEL, WAITER_NAME } from './data'
import { tableId } from './api'
import { useStore } from './store'
import { fmt } from './format'
import { getStaffToken } from './staff'
import { GuestList } from './waiter/GuestList'
import { MetricsRow } from './waiter/Metrics'
import { OrderFeed } from './waiter/OrderFeed'
import { PaymentsList } from './waiter/PaymentsList'
import { computeMetrics } from './waiter/tableMetrics'
import { fmtDur } from './waiter/duration'
import { CALL_LABEL } from '@easypay/domain/hall'
import { ROLE_LABEL } from '@easypay/domain/roles'

// Экран менеджера/официанта: живой снапшот стола со всех телефонов.
// Доступ и кнопки зависят от роли вошедшего сотрудника (shared/roles.js).
/**
 * Просьба принять наличные. Деньги появляются в счёте только после того, как
 * официант подтвердил, что физически их взял, — телефон гостя наличные не видит.
 */
function CashRequest({ table, snap, onTaken }: { table: string; snap: any; onTaken: () => void }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const intent = snap?.cashIntent
  if (!intent) return null

  const name = snap.personas?.find((p: any) => p.id === intent.personaId)?.name ?? 'Гость'
  const take = async () => {
    setBusy(true)
    try {
      // Приём наличных был единственным запросом персонала без таймаута:
      // при забитом пуле соединений кнопка вечно висела в «Секунду…», а
      // официант с деньгами в руке не знал, провелись они или нет
      const stop = new AbortController()
      const timer = setTimeout(() => stop.abort(), 12_000)
      let res: Response
      try {
        res = await fetch(`/api/t/${encodeURIComponent(table)}/cash`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-staff-token': getStaffToken() },
          body: JSON.stringify({ personaId: intent.personaId, scope: intent.scope, sessionId: snap.sessionId }),
          signal: stop.signal
        })
      } finally {
        clearTimeout(timer)
      }
      // Кнопка молчала в обе стороны: официант жал «Принял деньги» на уже
      // оплаченном столе и не понимал, взялись деньги или нет
      if (res.ok) {
        toast(`Принято наличными · ${fmt(intent.amount)}`)
        onTaken()
      } else {
        const err = await res.json().catch(() => ({}))
        toast(
          err.error === 'nothing to pay'
            ? 'Счёт уже закрыт — брать нечего'
            : 'Не получилось принять наличные — обновите экран'
        )
      }
    } catch (err) {
      console.error('не удалось принять наличные:', err)
      toast(
        (err as any)?.name === 'AbortError'
          ? 'Сервер не ответил вовремя — проверьте счёт, прежде чем повторять'
          : 'Нет связи с сервером — деньги не проведены'
      )
    }
    setBusy(false)
  }

  return (
    <div role="alert" className="alert alert-warning mb-3">
      <div className="flex-1">
        <div className="font-semibold">{name} платит наличными</div>
        <div className="text-xl font-bold tabular-nums">{fmt(intent.amount)}</div>
      </div>
      <button className="btn btn-sm" disabled={busy} onClick={() => void take()}>
        Принял деньги
      </button>
    </div>
  )
}

/** Вопрос персоналу перед необратимым действием. */
interface AskDialog {
  title: string
  body: string
  confirm: string
  danger?: boolean
  run: () => void
}

function ConfirmDialog({ ask, onClose }: { ask: AskDialog; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Системный confirm давал Escape и фокус бесплатно — свой диалог обязан
  // делать то же руками, иначе замена оказывается шагом назад
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true">
      <div className="modal-box">
        <h3 className="text-lg font-bold">{ask.title}</h3>
        <p className="py-3 text-base-content/70">{ask.body}</p>
        <div className="modal-action">
          <button ref={cancelRef} className="btn flex-1" onClick={onClose}>
            Отмена
          </button>
          <button
            className={`btn flex-1 ${ask.danger ? 'btn-error' : 'btn-primary'}`}
            onClick={() => {
              ask.run()
              onClose()
            }}
          >
            {ask.confirm}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}

export function Waiter() {
  const {
    snap,
    connected,
    totals,
    closeTable,
    startLine,
    serveLine,
    ackCall,
    resetDemo,
    staff,
    may,
    signOutStaff
  } = useStore()
  const [now, setNow] = useState(Date.now())
  // Вопрос, который приложение задаёт само, а не руками браузера
  const [ask, setAsk] = useState<AskDialog | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const personas = snap?.personas ?? []
  const lines = snap?.lines ?? []
  const payments = snap?.payments ?? []
  const isOpen = snap?.status === 'open'
  const closed = snap?.status === 'closed'
  const fullyPaid = totals.tableTotal > 0 && totals.remaining < 0.01
  const progress = totals.tableTotal > 0 ? Math.min(100, Math.round((totals.paidTotal / totals.tableTotal) * 100)) : 0
  const metrics = computeMetrics(snap, totals, now)
  const tipsTotal = (snap?.tips ?? []).reduce((s, t) => s + t.amount, 0)

  /**
   * Подтверждение живёт внутри приложения, а не в системном окне браузера.
   * window.confirm блокирует поток, не переживает установку как PWA, теряется
   * на планшете под чужой оболочкой и выглядит как ошибка сайта — а решение,
   * которое им принимают, стоит денег и попадает в журнал смены.
   */
  const confirmClose = () => {
    // Осознанного подтверждения требуют две разные вещи: неоплаченный остаток
    // и еда, которая ещё готовится. Вторую клиент раньше не умел подтверждать
    // вовсе — зал советовал «Оплачен, закрыть», а закрыть было нечем.
    const debt = totals.remaining > 0.01
    const cooking = (snap?.lines ?? []).filter(l => l.sent && !l.served && !l.cancelled)

    const reasons: string[] = []
    if (debt) reasons.push(`не оплачено ${fmt(totals.remaining)}`)
    if (cooking.length > 0) {
      reasons.push(`на кухне ещё готовится: ${cooking.map(l => l.name ?? l.dishId).join(', ')}`)
    }

    setAsk({
      title: reasons.length ? 'Закрыть стол с оговорками?' : 'Закрыть стол?',
      body: reasons.length
        ? `${reasons.join('; ')}. Это попадёт в журнал смены.`
        : 'Стол освободится после уборки.',
      confirm: reasons.length ? 'Всё равно закрыть' : 'Закрыть стол',
      danger: reasons.length > 0,
      run: () => void closeTable(reasons.length > 0)
    })
  }

  const confirmReset = () => {
    setAsk({
      title: 'Сбросить демо-стол?',
      body: 'Гости, заказы и оплаты будут стёрты. Отменить это нельзя.',
      confirm: 'Сбросить',
      danger: true,
      run: () => void resetDemo()
    })
  }

  return (
    <div className="flex min-h-full flex-col gap-3 bg-base-200 p-3">
      <div className="navbar min-h-0 shrink-0 flex-wrap gap-3 rounded-box bg-base-100 p-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-field bg-primary text-lg font-bold text-primary-content">
            e
          </div>
          <div>
            <div className="flex items-center gap-2 text-lg font-bold">
              Стол №{tableId} · {HALL_LABEL}
              <span className={`badge badge-sm ${isOpen ? 'badge-success' : 'badge-ghost'}`}>
                {isOpen ? 'Открыт' : 'Закрыт'}
              </span>
            </div>
            <div className="text-xs text-base-content/60">
              официант {snap?.waiter?.name ?? WAITER_NAME} · экран ресторана {connected ? '' : '· нет связи…'}
            </div>
          </div>
        </div>

        <div className="min-w-50 flex-1">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-base-content/60">Оплачено по столу</span>
            <span className="font-semibold tabular-nums">
              {fmt(totals.paidTotal)} / {fmt(totals.tableTotal)}
            </span>
          </div>
          <progress className="progress progress-success w-full" value={progress} max={100} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOpen && may('close') && (
            <button className={`btn btn-sm ${fullyPaid ? 'btn-success' : ''}`} onClick={confirmClose}>
              Закрыть стол
            </button>
          )}
          {may('reset') && (
            <button className="btn btn-sm" onClick={confirmReset}>
              Сбросить демо
            </button>
          )}
          <div className="text-right">
            <div className="text-sm font-semibold">{staff?.name}</div>
            <div className="text-xs text-base-content/60">{staff ? ROLE_LABEL[staff.role] : ''}</div>
          </div>
          <button className="btn btn-sm" onClick={() => void signOutStaff()}>
            Выйти
          </button>
          {may('hall') && (
            <a className="btn btn-ghost btn-sm" href={`${window.location.pathname}#/hall`}>
              ← в зал
            </a>
          )}
          <a className="btn btn-ghost btn-sm" href={`?t=${encodeURIComponent(tableId ?? '')}#/qr`}>
            QR стола
          </a>
          <a className="btn btn-ghost btn-sm" href={`?t=${encodeURIComponent(tableId ?? '')}`}>
            гостевой экран
          </a>
        </div>
      </div>

      {snap?.call && (
        <div role="alert" className="alert alert-error">
          <span className="status status-error ep-pulse" />
          {/* Текст гостя важнее подписи причины — то же правило, что и в зале.
              «Гость2 просит воды» вместо «графин без газа» отправляет официанта
              к столу гадать, что именно принести. */}
          <span>
            <b>{snap.call.name ?? personas.find(p => p.id === snap.call?.personaId)?.name ?? 'Гость'}</b>{' '}
            {snap.call.note ?? CALL_LABEL[snap.call.reason] ?? CALL_LABEL.help} · {fmtDur(now - snap.call.at)}
          </span>
          {may('ack') && (
            <button className="btn btn-sm" onClick={() => void ackCall(snap.call?.id)}>
              Принял{(snap.calls?.length ?? 0) > 1 ? ` (ещё ${snap.calls.length - 1})` : ''}
            </button>
          )}
        </div>
      )}

      {(snap?.openedAt || closed) && (
        <MetricsRow metrics={metrics} closed={closed} guests={personas.length} tipsTotal={tipsTotal} />
      )}

      <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
        <div>
          {/* Гость с деньгами в руке — это срочнее всего остального на экране */}
          <CashRequest table={tableId ?? ''} snap={snap} onTaken={() => {}} />
          <GuestList personas={personas} lines={lines} totals={totals} tableOpen={isOpen} />
        </div>
        <div>
          <OrderFeed
            lines={lines}
            personas={personas}
            now={now}
            canServe={may('serve')}
            onStart={uid => void startLine(uid)}
            onServe={uid => void serveLine(uid)}
          />
          <PaymentsList payments={payments} personas={personas} />
        </div>
      </div>
      {ask && <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  )
}
