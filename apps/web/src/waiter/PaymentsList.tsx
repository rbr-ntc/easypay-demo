import { Avatar } from '../avatars'
import { fmt } from '../format'
import type { ServerPayment, ServerPersona } from '../api'

const SCOPE_LABEL: Record<string, string> = {
  own: 'своя часть',
  equal: 'поровну',
  full: 'весь стол'
}

export function PaymentsList({ payments, personas }: { payments: ServerPayment[]; personas: ServerPersona[] }) {
  if (payments.length === 0) return null
  const nameOf = (pid: string) => personas.find(p => p.id === pid)?.name ?? '?'
  const animalOf = (pid: string) => personas.find(p => p.id === pid)?.animal ?? 'fox'

  return (
    <>
      <div className="ep-w-mono ep-w-cap">Оплаты</div>
      <div className="ep-w-panel">
        {payments.map((p, i) => (
          <div key={`${p.personaId}-${p.at}-${i}`} className="ep-w-row">
            <Avatar animal={animalOf(p.personaId)} size={34} />
            <div className="ep-w-row-body">
              <div className="ep-w-row-title">{nameOf(p.personaId)}</div>
              <div className="ep-w-row-sub">{SCOPE_LABEL[p.scope] ?? p.scope} · СБП</div>
            </div>
            <span className="ep-w-row-sum ep-w-row-sum--ok">{fmt(p.amount)}</span>
          </div>
        ))}
      </div>
    </>
  )
}
