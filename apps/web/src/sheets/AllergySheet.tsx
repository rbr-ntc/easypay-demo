import { useState } from 'react'
import { ALLERGENS } from '@easypay/domain/allergens'
import { useStore } from '../store'

/**
 * Мои аллергии — после посадки. Кто забыл отметить орехи при входе, раньше
 * оставался без защиты до конца ужина: сервер знал аллергии только из join.
 * Изменение сразу доезжает до кухни — в тикетах уже отправленных блюд тоже.
 */
export function AllergySheet() {
  const { patch, me, setAllergies } = useStore()
  const [picked, setPicked] = useState<string[]>(me?.allergies ?? [])
  const [busy, setBusy] = useState(false)

  const close = () => patch({ sheet: null })
  const save = async () => {
    if (busy) return
    setBusy(true)
    const ok = await setAllergies(picked)
    setBusy(false)
    if (ok) close()
  }

  return (
    <>
      <div onClick={close} className="g-anim-fade absolute inset-0 z-20" style={{ background: 'rgba(20,14,8,.5)' }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Мои аллергии"
        className="g-anim-up absolute right-0 bottom-0 left-0 z-[21] max-h-[92%] overflow-y-auto rounded-t-[28px] bg-g-paper px-5 pt-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <h2 className="g-serif text-[34px] text-g-fg">мои аллергии</h2>
        <p className="mt-2 text-[15px] text-g-mute">Предупредим при заказе, кухня увидит их на каждом вашем блюде.</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {ALLERGENS.map(a => {
            const on = picked.includes(a)
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(list => (on ? list.filter(x => x !== a) : [...list, a]))}
                className="h-10 rounded-full px-3.5 text-[15px]"
                style={
                  on
                    ? { background: '#F3F0EA', color: '#1A1612', border: '1px solid #F3F0EA' }
                    : { background: 'var(--g-s1)', color: '#F3F0EA', border: '1px solid rgba(255,255,255,.1)' }
                }
              >
                {a}
              </button>
            )
          })}
        </div>
        <button onClick={() => void save()} disabled={busy} className="g-cta mt-6 h-14 w-full rounded-full text-[17px] disabled:opacity-40">
          {busy ? 'Секунду…' : picked.length ? 'Сохранить' : 'Аллергий нет'}
        </button>
      </div>
    </>
  )
}
