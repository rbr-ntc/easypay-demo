import { fmtDur } from '../waiter/duration'
import { ticketUrgency } from '@easypay/domain/kitchen'
import type { KitchenTicket } from '@easypay/domain/kitchen'

/**
 * Цвет тикета по срочности. Жёлтый после 10 минут, красный после 20 — пороги
 * живут в домене (`packages/domain/kitchen.ts`), здесь только их вид.
 */
const URGENCY_STYLE: Record<string, string> = {
  ok: 'border-base-300',
  warn: 'border-warning bg-warning/10',
  late: 'border-error bg-error/10'
}

export function Ticket({
  ticket,
  now,
  busy,
  onAction
}: {
  ticket: KitchenTicket
  now: number
  busy: boolean
  onAction: () => void
}) {
  const cooking = !!ticket.startedAt
  const onPass = !!ticket.readyAt
  const mods = Object.values(ticket.options ?? {})
  const cancelled = !!ticket.cancelledAt
  // Отменённое — самое заметное на доске, а не самое бледное: это то, что
  // повару надо снять с огня прямо сейчас
  const frame = cancelled ? 'border-error border-2 bg-error/10' : URGENCY_STYLE[ticketUrgency(ticket, now)]

  return (
    <div className={`card card-border ${frame} bg-base-100`}>
      <div className="card-body flex-row items-start gap-3 p-3">
        <div className="w-16 shrink-0 text-center">
          <div className="text-xl font-bold">№{ticket.tableId}</div>
          <div className="text-xs text-base-content/60">{ticket.zoneName}</div>
          {/* Станция — первое, что повару нужно знать: моё это или барменово */}
          <span className={`badge badge-sm mt-1 ${ticket.station === 'bar' ? 'badge-info' : 'badge-neutral'}`}>
            {ticket.station === 'bar' ? 'бар' : 'кухня'}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">
            {ticket.name ?? ticket.dishId}
            {ticket.qty > 1 && <span className="badge badge-neutral ml-2">×{ticket.qty}</span>}
          </div>
          {ticket.allergens?.length > 0 && (
            <div className="mt-1 text-sm font-medium text-warning">аллергены: {ticket.allergens.join(' · ')}</div>
          )}

          {/* Модификатор, снимающий аллерген, — не пожелание, а запрет.
              Раньше «Без сметаны» стояло в одном ряду с «Без льда», а лактоза
              просто исчезала из списка: чем аккуратнее гость выбрал, тем меньше
              у повара было поводов насторожиться. */}
          {(ticket as any).removedAllergens?.map((r: any) => (
            <div key={r.id} role="alert" className="alert alert-error mt-1.5 py-1.5 text-sm font-bold">
              <span>
                {r.choice.toUpperCase()} — снимает {r.removes.join(' · ')}
              </span>
            </div>
          ))}

          {(ticket as any).comment && (
            <div className="mt-1.5 text-sm font-medium">✎ {(ticket as any).comment}</div>
          )}
          {mods.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {mods.map(m => (
                <span key={m} className="badge badge-sm badge-ghost">
                  {m}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1.5 text-xs text-base-content/60">
            {ticket.shared ? 'общее на стол' : ticket.guest}
            {ticket.waiterName ? ` · официант ${ticket.waiterName}` : ''}
            {onPass && ticket.readyAt
              ? ` · на раздаче ${fmtDur(now - ticket.readyAt)}`
              : cooking && ticket.startedAt
                ? ` · в работе ${fmtDur(now - ticket.startedAt)}`
                : ''}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="font-mono text-lg font-bold tabular-nums">
            {ticket.sentAt ? fmtDur(now - ticket.sentAt) : '—'}
          </div>
          {cancelled ? (
            <>
              <span className="badge badge-error">
                {(ticket as any).wasCooking ? 'СНЯТЬ С ПЛИТЫ' : 'ОТМЕНА'} · {ticket.reason ?? 'стол закрыт'}
              </span>
              <button className="btn btn-sm" disabled={busy} onClick={onAction}>
                Снял с плиты
              </button>
            </>
          ) : (
            <button
              className={`btn ${onPass ? 'btn-success' : cooking ? 'btn-warning' : 'btn-primary'}`}
              disabled={busy}
              onClick={onAction}
            >
              {onPass ? 'Унёс гостю' : cooking ? 'Готово' : 'В работу'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
