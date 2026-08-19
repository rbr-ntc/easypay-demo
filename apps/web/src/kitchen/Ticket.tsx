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
          {cooking && ticket.startedAt ? ` · в работе ${fmtDur(now - ticket.startedAt)}` : ''}
        </div>
      </div>

      <div className="ep-k-wait">{ticket.sentAt ? fmtDur(now - ticket.sentAt) : '—'}</div>

      {cancelled ? (
        <span className="ep-k-cancel">ОТМЕНА · {ticket.reason ?? 'стол закрыт'}</span>
      ) : (
      <button
        className={cooking ? 'ep-k-btn ep-k-btn--ready' : 'ep-k-btn'}
        disabled={busy}
        onClick={onAction}
      >
        {cooking ? 'Готово' : 'В работу'}
      </button>
      )}
    </div>
  )
}
