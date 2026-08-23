import { Avatar } from '../avatars'
import { fmt } from '../format'
import { fmtDur } from '../waiter/duration'
import { describeTable, STATUS_LABEL } from '@easypay/domain/hall'
import type { HallCard } from '@easypay/domain/hall'
import type { Animal } from '../data'

const MAX_AVATARS = 4

/**
 * Цвет статуса стола. Статусы считает домен (`packages/domain/hall.ts`) —
 * одинаково на сервере и клиенте, здесь только их вид.
 */
const STATUS_STYLE: Record<string, { dot: string; frame: string }> = {
  free: { dot: 'status-neutral', frame: 'border-base-300 bg-base-200/60' },
  seated: { dot: 'status-info', frame: 'border-info' },
  ordering: { dot: 'status-info', frame: 'border-info' },
  cooking: { dot: 'status-warning', frame: 'border-warning' },
  eating: { dot: 'status-success', frame: 'border-success' },
  paying: { dot: 'status-accent', frame: 'border-accent' },
  dirty: { dot: 'status-error', frame: 'border-error' }
}

const ALERT_BADGE: Record<string, string> = {
  danger: 'badge-error',
  warn: 'badge-warning',
  info: 'badge-info'
}

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
  const look = STATUS_STYLE[status] ?? STATUS_STYLE.free

  return (
    <a
      className={`card card-border bg-base-100 transition-shadow hover:shadow-md ${look.frame} ${
        mine ? 'ring-2 ring-primary ring-offset-1' : ''
      }`}
      href={href}
    >
      <div className="card-body gap-1.5 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold">№{card.id}</span>
          {card.seats > 0 && <span className="text-xs text-base-content/60">{card.seats} мест</span>}
          {since && !free && (
            <span className="ml-auto font-mono text-sm tabular-nums text-base-content/60">{fmtDur(now - since)}</span>
          )}
        </div>

        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className={`status ${look.dot}`} />
          {STATUS_LABEL[status]}
        </span>

        {/* Готово и ждёт, пока унесут: раньше это число приходило в данных
            и не показывалось ни на одном экране */}
        {(card.readyCount ?? 0) > 0 && (
          <span className="badge badge-sm badge-success">на раздаче {card.readyCount}</span>
        )}

        {status === 'dirty' && onClean && (
          <button
            className="btn btn-sm btn-primary"
            onClick={e => {
              e.preventDefault()
              onClean(card.id)
            }}
          >
            Убрано
          </button>
        )}

        <div className="flex items-center gap-2">
          {/* Освободившийся стол не должен помнить прошлых гостей: официант
              видел «Свободен · Ретест · остаток 250 ₽» и шёл искать человека,
              который давно ушёл */}
          {card.guests > 0 && !free ? (
            <>
              <div className="avatar-group -space-x-2">
                {shown.map((p, i) => (
                  <div key={`${p.name}-${i}`} className="avatar">
                    <Avatar animal={p.animal as Animal} size={26} label={p.name} />
                  </div>
                ))}
              </div>
              <span className="truncate text-xs text-base-content/60">
                {shown.map(p => p.name).join(', ')}
                {rest > 0 ? ` +${rest}` : ''}
              </span>
            </>
          ) : (
            <span className="text-xs text-base-content/60">{free ? 'Ждёт гостей' : 'Гостей нет'}</span>
          )}
        </div>

        {card.tableTotal > 0 && !free && (
          <div className="flex items-baseline justify-between">
            <span className="font-semibold tabular-nums">{fmt(card.tableTotal)}</span>
            <span className={`text-xs ${card.remaining <= 0.01 ? 'text-success' : 'text-base-content/60'}`}>
              {card.remaining <= 0.01 ? 'оплачен' : `остаток ${fmt(card.remaining)}`}
            </span>
          </div>
        )}

        {alerts.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {alerts.map(a => (
              <span key={a.id} className={`badge badge-sm ${ALERT_BADGE[a.severity] ?? 'badge-ghost'}`}>
                {a.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  )
}
