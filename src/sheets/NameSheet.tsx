import { useState } from 'react'
import { BOTS, findDish } from '../data'
import type { Animal } from '../data'
import { ANIMAL_LIST, Avatar } from '../avatars'
import { BottomSheet, PrimaryButton } from '../ui'
import { useStore } from '../store'

export function NameSheet() {
  const { state, dispatch, toast } = useStore()
  const [name, setName] = useState('Аня')
  const [animal, setAnimal] = useState<Animal>('fox')

  const close = () => dispatch({ type: 'patch', patch: { sheet: null, currentDishId: null } })

  const confirm = () => {
    const finalName = name.trim() || 'Гость'
    dispatch({ type: 'patch', patch: { me: { name: finalName, animal } } })
    // Блюдо, ради которого спросили имя, НЕ теряется — добавляем сразу
    const dish = state.currentDishId ? findDish(state.currentDishId) : undefined
    if (dish) {
      dispatch({ type: 'addLine', dishId: dish.id, qty: 1, shared: false })
      toast(`${dish.name} — добавлено за ${finalName}`)
    }
    dispatch({ type: 'patch', patch: { sheet: null, currentDishId: null } })
  }

  return (
    <BottomSheet onClose={close}>
      <div style={{ padding: '0 22px', paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontWeight: 680, fontSize: 22, letterSpacing: '-0.5px', marginBottom: 4 }}>За кем записать заказ?</div>
        <div style={{ fontSize: 14, color: '#7A7A84', marginBottom: 18 }}>
          Выберите зверюшку и впишите имя — за ним закрепятся блюда
        </div>

        <div style={{ display: 'flex', gap: 11, overflowX: 'auto', padding: '4px 2px 14px' }}>
          {ANIMAL_LIST.map(a => (
            <div
              key={a}
              onClick={() => setAnimal(a)}
              style={{
                borderRadius: '50%',
                cursor: 'pointer',
                boxShadow: a === animal ? '0 0 0 2px #fff, 0 0 0 4px #1F1D3D' : 'none',
                transition: 'box-shadow 120ms'
              }}
            >
              <Avatar animal={a} size={60} />
            </div>
          ))}
        </div>

        <div style={{ background: '#F7F7F9', border: '1px solid #ECECEF', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
          <input
            placeholder="Ваше имя"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 17, fontWeight: 540, color: '#1F1D3D' }}
          />
        </div>

        <div style={{ fontSize: 12.5, color: '#9A9AA4', marginBottom: 18 }}>
          За столом уже: {BOTS.map(b => b.name).join(' · ')}
        </div>

        <PrimaryButton onClick={confirm} style={{ minHeight: 54 }}>
          Готово
        </PrimaryButton>
      </div>
    </BottomSheet>
  )
}
