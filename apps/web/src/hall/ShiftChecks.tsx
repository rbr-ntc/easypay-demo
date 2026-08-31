import { useState } from 'react'
import { apiShiftChecks } from '../api'
import type { ShiftChecksPayload } from '../api'
import { fmt } from '../format'

/**
 * Сходится ли смена целиком. Раньше экран смотрел только на деньги (платежи
 * против чеков) и печатал «касса сходится», пока расхождение по долгу в
 * 3 320 ₽ не видел никто. Сервер считает все четыре сверки — надо их читать.
 */
function everythingMatches(c: {
  matches: boolean
  debtMatches?: boolean
  overpaidMatches?: boolean
  writtenOffMatches?: boolean
}): boolean {
  return (
    c.matches &&
    c.debtMatches !== false &&
    c.overpaidMatches !== false &&
    // Списанное с кухни считается двумя разными путями и вправду может
    // разойтись: не проверять его — то же самое, что не проверять долг
    c.writtenOffMatches !== false
  )
}

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
    <div className="rounded-[20px] p-4.5" style={{ background: '#0C2C21' }}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="ep-brow" style={{ color: '#9FB5A8' }}>Реестр чеков</span>
        <button className="ml-auto h-9 rounded-field px-3.5 text-[13px] font-bold" style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }} onClick={() => void toggle()}>
          {open ? 'Свернуть' : 'Показать'}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-3">
          {busy && (
            <div className="flex items-center gap-2 py-4 text-base-content/60">
              <span className="loading loading-spinner loading-sm" /> Загружаем…
            </div>
          )}

          {!busy && control && (
            <div role="alert" className={`alert ${everythingMatches(control) ? 'alert-success' : 'alert-error'} flex-col items-stretch`}>
              {/* «Касса сходится» при 4 510 ₽ неполученных обнадёживает сильнее,
                  чем стоит: сверка честна по своей формуле (платежи против чеков),
                  но управляющая читает заголовок, а не формулу. */}
              <div className="font-bold">
                {!control.matches
                  ? 'Деньги не сходятся — разберитесь до закрытия смены'
                  : control.debtMatches === false
                    ? 'Долг в чеках не сходится с итогом смены'
                    : control.overpaidMatches === false
                      ? 'Переплата в чеках не сходится с итогом смены'
                      : control.writtenOffMatches === false
                        ? 'Списанное с кухни не сходится с итогом смены'
                        : shift && shift.debt > 0
                          ? `Всё сходится, но ${fmt(shift.debt)} не получено`
                          : 'Всё сходится'}
              </div>
              {/* Сверка считается по ВСЕЙ смене, а список обрезан сотней строк.
                  Молчать об этом — значит заменить «не сходится на ровном месте»
                  на «сходится по числам, которых на экране нет». */}
              {control.checksTotal !== undefined &&
                control.checksShown !== undefined &&
                control.checksTotal > control.checksShown && (
                  <div className="text-sm opacity-80">
                    Сверено {control.checksTotal} чеков, показано последних {control.checksShown}
                  </div>
                )}

              <table className="table table-sm">
                <tbody>
                  <tr>
                    <td>Сумма чеков</td>
                    <td className="text-right font-bold tabular-nums">{fmt(control.checksPaid)}</td>
                  </tr>
                  <tr>
                    <td>Выручка закрытых столов</td>
                    <td className="text-right font-bold tabular-nums">{fmt(control.closedRevenue)}</td>
                  </tr>
                  {control.openPaid > 0 && (
                    <tr>
                      <td>Оплачено на открытых столах</td>
                      <td className="text-right font-bold tabular-nums">{fmt(control.openPaid)}</td>
                    </tr>
                  )}
                  {shift && shift.debt > 0 && (
                    <tr className={control.debtMatches === false ? 'text-error' : ''}>
                      <td>
                        Ушли не заплатив
                        {control.debtMatches === false && control.checksDebt !== undefined
                          ? ` · по чекам ${fmt(control.checksDebt)}`
                          : ''}
                      </td>
                      <td className="text-right font-bold tabular-nums">{fmt(shift.debt)}</td>
                    </tr>
                  )}
                  {shift && (shift.writtenOff ?? 0) > 0 && (
                    <tr className={control.writtenOffMatches === false ? 'text-error' : ''}>
                      <td>
                        Снято с кухни — еду не отдали
                        {control.writtenOffMatches === false && control.checksWrittenOff !== undefined
                          ? ` · по чекам ${fmt(control.checksWrittenOff)}`
                          : ''}
                      </td>
                      <td className="text-right font-bold tabular-nums">{fmt(shift.writtenOff ?? 0)}</td>
                    </tr>
                  )}
                  {shift && shift.overpaid > 0 && (
                    <tr>
                      <td>Из них вернуть гостям</td>
                      <td className="text-right font-bold tabular-nums">{fmt(shift.overpaid)}</td>
                    </tr>
                  )}
                  {shift && (
                    <tr>
                      <td>Заработано (за вычетом возвратов)</td>
                      <td className="text-right font-bold tabular-nums">
                        {fmt(shift.netRevenue ?? shift.closedRevenue)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!busy && data?.checks.length === 0 && (
            <div className="py-4 text-base-content/60">Закрытых столов пока нет</div>
          )}

          {data?.checks.map(check => (
            <div className="card card-border bg-base-100" key={check.sessionId}>
              <div className="card-body p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <b className="text-lg">№{check.tableId}</b>
                  <span className="text-xs text-base-content/60">
                    {time(check.openedAt)} — {time(check.closedAt)} · гостей {check.guests}
                    {check.waiter ? ` · ${check.waiter}` : ''}
                  </span>
                </div>

                <table className="table table-xs">
                  <tbody>
                    {check.lines.map((l, i) => (
                      <tr key={i} className={l.cancelled ? 'text-base-content/40 line-through' : ''}>
                        <td>
                          {l.name}
                          {l.qty > 1 ? ` ×${l.qty}` : ''}
                          {l.guest ? ` · ${l.guest}` : ''}
                          {l.cancelled ? ` · снято: ${l.cancelReason ?? 'отменено'}` : ''}
                        </td>
                        <td className="text-right tabular-nums">{fmt(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex flex-wrap gap-2 border-t border-base-200 pt-2 text-sm">
                  <span>Счёт {fmt(check.total)}</span>
                  <span>Оплачено {fmt(check.paid)}</span>
                  {check.debt > 0 && <span className="badge badge-sm badge-error">Долг {fmt(check.debt)}</span>}
                  {check.overpaid > 0 && (
                    <span className="badge badge-sm badge-error">Вернуть {fmt(check.overpaid)}</span>
                  )}
                  {check.cancelledTotal > 0 && <span>Снято с кухни {fmt(check.cancelledTotal)}</span>}
                  {check.tips > 0 && <span>Чаевые {fmt(check.tips)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
