import { fmtDur } from '../waiter/duration'
import { ticketUrgency } from '@easypay/domain/kitchen'
import type { KitchenTicket } from '@easypay/domain/kitchen'
import { findDish } from '../data'

/**
 * Тикет читается с полутора метров, от плиты. Порядок сверху вниз повторяет
 * порядок вопросов повара: какой стол → сколько ждёт → что готовить → чего
 * нельзя → кому. Действие всегда одно и всегда внизу.
 */

/** Срочность красит рамку. Пороги живут в домене, здесь только вид. */
const URGENCY: Record<string, { bg: string; frame?: string }> = {
  ok: { bg: '#0C2C21' },
  warn: { bg: '#0C2C21', frame: '1.5px solid #E9C24F' },
  late: { bg: '#2A1410', frame: '1.5px solid #FF8A63' }
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
  const look = cancelled ? { bg: '#2A1410', frame: '2px solid #C4451F' } : URGENCY[ticketUrgency(ticket, now)]
  const removed = (ticket as any).removedAllergens as { id: string; choice: string; removes: string[] }[] | undefined
  const dish = findDish(ticket.dishId)

  // На раздаче — единственное место, где повару и официанту полезно фото:
  // блюдо готово и стоит под лампой, его надо узнать и унести. В очереди и в
  // работе картинка только мешает — там важны название и модификаторы.
  if (onPass && !cancelled && dish?.photo) {
    return (
      <div className="relative overflow-hidden rounded-[20px]">
        <img
          src={`./dishes/${dish.id}.jpg`}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-50"
        />
        <div
          className="relative p-4"
          style={{
            background:
              'linear-gradient(158deg, rgba(127,227,168,.2) 0%, rgba(4,23,18,.62) 45%, rgba(4,23,18,.76) 100%)',
            border: '1.5px solid rgba(127,227,168,.6)',
            borderRadius: 20,
            backdropFilter: 'blur(30px) saturate(1.8) brightness(.9)',
            boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,.3), 0 16px 36px -20px rgba(0,0,0,.8)'
          }}
        >
          <div className="flex items-baseline gap-2.5">
            <span className="text-[20px] font-extrabold" style={{ color: '#FAF5EA' }}>
              {ticket.tableId}
            </span>
            <span className="text-[12px] font-semibold" style={{ color: '#B6D8C4' }}>
              {ticket.station === 'bar' ? 'Бар' : ticket.zoneName}
            </span>
            <span className="ml-auto font-mono text-[20px] font-extrabold" style={{ color: '#7FE3A8' }}>
              {ticket.readyAt ? fmtDur(now - ticket.readyAt) : '—'}
            </span>
          </div>
          <div className="mt-2.5 text-[20px] leading-tight font-extrabold text-white">
            {ticket.name ?? ticket.dishId}
            {ticket.qty > 1 ? ` ×${ticket.qty}` : ''}
          </div>
          <div className="mt-2 text-[13px] font-bold" style={{ color: '#B6D8C4' }}>
            {ticket.shared ? 'общее на стол' : ticket.guest} · остывает
          </div>
          <button
            disabled={busy}
            onClick={onAction}
            className="mt-3.5 h-13 w-full rounded-[14px] text-[16px] font-extrabold disabled:opacity-45"
            style={{ background: '#7FE3A8', color: '#04231A' }}
          >
            Забрать в зал
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-[20px] p-4"
      style={{
        background: look.bg,
        border: look.frame,
        // Станция читается полосой: моё это или барменово
        borderLeft: `5px solid ${ticket.station === 'bar' ? '#4FA3E3' : '#D5F94E'}`
      }}
    >
      <div className="flex items-baseline gap-2.5">
        <span className="text-[20px] font-extrabold" style={{ color: '#FAF5EA' }}>
          {ticket.tableId}
        </span>
        <span className="text-[12px] font-semibold" style={{ color: '#9FB5A8' }}>
          {ticket.station === 'bar' ? 'Бар' : ticket.zoneName}
        </span>
        <span className="ml-auto font-mono text-[18px] font-extrabold" style={{ color: '#FAF5EA' }}>
          {ticket.sentAt ? fmtDur(now - ticket.sentAt) : '—'}
        </span>
      </div>

      <div className="mt-2.5 text-[20px] leading-tight font-extrabold" style={{ color: '#FAF5EA' }}>
        {ticket.name ?? ticket.dishId}
        {ticket.qty > 1 ? ` ×${ticket.qty}` : ''}
      </div>

      {/* Модификатор, снимающий аллерген, — не пожелание, а запрет. Раньше
          «Без сметаны» стояло в одном ряду с «Без льда», а лактоза просто
          исчезала из списка: чем аккуратнее выбрал гость, тем меньше у повара
          было поводов насторожиться. */}
      {removed?.map(r => (
        <div
          key={r.id}
          className="mt-2.5 rounded-xl px-3 py-2.5 text-[14px] font-extrabold"
          style={{ background: '#9E4225', color: '#FFF1EC' }}
        >
          {r.choice.toUpperCase()} — снимает {r.removes.join(' · ')}
        </div>
      ))}

      {ticket.allergens?.length > 0 && (
        <div className="mt-2 text-[13px] font-bold" style={{ color: '#E9C24F' }}>
          аллергены: {ticket.allergens.join(' · ')}
        </div>
      )}

      {(ticket as any).comment && (
        <div className="mt-2 text-[14px] font-bold" style={{ color: '#FAF5EA' }}>
          ✎ {(ticket as any).comment}
        </div>
      )}

      {mods.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {mods.map(m => (
            <span
              key={m}
              className="inline-flex h-7 items-center rounded-full px-3 text-[13px] font-bold"
              style={{ background: 'rgba(250,245,234,.1)', color: '#C6D5CC' }}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 text-[13px] font-semibold" style={{ color: '#9FB5A8' }}>
        {ticket.shared ? 'общее на стол' : ticket.guest}
        {ticket.waiterName ? ` · ${ticket.waiterName}` : ''}
        {onPass && ticket.readyAt
          ? ` · на раздаче ${fmtDur(now - ticket.readyAt)}`
          : cooking && ticket.startedAt
            ? ` · в работе ${fmtDur(now - ticket.startedAt)}`
            : ''}
      </div>

      {cancelled ? (
        <>
          <div className="mt-2.5 text-[14px] font-extrabold" style={{ color: '#FF8A63' }}>
            {(ticket as any).wasCooking ? 'СНЯТЬ С ПЛИТЫ' : 'ОТМЕНА'} · {ticket.reason ?? 'стол закрыт'}
          </div>
          <button
            disabled={busy}
            onClick={onAction}
            className="mt-3.5 h-13 w-full rounded-[14px] text-[16px] font-extrabold disabled:opacity-45"
            style={{ border: '1.5px solid rgba(250,245,234,.3)', color: '#FAF5EA' }}
          >
            Снял с плиты
          </button>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={onAction}
          className="mt-3.5 h-13 w-full rounded-[14px] text-[16px] font-extrabold disabled:opacity-45"
          style={
            onPass
              ? { background: '#7FE3A8', color: '#04231A' }
              : cooking
                ? { background: '#D5F94E', color: '#062119' }
                : { background: '#FAF5EA', color: '#062119' }
          }
        >
          {onPass ? 'Забрать в зал' : cooking ? 'Готово, на раздачу' : 'В работу'}
        </button>
      )}
    </div>
  )
}
