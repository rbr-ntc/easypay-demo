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
import './waiter.css'

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
    <div className="ep-w-cash">
      <div>
        <div className="ep-w-cash-title">{name} платит наличными</div>
        <div className="ep-w-cash-sum">{fmt(intent.amount)}</div>
      </div>
      <button className="ep-w-btn" disabled={busy} onClick={() => void take()}>
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
    <div className="ep-w-ask-veil" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ep-w-ask" onClick={e => e.stopPropagation()}>
        <div className="ep-w-ask-title">{ask.title}</div>
        <div className="ep-w-ask-body">{ask.body}</div>
        <div className="ep-w-ask-row">
          <button ref={cancelRef} className="ep-w-btn ep-w-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className={ask.danger ? 'ep-w-btn ep-w-btn--danger' : 'ep-w-btn'}
            onClick={() => {
              ask.run()
              onClose()
            }}
          >
            {ask.confirm}
          </button>
        </div>
      </div>
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
    <div className="ep-w">
      <div className="ep-w-top">
        <div className="ep-w-brand">
          <div className="ep-w-logo">e</div>
          <div>
            <div className="ep-w-title">
              Стол №{tableId} · {HALL_LABEL}
              <span className={isOpen ? 'ep-w-badge ep-w-badge--open' : 'ep-w-badge'}>
                {isOpen ? 'Открыт' : 'Закрыт'}
              </span>
            </div>
            <div className="ep-w-sub">
              официант {snap?.waiter?.name ?? WAITER_NAME} · экран ресторана {connected ? '' : '· нет связи…'}
            </div>
          </div>
        </div>

        <div className="ep-w-progress">
          <div className="ep-w-progress-row">
            <span className="ep-w-progress-label">Оплачено по столу</span>
            <span className="ep-w-progress-value">
              {fmt(totals.paidTotal)} / {fmt(totals.tableTotal)}
            </span>
          </div>
          <div className="ep-w-bar">
            <div className="ep-w-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="ep-w-actions">
          {isOpen && may('close') && (
            <button className={fullyPaid ? 'ep-w-btn ep-w-btn--ok' : 'ep-w-btn'} onClick={confirmClose}>
              Закрыть стол
            </button>
          )}
          {may('reset') && (
            <button className="ep-w-btn ep-w-btn--quiet" onClick={confirmReset}>
              Сбросить демо
            </button>
          )}
          <div className="ep-s-who">
            <span className="ep-s-who-name">{staff?.name}</span>
            <span className="ep-s-role">{staff ? ROLE_LABEL[staff.role] : ''}</span>
          </div>
          <button className="ep-w-btn ep-w-btn--quiet" onClick={() => void signOutStaff()}>
            Выйти
          </button>
          {may('hall') && (
            <a className="ep-w-link" href={`${window.location.pathname}#/hall`}>
              ← в зал
            </a>
          )}
          <a className="ep-w-link" href={`?t=${encodeURIComponent(tableId ?? '')}#/qr`}>
            QR стола
          </a>
          <a className="ep-w-link" href={`?t=${encodeURIComponent(tableId ?? '')}`}>
            гостевой экран
          </a>
        </div>
      </div>

      {snap?.call && (
        <div className="ep-w-call">
          <span className="ep-w-call-dot ep-pulse" />
          <span className="ep-w-call-text">
            <b>{snap.call.name ?? personas.find(p => p.id === snap.call?.personaId)?.name ?? 'Гость'}</b>{' '}
            {CALL_LABEL[snap.call.reason] ?? CALL_LABEL.help} · {fmtDur(now - snap.call.at)}
          </span>
          {may('ack') && (
            <button className="ep-w-btn ep-w-btn--ok" onClick={() => void ackCall(snap.call?.id)}>
              Принял{(snap.calls?.length ?? 0) > 1 ? ` (ещё ${snap.calls.length - 1})` : ''}
            </button>
          )}
        </div>
      )}

      {(snap?.openedAt || closed) && (
        <MetricsRow metrics={metrics} closed={closed} guests={personas.length} tipsTotal={tipsTotal} />
      )}

      <div className="ep-w-body">
        <div className="ep-w-side">
          {/* Гость с деньгами в руке — это срочнее всего остального на экране */}
          <CashRequest table={tableId ?? ''} snap={snap} onTaken={() => {}} />
          <GuestList personas={personas} lines={lines} totals={totals} tableOpen={isOpen} />
        </div>
        <div className="ep-w-main">
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
