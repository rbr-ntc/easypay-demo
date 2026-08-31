import { Avatar } from '../avatars'
import { fmt } from '../format'
import { fmtDur } from './../waiter/duration'
import { describeTable, STATUS_LABEL } from '@easypay/domain/hall'
import type { HallCard } from '@easypay/domain/hall'
import type { Animal } from '../data'

const MAX_AVATARS = 4

/**
 * Статус читается левой полосой в 5 px — с двух метров это единственное, что
 * видно, и по ней официант выбирает, к какому столу идти. Цвета считает домен
 * (`packages/domain/hall.ts`), здесь только их вид.
 */
const STATUS_STRIPE: Record<string, string> = {
  free: '#2E4A3D',
  seated: '#6FB2E8',
  ordering: '#6FB2E8',
  cooking: '#D5F94E',
  eating: '#7FE3A8',
  paying: '#B9A6F0',
  dirty: '#FF8A63'
}

const ALERT_TINT: Record<string, { bg: string; fg: string }> = {
  danger: { bg: '#2A1410', fg: '#FFC9B6' },
  warn: { bg: 'rgba(233,194,79,.16)', fg: '#E9C24F' },
  info: { bg: 'rgba(250,245,234,.1)', fg: '#C6D5CC' }
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

  return (
    <a
      href={href}
      className="block rounded-[20px] p-4 transition-shadow hover:shadow-lg"
      style={{
        background: '#0C2C21',
        borderLeft: `5px solid ${STATUS_STRIPE[status] ?? STATUS_STRIPE.free}`,
        boxShadow: mine ? '0 0 0 1.5px #D5F94E' : undefined,
        opacity: free ? 0.72 : 1
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[24px] font-extrabold" style={{ color: '#FAF5EA' }}>
          {card.id}
        </span>
        {card.seats > 0 && (
          <span className="text-[12px] font-semibold" style={{ color: '#9FB5A8' }}>
            {card.seats} мест
          </span>
        )}
        {since && !free && (
          <span className="ml-auto font-mono text-[13px] font-bold" style={{ color: '#9FB5A8' }}>
            {fmtDur(now - since)}
          </span>
        )}
      </div>

      <div
        className="mt-2 text-[14px] font-extrabold"
        style={{ color: free ? '#9FB5A8' : STATUS_STRIPE[status] ?? '#FAF5EA' }}
      >
        {STATUS_LABEL[status]}
        {/* Готово и ждёт, пока унесут: это число приходило в данных и не
            показывалось ни на одном экране */}
        {(card.readyCount ?? 0) > 0 ? ` · ${card.readyCount} на раздаче` : ''}
      </div>

      {/* Освободившийся стол не должен помнить прошлых гостей */}
      {card.guests > 0 && !free && (
        <div className="mt-3 flex">
          {shown.map((p, i) => (
            <span
              key={`${p.name}-${i}`}
              className="flex size-7.5 items-center justify-center rounded-full"
              style={{ border: '2px solid #0C2C21', marginLeft: i === 0 ? 0 : -10 }}
            >
              <Avatar animal={p.animal as Animal} size={26} label={p.name} />
            </span>
          ))}
          {rest > 0 && (
            <span
              className="flex size-7.5 items-center justify-center rounded-full text-[12px] font-bold"
              style={{ border: '2px solid #0C2C21', background: '#123227', color: '#9FB5A8', marginLeft: -10 }}
            >
              +{rest}
            </span>
          )}
        </div>
      )}

      {card.tableTotal > 0 && !free && (
        <div
          className="mt-3 flex items-baseline justify-between pt-3"
          style={{ borderTop: '1px solid rgba(250,245,234,.12)' }}
        >
          <span className="ep-sum text-[16px] font-extrabold" style={{ color: '#FAF5EA' }}>
            {fmt(card.tableTotal)}
          </span>
          <span
            className="ep-sum text-[12px] font-semibold"
            style={{ color: card.remaining <= 0.01 ? '#7FE3A8' : '#9FB5A8' }}
          >
            {card.remaining <= 0.01 ? 'оплачен' : `осталось ${fmt(card.remaining)}`}
          </span>
        </div>
      )}

      {status === 'dirty' && onClean && (
        <button
          onClick={e => {
            e.preventDefault()
            onClean(card.id)
          }}
          className="mt-3 h-11 w-full rounded-field text-[14px] font-extrabold"
          style={{ background: '#D5F94E', color: '#062119' }}
        >
          Убрано
        </button>
      )}

      {alerts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {alerts.map(a => {
            const tint = ALERT_TINT[a.severity] ?? ALERT_TINT.info
            return (
              <span
                key={a.id}
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold"
                style={{ background: tint.bg, color: tint.fg }}
              >
                {a.label}
              </span>
            )
          })}
        </div>
      )}
    </a>
  )
}
