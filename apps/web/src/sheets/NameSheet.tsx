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
    // Блюдо, ради которого спросили имя, НЕ теряется — добавляем сразу
    const pending = ui.pendingAdd
    patch({ sheet: null, currentDishId: null, pendingAdd: null })
    if (pending) {
      const dish = findDish(pending.dishId)
      await addLine(pending.dishId, pending.qty, pending.shared, pending.options)
      if (dish) toast(pending.shared ? `${dish.name} → общее на стол` : `${dish.name} → ${persona.name}`)
    }
  }

  return (
    <BottomSheet onClose={close}>
      <div style={{ padding: '0 22px', paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontWeight: 680, fontSize: 22, letterSpacing: '-0.5px', marginBottom: 4 }}>За кем записать заказ?</div>
        <div style={{ fontSize: 14, color: 'var(--ep-muted)', marginBottom: 18 }}>
          Выберите зверюшку и впишите имя — за ним закрепятся блюда
        </div>

        <div style={{ display: 'flex', gap: 11, overflowX: 'auto', padding: '4px 2px 14px' }}>
          {ANIMAL_LIST.map(a => {
            const disabled = taken.has(a)
            return (
              <div
                key={a}
                onClick={() => !disabled && setAnimal(a)}
                style={{
                  borderRadius: '50%',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.35 : 1,
                  boxShadow: a === effectiveAnimal ? '0 0 0 2px #fff, 0 0 0 4px var(--ep-ink)' : 'none',
                  transition: 'box-shadow 120ms'
                }}
              >
                <Avatar animal={a} size={60} label={name || 'А'} />
              </div>
            )
          })}
        </div>

        <div style={{ background: 'var(--ep-bg)', border: '1px solid var(--ep-border)', borderRadius: 'var(--ep-r-sm)', padding: '14px 16px', marginBottom: 14 }}>
          <input
            placeholder="Ваше имя"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 17, fontWeight: 540, color: 'var(--ep-ink)' }}
          />
        </div>

        {/* Аллергии: система уже умеет считать их по модификаторам, но не знала,
            что человеку нельзя. Спрашиваем один раз — дальше предупреждаем сами. */}
        <button
          type="button"
          onClick={() => setShowAllergies(v => !v)}
          style={{
            width: '100%',
            textAlign: 'left',
            border: 'none',
            background: 'transparent',
            padding: '10px 0',
            fontSize: 14,
            color: allergies.length > 0 ? 'var(--ep-danger, #9B1C1C)' : 'var(--ep-muted)',
            cursor: 'pointer'
          }}
        >
          {allergies.length > 0 ? `Аллергии: ${allergies.join(', ')}` : 'У меня аллергия…'}
        </button>

        {showAllergies && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
            {ALLERGENS.map(a => {
              const on = allergies.includes(a)
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAllergies(list => (on ? list.filter(x => x !== a) : [...list, a]))}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 'var(--ep-r-pill)',
                    border: on ? '2px solid #9B1C1C' : '1px solid var(--ep-border)',
                    background: on ? '#FDECEC' : 'var(--ep-surface)',
                    color: on ? '#9B1C1C' : 'inherit',
                    fontSize: 13.5,
                    fontWeight: on ? 640 : 480,
                    cursor: 'pointer'
                  }}
                >
                  {a}
                </button>
              )
            })}
          </div>
        )}

        {others.length > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ep-muted)', marginBottom: 18 }}>
            За столом уже: {others.map(p => p.name).join(' · ')}
          </div>
        )}
        {others.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ep-muted)', marginBottom: 18 }}>Вы первый за этим столом</div>
        )}

        <PrimaryButton onClick={() => void confirm()} disabled={busy} style={{ minHeight: 54 }}>
          {busy ? 'Секунду…' : 'Готово'}
        </PrimaryButton>
      </div>
    </BottomSheet>
  )
}
