import { useEffect, useState } from 'react'
import { HALL_LABEL, WAITER_NAME } from './data'
import { tableId } from './api'
import { useStore } from './store'
import { fmt } from './format'
import { GuestList } from './waiter/GuestList'
import { ManagerLogin } from './waiter/ManagerLogin'
import { MetricsRow } from './waiter/Metrics'
import { OrderFeed } from './waiter/OrderFeed'
import { PaymentsList } from './waiter/PaymentsList'
import { computeMetrics } from './waiter/tableMetrics'
import './waiter.css'

// Экран менеджера/официанта: живой снапшот стола со всех телефонов.
// Действия менеджера закрыты токеном — см. ManagerLogin и server/index.mjs.
export function Waiter() {
  const { snap, connected, totals, closeTable, serveLine, resetDemo, managerAuthed, checkManager, signOutManager } =
    useStore()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    void checkManager()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (managerAuthed === null) {
    return (
      <div className="ep-w-login">
        <div className="ep-w-login-card ep-w-login-hint">Проверяем доступ…</div>
      </div>
    )
  }
  if (!managerAuthed) return <ManagerLogin />

  const personas = snap?.personas ?? []
  const lines = snap?.lines ?? []
  const payments = snap?.payments ?? []
  const isOpen = snap?.status === 'open'
  const closed = snap?.status === 'closed'
  const fullyPaid = totals.tableTotal > 0 && totals.remaining < 0.01
  const progress = totals.tableTotal > 0 ? Math.min(100, Math.round((totals.paidTotal / totals.tableTotal) * 100)) : 0
  const metrics = computeMetrics(snap, totals, now)

  const confirmClose = () => {
    const question = fullyPaid ? 'Закрыть стол?' : `По столу осталось ${fmt(totals.remaining)}. Всё равно закрыть?`
    if (window.confirm(question)) void closeTable()
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
              официант {WAITER_NAME} · экран ресторана {connected ? '' : '· нет связи…'}
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
          {isOpen && (
            <button className={fullyPaid ? 'ep-w-btn ep-w-btn--ok' : 'ep-w-btn'} onClick={confirmClose}>
              Закрыть стол
            </button>
          )}
          <button className="ep-w-btn ep-w-btn--quiet" onClick={confirmReset}>
            Сбросить демо
          </button>
          <button className="ep-w-btn ep-w-btn--quiet" onClick={signOutManager}>
            Выйти
          </button>
          <a className="ep-w-link" href="#/">
            ← гостевой экран
          </a>
        </div>
      </div>

      {(snap?.openedAt || closed) && <MetricsRow metrics={metrics} closed={closed} guests={personas.length} />}

      <div className="ep-w-body">
        <div className="ep-w-side">
          <GuestList personas={personas} lines={lines} totals={totals} tableOpen={isOpen} />
        </div>
        <div className="ep-w-main">
          <OrderFeed lines={lines} personas={personas} now={now} onServe={uid => void serveLine(uid)} />
          <PaymentsList payments={payments} personas={personas} />
        </div>
      </div>
    </div>
  )
}
