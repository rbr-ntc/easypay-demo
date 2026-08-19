import { fmtDur } from '../waiter/duration'
import { ticketUrgency } from '@easypay/domain/kitchen'
import type { KitchenTicket } from '@easypay/domain/kitchen'

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

  return (
    <div className={cancelled ? 'ep-k-ticket ep-k-ticket--cancelled' : 'ep-k-ticket'} data-urgency={cancelled ? 'ok' : ticketUrgency(ticket, now)}>
      <div className="ep-k-table">
        <div className="ep-k-table-num">№{ticket.tableId}</div>
        <div className="ep-k-table-zone">{ticket.zoneName}</div>
        <div className={ticket.station === 'bar' ? 'ep-k-station ep-k-station--bar' : 'ep-k-station'}>
          {ticket.station === 'bar' ? 'бар' : 'кухня'}
        </div>
      </div>

      <div className="ep-k-body">
        <div className="ep-k-dish">
          {ticket.name ?? ticket.dishId}
          {ticket.qty > 1 && <span className="ep-k-qty">×{ticket.qty}</span>}
        </div>
        {ticket.allergens?.length > 0 && (
          <div className="ep-k-allergens">аллергены: {ticket.allergens.join(' · ')}</div>
        )}

        {/* Модификатор, снимающий аллерген, — не пожелание, а запрет.
            Раньше «Без сметаны» стояло в одном ряду с «Без льда», а лактоза
            просто исчезала из списка: чем аккуратнее гость выбрал, тем меньше
            у повара было поводов насторожиться. */}
        {(ticket as any).removedAllergens?.map((r: any) => (
          <div key={r.id} className="ep-k-critical">
            {r.choice.toUpperCase()} — снимает {r.removes.join(' · ')}
          </div>
        ))}

        {(ticket as any).comment && (
          <div className="ep-k-comment">✎ {(ticket as any).comment}</div>
        )}
        {mods.length > 0 && (
          <div className="ep-k-mods">
            {mods.map(m => (
              <span key={m} className="ep-k-mod">
                {m}
              </span>
            ))}
          </div>
        )}
        <div className="ep-k-guest">
          {ticket.shared ? 'общее на стол' : ticket.guest}
          {ticket.waiterName ? ` · официант ${ticket.waiterName}` : ''}
          {onPass && ticket.readyAt
            ? ` · на раздаче ${fmtDur(now - ticket.readyAt)}`
            : cooking && ticket.startedAt
              ? ` · в работе ${fmtDur(now - ticket.startedAt)}`
              : ''}
        </div>
      </div>

      <div className="ep-k-wait">{ticket.sentAt ? fmtDur(now - ticket.sentAt) : '—'}</div>

      {cancelled ? (
        <div className="ep-k-cancel-box">
          <span className={(ticket as any).wasCooking ? 'ep-k-cancel ep-k-cancel--hot' : 'ep-k-cancel'}>
            {(ticket as any).wasCooking ? 'СНЯТЬ С ПЛИТЫ' : 'ОТМЕНА'} · {ticket.reason ?? 'стол закрыт'}
          </span>
          <button className="ep-k-btn ep-k-btn--quiet" disabled={busy} onClick={onAction}>
            Снял с плиты
          </button>
        </div>
      ) : (
      <button
        className={onPass ? 'ep-k-btn ep-k-btn--pass' : cooking ? 'ep-k-btn ep-k-btn--ready' : 'ep-k-btn'}
        disabled={busy}
        onClick={onAction}
      >
        {onPass ? 'Унёс гостю' : cooking ? 'Готово' : 'В работу'}
      </button>
      )}
    </div>
  )
}
