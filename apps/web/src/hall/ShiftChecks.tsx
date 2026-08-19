import { useState } from 'react'
import { apiShiftChecks } from '../api'
import type { ShiftChecksPayload } from '../api'
import { fmt } from '../format'

function time(at: number): string {
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Реестр чеков смены: то, чем сводят кассу.
 *
 * Ручка на сервере была с самого начала, а экрана не было — управляющая
 * несколько смен подряд просила «объяснить владельцу каждую цифру» и не могла
 * даже посмотреть, из чего они складываются. Здесь состав каждого закрытого
 * стола и блок сверки: сумма чеков против выручки закрытых столов.
 */
export function ShiftChecks() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ShiftChecksPayload | null>(null)
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setBusy(true)
    setData(await apiShiftChecks())
    setBusy(false)
  }

  const control = data?.control
  const shift = data?.shift

  return (
    <div className="ep-h-zone">
      <div className="ep-h-zone-title">
        <span className="ep-h-zone-name">Реестр чеков</span>
        <button className="ep-w-btn ep-w-btn--quiet" onClick={() => void toggle()}>
          {open ? 'Свернуть' : 'Показать'}
        </button>
      </div>

      {open && (
        <div className="ep-h-checks">
          {busy && <div className="ep-h-empty">Загружаем…</div>}

          {!busy && control && (
            <div className={control.matches ? 'ep-h-control ep-h-control--ok' : 'ep-h-control ep-h-control--bad'}>
              {/* «Касса сходится» при 4 510 ₽ неполученных обнадёживает сильнее,
                  чем стоит: сверка честна по своей формуле (платежи против чеков),
                  но управляющая читает заголовок, а не формулу. */}
              <div className="ep-h-control-head">
                {!control.matches
                  ? 'Касса не сходится — разберитесь до закрытия смены'
                  : shift && shift.debt > 0
                    ? `Касса сходится, но ${fmt(shift.debt)} не получено`
                    : 'Касса сходится'}
              </div>
              <div className="ep-h-control-row">
                <span>Сумма чеков</span>
                <b>{fmt(control.checksPaid)}</b>
              </div>
              <div className="ep-h-control-row">
                <span>Выручка закрытых столов</span>
                <b>{fmt(control.closedRevenue)}</b>
              </div>
              {control.openPaid > 0 && (
                <div className="ep-h-control-row">
                  <span>Оплачено на открытых столах</span>
                  <b>{fmt(control.openPaid)}</b>
                </div>
              )}
              {shift && shift.debt > 0 && (
                <div className="ep-h-control-row">
                  <span>Ушли не заплатив</span>
                  <b>{fmt(shift.debt)}</b>
                </div>
              )}
              {shift && (shift.writtenOff ?? 0) > 0 && (
                <div className="ep-h-control-row">
                  <span>Снято с кухни — еду не отдали</span>
                  <b>{fmt(shift.writtenOff ?? 0)}</b>
                </div>
              )}
              {shift && shift.overpaid > 0 && (
                <div className="ep-h-control-row">
                  <span>Из них вернуть гостям</span>
                  <b>{fmt(shift.overpaid)}</b>
                </div>
              )}
              {shift && (
                <div className="ep-h-control-row">
                  <span>Заработано (за вычетом возвратов)</span>
                  <b>{fmt(shift.netRevenue ?? shift.closedRevenue)}</b>
                </div>
              )}
            </div>
          )}

          {!busy && data?.checks.length === 0 && <div className="ep-h-empty">Закрытых столов пока нет</div>}

          {data?.checks.map(check => (
            <div className="ep-h-check" key={check.sessionId}>
              <div className="ep-h-check-head">
                <b>№{check.tableId}</b>
                <span className="ep-h-check-time">
                  {time(check.openedAt)} — {time(check.closedAt)} · гостей {check.guests}
                  {check.waiter ? ` · ${check.waiter}` : ''}
                </span>
              </div>

              {check.lines.map((l, i) => (
                <div className={l.cancelled ? 'ep-h-check-row ep-h-check-row--off' : 'ep-h-check-row'} key={i}>
                  <span>
                    {l.name}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                    {l.guest ? ` · ${l.guest}` : ''}
                    {l.cancelled ? ` · снято: ${l.cancelReason ?? 'отменено'}` : ''}
                  </span>
                  <span>{fmt(l.amount)}</span>
                </div>
              ))}

              <div className="ep-h-check-total">
                <span>Счёт {fmt(check.total)}</span>
                <span>Оплачено {fmt(check.paid)}</span>
                {check.debt > 0 && <span className="ep-h-check-debt">Долг {fmt(check.debt)}</span>}
                {check.overpaid > 0 && <span className="ep-h-check-debt">Вернуть {fmt(check.overpaid)}</span>}
                {check.cancelledTotal > 0 && <span>Снято с кухни {fmt(check.cancelledTotal)}</span>}
                {check.tips > 0 && <span>Чаевые {fmt(check.tips)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
