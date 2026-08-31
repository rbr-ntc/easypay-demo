import { Avatar } from '../avatars'
import { fmt } from '../format'
import type { ServerPayment, ServerPersona } from '../api'

/** Наличные, карта и СБП — разные деньги, вечером они сверяются по-разному. */
const METHOD_LABEL: Record<string, string> = {
  sbp: 'СБП',
  card: 'карта',
  cash: 'наличные',
  tpay: 'T-Pay',
  sber: 'SberPay',
  mir: 'Mir Pay'
}

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
      <div className="ep-brow mt-4 mb-2.5" style={{ color: '#9FB5A8' }}>Оплаты</div>
      <ul className="list rounded-[20px]" style={{ background: '#0C2C21' }}>
        {payments.map((p, i) => (
          <li key={`${p.personaId}-${p.at}-${i}`} className="list-row">
            <Avatar animal={animalOf(p.personaId)} size={34} />
            <div>
              <div className="font-semibold">{nameOf(p.personaId)}</div>
              <div className="text-xs" style={{ color: '#9FB5A8' }}>
                {SCOPE_LABEL[p.scope] ?? p.scope} · {METHOD_LABEL[p.method ?? 'sbp'] ?? 'СБП'}
                {p.takenByName ? ` · принял ${p.takenByName}` : ''}
              </div>
            </div>
            <span className="ep-sum font-semibold" style={{ color: '#7FE3A8' }}>{fmt(p.amount)}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
