import { useState } from 'react'
import { findDish } from '../data'
import type { Animal } from '../data'
import { ANIMAL_LIST, Avatar } from '../avatars'
import { BottomSheet, PrimaryButton } from '../ui'
import { useStore } from '../store'

export function NameSheet() {
  const { ui, patch, snap, join, addLine, toast } = useStore()
  const [name, setName] = useState('')
  const [animal, setAnimal] = useState<Animal>('fox')
  const [busy, setBusy] = useState(false)
  const others = snap?.personas ?? []
  // Не предлагаем зверя, которого уже выбрали за столом
  const taken = new Set(others.map(p => p.animal))
  const free = ANIMAL_LIST.filter(a => !taken.has(a))
  const effectiveAnimal = taken.has(animal) ? (free[0] ?? animal) : animal

  const close = () => patch({ sheet: null, currentDishId: null, pendingAdd: null })

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    const persona = await join(name.trim() || `Гость ${others.length + 1}`, effectiveAnimal)
    if (!persona) {
      setBusy(false)
      return
    }
    // Блюдо, ради которого спросили имя, НЕ теряется — добавляем сразу
    const pending = ui.pendingAdd
    patch({ sheet: null, currentDishId: null, pendingAdd: null })
    if (pending) {
      const dish = findDish(pending.dishId)
      await addLine(pending.dishId, pending.qty, pending.shared, persona.id)
      if (dish) toast(pending.shared ? `${dish.name} → общее на стол` : `${dish.name} → ${persona.name}`)
    }
  }

  return (
    <BottomSheet onClose={close}>
      <div style={{ padding: '0 22px', paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontWeight: 680, fontSize: 22, letterSpacing: '-0.5px', marginBottom: 4 }}>За кем записать заказ?</div>
        <div style={{ fontSize: 14, color: '#7A7A84', marginBottom: 18 }}>
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
                  boxShadow: a === effectiveAnimal ? '0 0 0 2px #fff, 0 0 0 4px #1F1D3D' : 'none',
                  transition: 'box-shadow 120ms'
                }}
              >
                <Avatar animal={a} size={60} />
              </div>
            )
          })}
        </div>

        <div style={{ background: '#F7F7F9', border: '1px solid #ECECEF', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
          <input
            placeholder="Ваше имя"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 17, fontWeight: 540, color: '#1F1D3D' }}
          />
        </div>

        {others.length > 0 && (
          <div style={{ fontSize: 12.5, color: '#9A9AA4', marginBottom: 18 }}>
            За столом уже: {others.map(p => p.name).join(' · ')}
          </div>
        )}
        {others.length === 0 && (
          <div style={{ fontSize: 12.5, color: '#9A9AA4', marginBottom: 18 }}>Вы первый за этим столом</div>
        )}

        <PrimaryButton onClick={() => void confirm()} disabled={busy} style={{ minHeight: 54 }}>
          {busy ? 'Секунду…' : 'Готово'}
        </PrimaryButton>
      </div>
    </BottomSheet>
  )
}
