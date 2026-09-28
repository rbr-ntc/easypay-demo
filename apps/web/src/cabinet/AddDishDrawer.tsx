import { useMemo, useRef, useState } from 'react'
import type { Snapshot } from '../api'
import { CATEGORIES, defaultOptions, MENU, priceWithOptions, type Dish, type LineOptions } from '../data'
import { fmt } from '../format'
import { newIdemKey } from '../keys'
import { useStore } from '../store'
import { staffError, tableAction } from './staffApi'

/**
 * Официант добавляет блюдо на стол: гость попросил вслух, а не с телефона,
 * или телефона у гостей нет вовсе. Блюдо сразу уходит на кухню. Аллергии
 * проверяет сервер — так же, как у гостя, — и показывает, у кого.
 */
export function AddDishDrawer({ tableId, snap, onClose }: { tableId: string; snap: Snapshot; onClose: () => void }) {
  const { toast, menuRev } = useStore()
  // У закрытого стола в снимке — гости прошлой посадки; новая начинается с чистого листа
  const guests = snap.status === 'open' ? snap.personas : []
  const [q, setQ] = useState('')
  const [dish, setDish] = useState<Dish | null>(null)
  const [opts, setOpts] = useState<LineOptions>({})
  const [qty, setQty] = useState(1)
  // null — «на стол», общее блюдо на всех
  const [who, setWho] = useState<string | null>(snap.status === 'open' ? (snap.personas[0]?.id ?? null) : null)
  const [comment, setComment] = useState('')
  const [warning, setWarning] = useState<{ name: string; allergens: string[] }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const key = useRef(newIdemKey())

  const stop = new Set(snap.stop ?? [])
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return CATEGORIES.map(cat => ({ cat, dishes: MENU[cat].filter(d => !needle || d.name.toLowerCase().includes(needle)) })).filter(
      g => g.dishes.length > 0
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, menuRev])

  const pick = (d: Dish) => {
    setDish(d)
    setOpts(defaultOptions(d))
    setQty(1)
    setWarning(null)
    key.current = newIdemKey()
  }

  const add = async (confirmAllergen = false) => {
    if (!dish || busy) return
    setBusy(true)
    const r = await tableAction(tableId, 'addLine', {
      dishId: dish.id,
      qty,
      options: opts,
      personaId: who,
      comment: comment.trim() || undefined,
      confirmAllergen,
      idemKey: key.current,
      // Закрытый стол откроется заново — привязка к старой посадке не нужна
      sessionId: snap.status === 'open' ? (snap.sessionId ?? undefined) : undefined
    })
    setBusy(false)
    if (r.status === 409 && r.error === 'allergen warning') {
      setWarning((r.body.people as { name: string; allergens: string[] }[]) ?? [])
      return
    }
    if (!r.ok) return toast(staffError(r))
    toast(`${dish.name} — на кухню`)
    onClose()
  }

  const INPUT = 'h-10 w-full rounded-xl border border-c-line bg-c-bg px-3 text-[14px] outline-none focus:border-c-ink'

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30" style={{ background: 'rgba(27,26,23,.3)' }} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Добавить блюдо на стол ${tableId}`}
        className="c-fade fixed top-0 right-0 bottom-0 z-31 flex w-[min(460px,100vw)] flex-col bg-c-card"
        style={{ boxShadow: '-30px 0 60px -30px rgba(0,0,0,.35)' }}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-c-line2 px-5">
          {dish && (
            <button onClick={() => setDish(null)} aria-label="Назад к меню" className="size-9 rounded-lg text-[18px] hover:bg-c-chip">
              ←
            </button>
          )}
          <span className="flex-1 truncate text-[18px] font-bold">{dish ? dish.name : `Стол ${tableId}: добавить блюдо`}</span>
          <button onClick={onClose} aria-label="Закрыть" className="size-9 rounded-lg text-[18px] text-c-mute hover:bg-c-chip">
            ✕
          </button>
        </div>

        {!dish ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти блюдо" aria-label="Найти блюдо" className={INPUT} autoFocus />
            {found.map(g => (
              <div key={g.cat} className="mt-4">
                <div className="mb-1 text-[12px] font-bold text-c-mute">{g.cat}</div>
                {g.dishes.map(d => {
                  const off = stop.has(d.id)
                  return (
                    <button
                      key={d.id}
                      disabled={off}
                      onClick={() => pick(d)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-[14px] hover:bg-c-chip disabled:opacity-40"
                    >
                      <span className="flex-1">{d.name}</span>
                      <span className="c-num text-c-mute">{off ? 'закончилось' : fmt(d.price)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="text-[13px] font-bold">Кому</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {guests.map(p => (
                <button
                  key={p.id}
                  onClick={() => setWho(p.id)}
                  aria-pressed={who === p.id}
                  className={`h-9 rounded-full px-3.5 text-[13px] ${who === p.id ? 'bg-c-ink font-bold text-white' : 'border border-c-line'}`}
                >
                  {p.name}
                  {(p.allergies ?? []).length > 0 ? ' ⚠' : ''}
                </button>
              ))}
              <button
                onClick={() => setWho(null)}
                aria-pressed={who === null}
                className={`h-9 rounded-full px-3.5 text-[13px] ${who === null ? 'bg-c-ink font-bold text-white' : 'border border-c-line'}`}
              >
                {guests.length ? 'На стол — делим на всех' : 'Гостю без телефона'}
              </button>
            </div>

            {(dish.options ?? []).map(o => (
              <label key={o.id} className="mt-4 block">
                <span className="text-[13px] font-bold">{o.name}</span>
                <select value={opts[o.id]} onChange={e => setOpts({ ...opts, [o.id]: e.target.value })} className={`${INPUT} mt-1.5`}>
                  {o.choices.map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            ))}

            <div className="mt-4 flex items-center gap-3">
              <span className="flex-1 text-[13px] font-bold">Количество</span>
              <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Меньше" className="size-9 rounded-lg border border-c-line text-[18px]">
                −
              </button>
              <span className="c-num w-6 text-center text-[16px] font-bold">{qty}</span>
              <button onClick={() => setQty(Math.min(9, qty + 1))} aria-label="Больше" className="size-9 rounded-lg border border-c-line text-[18px]">
                +
              </button>
            </div>

            <label className="mt-4 block">
              <span className="text-[13px] font-bold">Пожелание кухне</span>
              <input value={comment} onChange={e => setComment(e.target.value)} maxLength={200} placeholder="без лука · соус отдельно" className={`${INPUT} mt-1.5`} />
            </label>

            {warning && (
              <div role="alert" className="mt-4 rounded-xl border border-c-bad-line bg-c-bad-bg p-3.5 text-[14px] text-c-bad-ink">
                {warning.map(w => (
                  <div key={w.name} className="font-bold">
                    У {w.name} аллергия: {w.allergens.join(', ')}
                  </div>
                ))}
                <div className="mt-1 text-[13px]">Уточните у гостя. Если он согласен — добавьте, кухня увидит аллергию на тикете.</div>
                <button onClick={() => void add(true)} disabled={busy} className="mt-2.5 h-9 rounded-lg bg-c-bad px-3 text-[13px] font-bold text-white disabled:opacity-50">
                  Гость согласен — добавить
                </button>
              </div>
            )}
          </div>
        )}

        {dish && (
          <div className="flex shrink-0 items-center gap-2 border-t border-c-line2 p-4">
            <span className="c-num flex-1 text-[16px] font-bold">{fmt(priceWithOptions(dish, opts) * qty)}</span>
            <button onClick={() => void add()} disabled={busy} className="h-11 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold text-white disabled:opacity-50">
              {busy ? 'Секунду…' : 'На кухню'}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
