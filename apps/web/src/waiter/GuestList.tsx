import { Avatar } from '../avatars'
import { fmt } from '../format'
import type { ServerLine, ServerPersona } from '../api'
import type { Totals } from '../store'

type PayLabel = 'Оплачено' | 'Частично' | 'Ожидает'

/**
 * За гостя мог заплатить сосед — тогда лично он ничего не должен, даже если
 * сам не платил. Официант, подошедший «по экрану», иначе просит деньги дважды.
 */
function payLabelOf(paid: number, total: number, remaining: number): PayLabel {
  if (total > 0 && remaining <= 0.01) return 'Оплачено'
  return paid > 0 ? 'Частично' : 'Ожидает'
}

function orderLabelOf(lines: ServerLine[], personaId: string): string {
  const mine = lines.filter(l => l.personaId === personaId && !l.cancelled)
  if (mine.some(l => !l.sent)) return 'Выбирает'

  const sent = mine.filter(l => l.sent)
  if (!sent.length) return 'Смотрит меню'
  // Отменённые не ждут подачи — раньше из-за них гость с полностью съеденным
  // заказом навсегда оставался «Готовится»
  if (sent.every(l => l.served)) return 'Подано'
  return sent.some(l => (l as any).readyAt && !l.served) ? 'Несут' : 'Готовится'
}

const PAY_CHIP: Record<PayLabel, string> = {
  Оплачено: 'badge badge-sm badge-success',
  Частично: 'badge badge-sm badge-warning',
  Ожидает: 'badge badge-sm badge-ghost'
}

export function GuestList({
  personas,
  lines,
  totals,
  tableOpen
}: {
  personas: ServerPersona[]
  lines: ServerLine[]
  totals: Totals
  tableOpen: boolean
}) {
  return (
    <>
      <div className="ep-brow mb-2.5" style={{ color: '#9FB5A8' }}>
        Гости стола · {personas.length}
      </div>
      <ul className="list rounded-[20px]" style={{ background: '#0C2C21' }}>
        {personas.map(p => {
          // Долю общего блюда считает сервер по фактическому списку участников
          // на момент отправки. Клиент не пересчитывает деньги — он их показывает.
          const own = totals.personaTotal(p.id)
          const paid = totals.personaPaid(p.id)
          const left = totals.personaRemaining(p.id)
          const payLabel = payLabelOf(paid, own, left)
          return (
            <li key={p.id} className="list-row">
              <Avatar animal={p.animal} size={46} label={p.name} />
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs" style={{ color: '#9FB5A8' }}>
                  {fmt(own)} с долей общих{paid > 0 ? ` · внесено ${fmt(paid)}` : ''}
                  {left === 0 && own > 0 && paid === 0 ? ' · за него заплатили' : ''}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="badge badge-sm badge-ghost">{orderLabelOf(lines, p.id)}</span>
                <span className={PAY_CHIP[payLabel]}>{payLabel}</span>
              </div>
            </li>
          )
        })}

        {personas.length === 0 && (
          <li className="list-row text-[#9FB5A8]">
            <span>{tableOpen ? 'Ждём гостей…' : 'Стол свободен — гость откроет его, отсканировав QR'}</span>
          </li>
        )}
      </ul>

      <div className="my-3" style={{ borderTop: '1px solid #123227' }} />
      <div className="flex items-baseline justify-between px-1">
        <span>Итого по столу</span>
        <span className="text-xl font-bold tabular-nums">{fmt(totals.tableTotal)}</span>
      </div>
    </>
  )
}
