import { Avatar, SharedIcon } from '../avatars'
import { findDish, optionsLabel } from '../data'
import { fmt } from '../format'
import { fmtDur } from './duration'
import type { ServerLine, ServerPersona } from '../api'

export function OrderFeed({
  lines,
  personas,
  now,
  canServe = true,
  onStart,
  onServe
}: {
  lines: ServerLine[]
  personas: ServerPersona[]
  now: number
  canServe?: boolean
  onStart: (uid: number) => void
  onServe: (uid: number) => void
}) {
  const nameOf = (pid: string) => personas.find(p => p.id === pid)?.name ?? '?'
  const animalOf = (pid: string) => personas.find(p => p.id === pid)?.animal ?? 'fox'

  return (
    <>
      <div className="ep-brow mt-4 mb-2.5" style={{ color: '#9FB5A8' }}>
        Живая лента заказа
      </div>
      <ul className="list rounded-[20px]" style={{ background: '#0C2C21' }}>
        {lines.length === 0 && (
          <li className="list-row" style={{ color: '#9FB5A8' }}>Пока пусто — гости ещё ничего не добавили</li>
        )}
        {lines.map(l => {
          const d = findDish(l.dishId)
          if (!d) return null
          return (
            <li key={l.uid} className="list-row">
              {l.shared ? (
                <SharedIcon size={40} />
              ) : (
                <Avatar animal={animalOf(l.personaId)} size={40} label={nameOf(l.personaId)} />
              )}
              <div>
                <div className="font-semibold">
                  {d.name}
                  {l.qty > 1 ? ` ×${l.qty}` : ''}
                </div>
                <div className="text-xs" style={{ color: '#9FB5A8' }}>
                  {l.shared ? `общее на стол · добавил(а) ${nameOf(l.personaId)}` : `${nameOf(l.personaId)} · своё`}
                  {optionsLabel(l.options) ? ` · ${optionsLabel(l.options)}` : ''}
                </div>
              </div>
              {l.cancelled ? (
                <span className="badge badge-sm badge-error">
                  ОТМЕНЕНО{l.cancelReason ? ` · ${l.cancelReason}` : ''}
                </span>
              ) : l.served ? (
                <span className="badge badge-sm badge-info">
                  ПОДАНО{l.sentAt && l.servedAt ? ` · ${fmtDur(l.servedAt - l.sentAt)}` : ''}
                </span>
              ) : l.sent && canServe ? (
                <button
                  className="btn btn-sm btn-warning"
                  title={l.startedAt ? 'Отметить поданным' : 'Взять в работу'}
                  onClick={() => (l.startedAt ? onServe(l.uid) : onStart(l.uid))}
                >
                  {/* Между «готовится» и «подано» есть раздача: блюдо готово и
                      остывает под лампой, пока его не унесли гостю. Официант
                      узнавал об этом, только дойдя до окна. */}
                  {(l as any).readyAt ? 'НА РАЗДАЧЕ' : l.startedAt ? 'ГОТОВИТСЯ' : 'В ОЧЕРЕДИ'}{' '}
                  {(l as any).readyAt ? fmtDur(now - (l as any).readyAt) : l.sentAt ? fmtDur(now - l.sentAt) : ''}
                  {l.startedAt ? ' → ПОДАТЬ ✓' : ' → В РАБОТУ'}
                </button>
              ) : l.sent ? (
                <span className="badge badge-sm badge-warning">
                  {l.startedAt ? 'ГОТОВИТСЯ' : 'В ОЧЕРЕДИ'} {l.sentAt ? fmtDur(now - l.sentAt) : ''}
                </span>
              ) : (
                <span className="badge badge-sm badge-ghost">ЧЕРНОВИК</span>
              )}
              <span className="font-semibold tabular-nums">{fmt(d.price * l.qty)}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
