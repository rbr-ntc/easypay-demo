import { useState } from 'react'
import { findDish } from '../data'
import { effectiveAllergies } from '@easypay/domain/allergens'
import { useStore } from '../store'

/**
 * Общее блюдо соседа ждёт решения аллергика: раньше оно молча висело в корзине,
 * а сам аллергик узнавал об этом только от соседа (смена №7, А1). Два выхода:
 * «я это не ем» — не делю и не плачу, или «буду есть, знаю» — осознанное согласие.
 */
export function SharedConsent() {
  const { snap, me, sharedChoice } = useStore()
  const [busy, setBusy] = useState<number | null>(null)
  if (!snap || !me) return null
  const waiting = snap.lines.filter(l => l.personaId !== me.id && l.awaitingConsent?.includes(me.id))
  // Отказался от общего блюда — можно передумать, пока оно не ушло на кухню
  const declined = snap.lines.filter(l => l.shared && !l.sent && !l.cancelled && (l.optedOut ?? []).includes(me.id))
  if (!waiting.length && !declined.length) return null

  const act = async (uid: number, choice: 'out' | 'consent' | 'back') => {
    setBusy(uid)
    await sharedChoice(uid, choice)
    setBusy(null)
  }

  return (
    <div className="px-4 pt-4">
      {waiting.map(l => {
        const dish = findDish(l.dishId)
        const mine = (l.allergens ?? []).filter(a => effectiveAllergies(me.allergies).includes(a))
        const who = snap.personas.find(p => p.id === l.personaId)?.name ?? 'сосед'
        return (
          <div key={l.uid} role="alert" className="mb-2.5 rounded-[20px] p-3.5" style={{ border: '1px solid rgba(232,120,100,.55)' }}>
            <div className="text-[15px] font-bold text-g-tan">
              {dish?.name ?? l.name} на всех — в нём {mine.join(', ')}
            </div>
            <div className="mt-1 text-[13px] text-g-mute">{who} положил(а) его на стол. Без вашего решения оно не уйдёт на кухню.</div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void act(l.uid, 'out')}
                disabled={busy === l.uid}
                className="h-12 flex-1 rounded-full bg-g-sand text-[15px] text-g-fg disabled:opacity-50"
              >
                Я это не ем
              </button>
              <button onClick={() => void act(l.uid, 'consent')} disabled={busy === l.uid} className="g-cta h-12 flex-1 rounded-full text-[15px] disabled:opacity-50">
                Буду есть, знаю
              </button>
            </div>
          </div>
        )
      })}
      {declined.map(l => (
        <div key={`out-${l.uid}`} className="mb-2.5 flex items-center gap-3 rounded-[20px] bg-g-s1 p-3.5 text-[14px]">
          <span className="flex-1">
            {findDish(l.dishId)?.name ?? l.name} на всех — вы не едите и не платите
          </span>
          <button onClick={() => void act(l.uid, 'back')} disabled={busy === l.uid} className="h-10 rounded-full bg-g-sand px-4 text-[14px] text-g-fg disabled:opacity-50">
            Всё-таки буду
          </button>
        </div>
      ))}
    </div>
  )
}
