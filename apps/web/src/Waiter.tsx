import { useEffect, useRef, useState } from 'react'
import { HALL_LABEL, WAITER_NAME } from './data'
import { ApiError, apiRefund, tableId } from './api'
import { humanError, useStore } from './store'
import { newIdemKey } from './keys'
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

/**
 * Возврат переплаты. Домен считал её с самого начала и показывал в сводке
 * смены, но отдать деньги было нечем: управляющая видела «вернуть гостям
 * 640 ₽» и не могла закрыть этот долг в системе.
 */
function RefundCard({ snap }: { snap: any }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  // Ключ живёт до успешного возврата: ретрай после обрыва не отдаст деньги дважды
  const refundKey = useRef(newIdemKey())
  const left = snap?.totals?.toRefund ?? 0
  if (left <= 0.01) return null

  const name = snap.personas?.find((p: any) => p.id === [...(snap.payments ?? [])].sort((a: any, b: any) => b.at - a.at)[0]?.personaId)?.name

  const give = async (method: 'sbp' | 'cash') => {
    setBusy(true)
    try {
      const r = await apiRefund(left, method, snap.sessionId, refundKey.current)
      refundKey.current = newIdemKey()
      toast(`Возвращено ${fmt(r.amount)}`)
    } catch (err) {
      // Причину называем: 403 роли, 409 «возвращать нечего» и обрыв связи —
      // три разные ситуации, и «обновите экран» подходит только к одной
      toast(err instanceof ApiError ? humanError(err) : 'Нет связи с сервером — возврат не проведён')
    }
    setBusy(false)
  }

  return (
    <div className="mb-3 rounded-[20px] px-4.5 py-4" style={{ background: '#2A1410', border: '1.5px solid #C4451F' }}>
      <div className="text-[15px] font-extrabold" style={{ color: '#FFE3D8' }}>
        Вернуть переплату{name ? ` · ${name}` : ''}
      </div>
      <div className="ep-sum mt-1 text-[26px] font-extrabold" style={{ color: '#FAF5EA' }}>
        {fmt(left)}
      </div>
      <div className="mt-1 text-[12px] font-semibold" style={{ color: '#FFC9B6' }}>
        Гость заплатил больше, чем получил, — это долг заведения, а не выручка
      </div>
      <div className="mt-3 flex gap-2">
        <button
          disabled={busy}
          onClick={() => void give('sbp')}
          className="h-11 flex-1 rounded-field text-[14px] font-extrabold disabled:opacity-45"
          style={{ background: '#D5F94E', color: '#062119' }}
        >
          На карту
        </button>
        <button
          disabled={busy}
          onClick={() => void give('cash')}
          className="h-11 flex-1 rounded-field text-[14px] font-bold disabled:opacity-45"
          style={{ border: '1px solid rgba(250,245,234,.3)', color: '#FAF5EA' }}
        >
          Наличными
        </button>
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
          <div className="flex items-center gap-2.5 text-[20px] font-extrabold tracking-tight">
            Стол {tableId} · {HALL_LABEL}
            <span
              className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold"
              style={
                isOpen
                  ? { background: 'rgba(213,249,78,.16)', color: '#D5F94E' }
                  : { background: 'rgba(250,245,234,.1)', color: '#9FB5A8' }
              }
            >
              {isOpen ? 'Открыт' : 'Закрыт'}
            </span>
          </div>
          <div className="text-[13px] font-semibold" style={{ color: '#9FB5A8' }}>
            официант {snap?.waiter?.name ?? WAITER_NAME}
            {connected ? '' : ' · нет связи…'}
          </div>
        </div>

        <div className="min-w-60 flex-1">
          <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span style={{ color: '#9FB5A8' }}>Оплачено по столу</span>
            <span className="ep-sum font-bold">
              {fmt(totals.paidTotal)} / {fmt(totals.tableTotal)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(250,245,234,.12)' }}>
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progress}%`, background: '#D5F94E' }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isOpen && may('close') && (
            <button
              onClick={confirmClose}
              className="h-11 rounded-[14px] px-4.5 text-[14px] font-extrabold"
              style={
                fullyPaid
                  ? { background: '#D5F94E', color: '#062119' }
                  : { border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }
              }
            >
              Закрыть стол
            </button>
          )}
          {may('reset') && (
            <button
              onClick={confirmReset}
              className="h-11 rounded-[14px] px-4 text-[14px] font-bold"
              style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }}
            >
              Сбросить демо
            </button>
          )}
          {may('hall') && (
            <a
              href={`${window.location.pathname}#/hall`}
              className="inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-bold"
              style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }}
            >
              ← в зал
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

      <div className="px-5.5 pt-4.5">
        {!connected && (
          <div
            className="mb-4 flex flex-wrap items-center gap-3 rounded-[20px] px-4.5 py-4"
            style={{ background: '#2A1410', border: '1.5px solid #C4451F' }}
          >
            <span className="ep-pulse size-2.5 rounded-full" style={{ background: '#FF8A63' }} />
            <span className="flex-1 text-[15px] font-bold" style={{ color: '#FFE3D8' }}>
              Нет связи с рестораном — показываем последнее известное состояние.
              Действия сейчас могут не дойти.
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
        {/* Очередь вызовов целиком. Раньше был виден только первый, а остальные
            превращались в «(ещё 2)» на кнопке: официант снимал верхний и не знал,
            кто под ним и сколько тот уже ждёт. */}
        {(snap?.calls?.length ?? 0) > 0 && (
          <div
            className="mb-4 rounded-[20px] px-4.5 py-4"
            style={{ background: '#2A1410', border: '1.5px solid #C4451F' }}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span className="ep-pulse size-2.5 rounded-full" style={{ background: '#FF8A63' }} />
              <span className="text-[15px] font-extrabold" style={{ color: '#FFE3D8' }}>
                {snap!.calls.length === 1
                  ? 'Вас зовут'
                  : `Вас зовут · ${snap!.calls.length} ${snap!.calls.length < 5 ? 'вызова' : 'вызовов'}`}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {snap!.calls.map(c => (
                <div
                  key={c.id ?? c.at}
                  className="flex flex-wrap items-center gap-3 rounded-field px-3.5 py-3"
                  style={{ background: 'rgba(250,245,234,.08)' }}
                >
                  <span className="min-w-0 flex-1 text-[15px] font-bold" style={{ color: '#FAF5EA' }}>
                    <b>{c.name ?? personas.find(p => p.id === c.personaId)?.name ?? 'Гость'}</b>{' '}
                    {/* Текст гостя важнее подписи причины: он говорит, зачем идти */}
                    {c.note ?? CALL_LABEL[c.reason] ?? CALL_LABEL.help}
                  </span>
                  <span className="ep-sum font-mono text-[14px] font-bold" style={{ color: '#FFC9B6' }}>
                    {fmtDur(now - c.at)}
                  </span>
                  {may('ack') && (
                    <button
                      onClick={() => void ackCall(c.id)}
                      className="h-11 rounded-[14px] px-4.5 text-[14px] font-extrabold"
                      style={{ background: '#D5F94E', color: '#062119' }}
                    >
                      Иду
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(snap?.openedAt || closed) && (
          <MetricsRow metrics={metrics} closed={closed} guests={personas.length} tipsTotal={tipsTotal} />
        )}
      </div>

      <div className="grid gap-4.5 px-5.5 pt-4.5 pb-5.5 xl:grid-cols-[24rem_1fr]">
        <div>
          {/* Гость с деньгами в руке — это срочнее всего остального на экране */}
          <CashRequest table={tableId ?? ''} snap={snap} onTaken={() => {}} />
          {may('refund') && <RefundCard snap={snap} />}
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
