import { Avatar } from '../avatars'
import { fmt } from '../format'
import { fmtDur } from '../waiter/duration'
import { describeTable, STATUS_LABEL } from '@easypay/domain/hall'
import type { HallCard } from '@easypay/domain/hall'
import type { Animal } from '../data'

const MAX_AVATARS = 4

/** Карточка стола в зале: клик уводит на экран этого стола. */
export function TableCard({
  card,
  now,
  mine,
  onClean
}: {
  card: HallCard
  now: number
  mine?: boolean
  onClean?: (id: string) => void
}) {
  const { status, since, alerts } = describeTable(card, now)
  const free = status === 'free'
  const href = `${window.location.pathname}?t=${encodeURIComponent(card.id)}#/waiter`
  const shown = card.personas.slice(0, MAX_AVATARS)
  const rest = card.personas.length - shown.length
  const className = ['ep-h-card', free ? 'ep-h-card--free' : '', mine ? 'ep-h-card--mine' : ''].filter(Boolean).join(' ')

  return (
    <a className={className} data-status={status} href={href}>
      <div className="ep-h-card-head">
        <span className="ep-h-card-num">№{card.id}</span>
        {card.seats > 0 && <span className="ep-h-card-seats">{card.seats} мест</span>}
        {since && !free && <span className="ep-h-card-timer">{fmtDur(now - since)}</span>}
      </div>

      <span className="ep-h-status">
        <span className="ep-h-status-dot" />
        {STATUS_LABEL[status]}
      </span>

      {/* Готово и ждёт, пока унесут: раньше это число приходило в данных
          и не показывалось ни на одном экране */}
      {(card.readyCount ?? 0) > 0 && (
        <span className="ep-h-ready">на раздаче {card.readyCount}</span>
      )}

      {status === 'dirty' && onClean && (
        <button
          className="ep-h-clean"
          onClick={e => {
            e.preventDefault()
            onClean(card.id)
          }}
        >
          Убрано
        </button>
      )}

      <div className="ep-h-card-guests">
        {/* Освободившийся стол не должен помнить прошлых гостей: официант
            видел «Свободен · Ретест · остаток 250 ₽» и шёл искать человека,
            который давно ушёл */}
        {card.guests > 0 && !free ? (
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

      {card.tableTotal > 0 && !free && (
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
