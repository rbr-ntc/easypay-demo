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
      <div className="mt-4 mb-2 font-mono text-xs uppercase tracking-widest text-base-content/60">Оплаты</div>
      <ul className="list rounded-box bg-base-100">
        {payments.map((p, i) => (
          <li key={`${p.personaId}-${p.at}-${i}`} className="list-row">
            <Avatar animal={animalOf(p.personaId)} size={34} />
            <div>
              <div className="font-semibold">{nameOf(p.personaId)}</div>
              <div className="text-xs text-base-content/60">
                {SCOPE_LABEL[p.scope] ?? p.scope} · {METHOD_LABEL[p.method ?? 'sbp'] ?? 'СБП'}
                {p.takenByName ? ` · принял ${p.takenByName}` : ''}
              </div>
            </div>
            <span className="font-semibold tabular-nums text-success">{fmt(p.amount)}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
