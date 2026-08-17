import { findDish } from '../data'
import { fmtDur } from '../waiter/duration'
import { ticketUrgency } from '../../shared/kitchen.js'
import type { KitchenTicket } from '../../shared/kitchen.js'

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
  const dish = findDish(ticket.dishId)
  const cooking = !!ticket.startedAt
  const mods = Object.values(ticket.options ?? {})

  return (
    <div className="ep-k-ticket" data-urgency={ticketUrgency(ticket, now)}>
      <div className="ep-k-table">
        <div className="ep-k-table-num">№{ticket.tableId}</div>
        <div className="ep-k-table-zone">{ticket.zoneName}</div>
      </div>

      <div className="ep-k-body">
        <div className="ep-k-dish">
          {dish?.name ?? ticket.dishId}
          {ticket.qty > 1 && <span className="ep-k-qty">×{ticket.qty}</span>}
        </div>
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
          {cooking && ticket.startedAt ? ` · в работе ${fmtDur(now - ticket.startedAt)}` : ''}
        </div>
      </div>

      <div className="ep-k-wait">{ticket.sentAt ? fmtDur(now - ticket.sentAt) : '—'}</div>

      <button
        className={cooking ? 'ep-k-btn ep-k-btn--ready' : 'ep-k-btn'}
        disabled={busy}
        onClick={onAction}
      >
        {cooking ? 'Готово' : 'В работу'}
      </button>
    </div>
  )
}
