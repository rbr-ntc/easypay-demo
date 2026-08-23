import { useRef, useState } from 'react'
import { newIdemKey } from '../keys'
import { findDish } from '../data'
import type { Animal } from '../data'
import { ANIMAL_LIST, Avatar } from '../avatars'
import { BottomSheet, PrimaryButton } from '../ui'
import { useStore } from '../store'
import { ALLERGENS } from '@easypay/domain/allergens'

export function NameSheet() {
  const { ui, patch, snap, join, addLine, toast } = useStore()
  const [name, setName] = useState('')
  const [animal, setAnimal] = useState<Animal>('fox')
  // Аллергии спрашиваем один раз при посадке: дальше система предупреждает сама
  const [allergies, setAllergies] = useState<string[]>([])
  const [showAllergies, setShowAllergies] = useState(false)
  const [busy, setBusy] = useState(false)
  // Повторное «Готово» после обрыва связи не создаёт вторую персону
  const joinKey = useRef(newIdemKey())
  // У закрытого стола список гостей уже неактуален — join откроет новую сессию
  const others = snap?.status === 'open' ? snap.personas : []
  // Не предлагаем зверя, которого уже выбрали за столом
  const taken = new Set(others.map(p => p.animal))
  const free = ANIMAL_LIST.filter(a => !taken.has(a))
  const effectiveAnimal = taken.has(animal) ? (free[0] ?? animal) : animal

  const close = () => patch({ sheet: null, currentDishId: null, pendingAdd: null })

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    const persona = await join(
      name.trim() || `Гость ${others.length + 1}`,
      effectiveAnimal,
      joinKey.current,
      allergies
    )
    if (!persona) {
      setBusy(false)
      return
    }
    // Блюдо, ради которого спросили имя, НЕ теряется — добавляем сразу.
    // Шторку закрываем ПОСЛЕ ответа сервера: иначе некуда вернуть гостя, если
    // заказ не прошёл, и тост «Капучино → Глеб» врал при пустом заказе — тот же
    // дефект, который правился в карточке блюда, только на самом частом пути:
    // первое блюдо новичка.
    const pending = ui.pendingAdd
    if (!pending) {
      patch({ sheet: null, currentDishId: null, pendingAdd: null })
      setBusy(false)
      return
    }

    const dish = findDish(pending.dishId)
    const res = await addLine(pending.dishId, pending.qty, pending.shared, pending.options)
    setBusy(false)

    if (res.allergens && res.allergens.length > 0) {
      // Предупреждение об аллергене показывает карточка блюда — вместе с
      // вариантами, которые аллерген снимают. Молча проглотить его нельзя.
      patch({
        sheet: 'dish',
        currentDishId: pending.dishId,
        pendingAdd: null,
        pendingAllergens: res.allergens
      })
      return
    }
    if (!res.ok) {
      // Сервер отказал: гость остаётся в карточке и видит тост с причиной
      patch({ sheet: 'dish', currentDishId: pending.dishId, pendingAdd: null })
      return
    }

    patch({ sheet: null, currentDishId: null, pendingAdd: null })
    if (dish) toast(pending.shared ? `${dish.name} → общее на стол` : `${dish.name} → ${persona.name}`)
  }

  return (
    <BottomSheet onClose={close}>
      <div className="px-5 pb-[calc(1.625rem+env(safe-area-inset-bottom))]">
        <div className="mb-1 text-2xl font-bold tracking-tight">За кем записать заказ?</div>
        <p className="mb-4 text-base-content/60">Выберите зверюшку и впишите имя — за ним закрепятся блюда</p>

        {/* Ряд шире экрана, и последний зверь раньше просто пропадал за краем.
            Затухание у правой границы показывает, что список листается. */}
        <div className="relative mb-3.5">
          <div className="flex snap-x gap-3 overflow-x-auto px-0.5 pt-1 pb-2.5">
            {ANIMAL_LIST.map(a => {
              const disabled = taken.has(a)
              return (
                <button
                  key={a}
                  type="button"
                  aria-label={`Зверюшка ${a}`}
                  aria-pressed={a === effectiveAnimal}
                  disabled={disabled}
                  onClick={() => setAnimal(a)}
                  className={`btn btn-circle size-16 shrink-0 snap-center p-0 ${
                    a === effectiveAnimal ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  <Avatar animal={a} size={60} label={name || 'А'} />
                </button>
              )
            })}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 bottom-2.5 w-7 bg-gradient-to-r from-transparent to-base-100"
          />
        </div>

        <label className="input input-lg mb-3.5 w-full">
          <input placeholder="Ваше имя" value={name} onChange={e => setName(e.target.value)} />
        </label>

        {/* Аллергии: система уже умеет считать их по модификаторам, но не знала,
            что человеку нельзя. Спрашиваем один раз — дальше предупреждаем сами. */}
        <button
          type="button"
          className={`btn btn-ghost btn-block justify-start ${allergies.length > 0 ? 'text-error' : ''}`}
          onClick={() => setShowAllergies(v => !v)}
        >
          {allergies.length > 0 ? `Аллергии: ${allergies.join(', ')}` : 'У меня аллергия…'}
        </button>

        {showAllergies && (
          <div className="mt-2 mb-3.5 flex flex-wrap gap-2">
            {ALLERGENS.map(a => {
              const on = allergies.includes(a)
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  // h-11 — это 44 px: чипсы аллергенов были 32-34 и мазали пальцем
                  className={`btn h-11 ${on ? 'btn-error' : ''}`}
                  onClick={() => setAllergies(list => (on ? list.filter(x => x !== a) : [...list, a]))}
                >
                  {a}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-2 mb-4 text-xs text-base-content/60">
          {others.length > 0 ? `За столом уже: ${others.map(p => p.name).join(' · ')}` : 'Вы первый за этим столом'}
        </div>

        <PrimaryButton onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Секунду…' : 'Готово'}
        </PrimaryButton>
      </div>
    </BottomSheet>
  )
}
