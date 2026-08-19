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
  if (lines.some(l => !l.sent && l.personaId === personaId)) return 'Выбирает'
  const sent = lines.filter(l => l.sent && l.personaId === personaId)
  if (!sent.length) return 'Смотрит меню'
  return sent.every(l => l.served) ? 'Подано' : 'Готовится'
}

const PAY_CHIP: Record<PayLabel, string> = {
  Оплачено: 'ep-w-chip ep-w-chip--ok',
  Частично: 'ep-w-chip ep-w-chip--part',
  Ожидает: 'ep-w-chip ep-w-chip--wait'
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
      <div className="ep-w-mono ep-w-cap">Гости стола · {personas.length}</div>
      <div className="ep-w-guests">
        {personas.map(p => {
          // Долю общего блюда считает сервер по фактическому списку участников
          // на момент отправки. Клиент не пересчитывает деньги — он их показывает.
          const own = totals.personaTotal(p.id)
          const paid = totals.personaPaid(p.id)
          const left = totals.personaRemaining(p.id)
          const payLabel = payLabelOf(paid, own, left)
          return (
            <div key={p.id} className="ep-w-guest">
              <Avatar animal={p.animal} size={46} label={p.name} />
              <div className="ep-w-guest-body">
                <div className="ep-w-guest-name">{p.name}</div>
                <div className="ep-w-guest-sum">
                  {fmt(own)} с долей общих{paid > 0 ? ` · внесено ${fmt(paid)}` : ''}
                  {left === 0 && own > 0 && paid === 0 ? ' · за него заплатили' : ''}
                </div>
              </div>
              <div className="ep-w-tags">
                <span className="ep-w-chip">{orderLabelOf(lines, p.id)}</span>
                <span className={PAY_CHIP[payLabel]}>{payLabel}</span>
              </div>
            </div>
          )
        })}

        {personas.length === 0 && (
          <div className="ep-w-empty">
            <div className="ep-w-empty-mark">+</div>
            <span>{tableOpen ? 'Ждём гостей…' : 'Стол свободен — гость откроет его, отсканировав QR'}</span>
          </div>
        )}
      </div>

      <div className="ep-w-divider" />
      <div className="ep-w-total">
        <span>Итого по столу</span>
        <span className="ep-w-total-sum">{fmt(totals.tableTotal)}</span>
      </div>
    </>
  )
}
