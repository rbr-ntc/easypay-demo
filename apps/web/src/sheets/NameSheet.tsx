import { useRef, useState } from 'react'
import { newIdemKey } from '../keys'
import { findDish } from '../data'
import type { Animal } from '../data'
import { ANIMAL_LIST, Avatar } from '../avatars'
import { useStore } from '../store'
import { ALLERGENS } from '@easypay/domain/allergens'

const ANIMAL_RU: Record<Animal, string> = {
  fox: 'лиса',
  bear: 'медведь',
  panda: 'панда',
  raccoon: 'енот',
  owl: 'сова',
  cat: 'кот'
}

/**
 * «Как вас зовут?» — имя и зверь, чтобы за столом было видно, кто что
 * заказал. Спрашиваем ровно в момент первой надобности: при первом блюде
 * или при вызове официанта. Регистрации нет.
 */
export function NameSheet() {
  const { ui, patch, snap, join, addLine, toast } = useStore()
  const [name, setName] = useState('')
  const [animal, setAnimal] = useState<Animal>('fox')
  // Аллергии спрашиваем один раз при посадке: дальше система предупреждает сама
  const [allergies, setAllergies] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // Повторное «Готово» после обрыва связи не создаёт вторую персону
  const joinKey = useRef(newIdemKey())
  // У закрытого стола список гостей уже неактуален — join откроет новую сессию
  const others = snap?.status === 'open' ? snap.personas : []
  // Не предлагаем зверя, которого уже выбрали за столом
  const taken = new Set(others.map(p => p.animal))
  const free = ANIMAL_LIST.filter(a => !taken.has(a))
  const effectiveAnimal = taken.has(animal) ? (free[0] ?? animal) : animal

  const pendingDish = ui.pendingAdd ? findDish(ui.pendingAdd.dishId) : undefined
  const ready = name.trim().length > 0

  const close = () => patch({ sheet: null, currentDishId: null, pendingAdd: null, afterJoin: null })

  const confirm = async () => {
    if (busy || !ready) return
    setBusy(true)
    const persona = await join(name.trim(), effectiveAnimal, joinKey.current, allergies)
    if (!persona) {
      setBusy(false)
      return
    }
    // Блюдо, ради которого спросили имя, НЕ теряется — добавляем сразу.
    // Шторку закрываем ПОСЛЕ ответа сервера: иначе некуда вернуть гостя, если
    // заказ не прошёл, и тост врал бы при пустом заказе.
    const pending = ui.pendingAdd
    if (!pending) {
      // Имя спрашивали ради вызова официанта — зовём сразу, а не обещаем впустую
      patch({ sheet: ui.afterJoin === 'call' ? 'call' : null, currentDishId: null, pendingAdd: null, afterJoin: null })
      setBusy(false)
      return
    }

    const res = await addLine(pending.dishId, pending.qty, pending.shared, pending.options, undefined, false, pending.idemKey)
    setBusy(false)

    if (res.allergens && res.allergens.length > 0) {
      // Предупреждение показывает карточка блюда — вместе с вариантами,
      // которые аллерген снимают. Молча проглотить его нельзя.
      patch({ sheet: 'dish', currentDishId: pending.dishId, pendingAdd: null, pendingAllergens: res.allergens })
      return
    }
    if (!res.ok) {
      // С тем же ключом: если сервер успел добавить блюдо, повтор его не задвоит
      patch({ sheet: 'dish', currentDishId: pending.dishId, pendingAdd: null, resumeKey: pending.idemKey ?? null })
      return
    }
    patch({ sheet: null, currentDishId: null, pendingAdd: null })
    if (pendingDish) toast(pending.shared ? `${pendingDish.name} — на всех` : `${pendingDish.name} — добавлено`)
  }

  return (
    <>
      <div onClick={close} className="g-anim-fade absolute inset-0 z-20" style={{ background: 'rgba(20,14,8,.5)' }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Как вас зовут?"
        className="g-anim-up absolute right-0 bottom-0 left-0 z-[21] max-h-[92%] overflow-y-auto rounded-t-[28px] bg-g-paper px-5 pt-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <h2 className="g-serif text-[34px] text-g-fg">Как вас зовут?</h2>
        <p className="mt-2 text-[15px] leading-normal text-g-mute">
          Имя и зверь — чтобы за столом было видно, кто что заказал. Без регистрации.
        </p>

        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Имя"
          aria-label="Ваше имя"
          autoComplete="given-name"
          maxLength={24}
          className="mt-4 h-13 w-full rounded-full bg-g-s1 px-4 text-[17px] text-g-fg outline-none placeholder:text-g-mute focus:ring-2 focus:ring-g-acc"
          style={{ border: '1px solid rgba(255,255,255,.1)' }}
        />

        <div className="mt-4 grid grid-cols-6 gap-2">
          {ANIMAL_LIST.map(a => {
            const disabled = taken.has(a)
            const on = a === effectiveAnimal
            return (
              <button
                key={a}
                type="button"
                aria-label={`Зверь: ${ANIMAL_RU[a]}`}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => setAnimal(a)}
                className="flex aspect-square items-center justify-center rounded-full disabled:opacity-30"
                style={{ boxShadow: on ? '0 0 0 3px var(--g-acc)' : 'none' }}
              >
                <Avatar animal={a} size={52} label={name || 'Гость'} />
              </button>
            )
          })}
        </div>

        <div className="mt-4.5 text-[13px] font-bold text-g-mute">Аллергия — предупредим и скажем кухне</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ALLERGENS.map(a => {
            const on = allergies.includes(a)
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => setAllergies(list => (on ? list.filter(x => x !== a) : [...list, a]))}
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

        {others.length > 0 && (
          <div className="mt-4 text-[13px] text-g-mute">За столом уже: {others.map(p => p.name).join(' · ')}</div>
        )}

        <button
          onClick={() => void confirm()}
          disabled={busy || !ready}
          className="g-cta mt-5 h-14 w-full rounded-full text-[17px] disabled:opacity-40"
        >
          {/* «добавить Уха» — название в именительном после глагола; через точку склонять не нужно */}
          {busy ? 'Секунду…' : pendingDish ? `Готово · ${pendingDish.name}` : 'Готово'}
        </button>
      </div>
    </>
  )
}
