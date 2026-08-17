import { Avatar, SharedIcon } from '../avatars'
import { findDish } from '../data'
import { fmt } from '../format'
import { fmtDur } from './duration'
import type { ServerLine, ServerPersona } from '../api'

export function OrderFeed({
  lines,
  personas,
  now,
  onServe
}: {
  lines: ServerLine[]
  personas: ServerPersona[]
  now: number
  onServe: (uid: number) => void
}) {
  const nameOf = (pid: string) => personas.find(p => p.id === pid)?.name ?? '?'
  const animalOf = (pid: string) => personas.find(p => p.id === pid)?.animal ?? 'fox'

  return (
    <>
      <div className="ep-w-mono ep-w-cap">Живая лента заказа</div>
      <div className="ep-w-panel">
        {lines.length === 0 && <div className="ep-w-placeholder">Пока пусто — гости ещё ничего не добавили</div>}
        {lines.map(l => {
          const d = findDish(l.dishId)
          if (!d) return null
          return (
            <div key={l.uid} className="ep-w-row">
              {l.shared ? <SharedIcon size={40} /> : <Avatar animal={animalOf(l.personaId)} size={40} label={nameOf(l.personaId)} />}
              <div className="ep-w-row-body">
                <div className="ep-w-row-title">
                  {d.name}
                  {l.qty > 1 ? ` ×${l.qty}` : ''}
                </div>
                <div className="ep-w-row-sub">
                  {l.shared ? `общее на стол · добавил(а) ${nameOf(l.personaId)}` : `${nameOf(l.personaId)} · своё`}
                </div>
              </div>
              {l.served ? (
                <span className="ep-w-state ep-w-state--served">
                  ПОДАНО{l.sentAt && l.servedAt ? ` · ${fmtDur(l.servedAt - l.sentAt)}` : ''}
                </span>
              ) : l.sent ? (
                <button className="ep-w-state ep-w-state--cooking" title="Отметить поданным" onClick={() => onServe(l.uid)}>
                  ГОТОВИТСЯ {l.sentAt ? fmtDur(now - l.sentAt) : ''} → ПОДАТЬ ✓
                </button>
              ) : (
                <span className="ep-w-state">ЧЕРНОВИК</span>
              )}
              <span className="ep-w-row-sum">{fmt(d.price * l.qty)}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
