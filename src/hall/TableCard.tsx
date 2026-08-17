import { Avatar } from '../avatars'
import { fmt } from '../format'
import { fmtDur } from '../waiter/duration'
import { describeTable, STATUS_LABEL } from '../../shared/hall.js'
import type { HallCard } from '../../shared/hall.js'
import type { Animal } from '../data'

const MAX_AVATARS = 4

/** Карточка стола в зале: клик уводит на экран этого стола. */
export function TableCard({ card, now }: { card: HallCard; now: number }) {
  const { status, since, alerts } = describeTable(card, now)
  const free = status === 'free'
  const href = `${window.location.pathname}?t=${encodeURIComponent(card.id)}#/waiter`
  const shown = card.personas.slice(0, MAX_AVATARS)
  const rest = card.personas.length - shown.length

  return (
    <a className={free ? 'ep-h-card ep-h-card--free' : 'ep-h-card'} data-status={status} href={href}>
      <div className="ep-h-card-head">
        <span className="ep-h-card-num">№{card.id}</span>
        {card.seats > 0 && <span className="ep-h-card-seats">{card.seats} мест</span>}
        {since && !free && <span className="ep-h-card-timer">{fmtDur(now - since)}</span>}
      </div>

      <span className="ep-h-status">
        <span className="ep-h-status-dot" />
        {STATUS_LABEL[status]}
      </span>

      <div className="ep-h-card-guests">
        {card.guests > 0 ? (
          <>
            <div className="ep-h-card-avatars">
              {shown.map((p, i) => (
                <Avatar key={`${p.name}-${i}`} animal={p.animal as Animal} size={26} label={p.name} />
              ))}
            </div>
            <span className="ep-h-card-names">
              {shown.map(p => p.name).join(', ')}
              {rest > 0 ? ` +${rest}` : ''}
            </span>
          </>
        ) : (
          <span className="ep-h-card-names">{free ? 'Ждёт гостей' : 'Гостей нет'}</span>
        )}
      </div>

      {card.tableTotal > 0 && (
        <div className="ep-h-card-money">
          <span className="ep-h-card-total">{fmt(card.tableTotal)}</span>
          <span className={card.remaining <= 0.01 ? 'ep-h-card-rest ep-h-card-rest--ok' : 'ep-h-card-rest'}>
            {card.remaining <= 0.01 ? 'оплачен' : `остаток ${fmt(card.remaining)}`}
          </span>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="ep-h-card-alerts">
          {alerts.map(a => (
            <span key={a.id} className={`ep-h-alert ep-h-alert--${a.severity}`}>
              {a.label}
            </span>
          ))}
        </div>
      )}
    </a>
  )
}
