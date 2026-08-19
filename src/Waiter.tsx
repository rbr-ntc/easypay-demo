import { useEffect, useState } from 'react'
import { HALL_LABEL, WAITER_NAME } from './data'
import { tableId } from './api'
import { useStore } from './store'
import { fmt } from './format'
import { GuestList } from './waiter/GuestList'
import { MetricsRow } from './waiter/Metrics'
import { OrderFeed } from './waiter/OrderFeed'
import { PaymentsList } from './waiter/PaymentsList'
import { computeMetrics } from './waiter/tableMetrics'
import { fmtDur } from './waiter/duration'
import { CALL_LABEL } from '../shared/hall.js'
import { ROLE_LABEL } from '../shared/roles.js'
import './waiter.css'

// Экран менеджера/официанта: живой снапшот стола со всех телефонов.
// Доступ и кнопки зависят от роли вошедшего сотрудника (shared/roles.js).
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

  const confirmClose = () => {
    // Стол с долгом закрывается только осознанно — сервер иначе откажет
    const debt = totals.remaining > 0.01
    const question = debt
      ? `По столу не оплачено ${fmt(totals.remaining)}. Закрыть с долгом? Это попадёт в журнал смены.`
      : 'Закрыть стол?'
    if (window.confirm(question)) void closeTable(debt)
  }

  const confirmReset = () => {
    if (window.confirm('Сбросить демо-стол? Гости, заказы и оплаты будут стёрты.')) void resetDemo()
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
    </div>
  )
}
