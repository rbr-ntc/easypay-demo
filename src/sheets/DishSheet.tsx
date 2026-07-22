import { useState } from 'react'
import { findDish, NAVY } from '../data'
import { BottomSheet, PrimaryButton } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

export function DishSheet() {
  const { state, dispatch, toast } = useStore()
  const [qty, setQty] = useState(1)
  const [target, setTarget] = useState<'me' | 'table'>('me')
  const dish = state.currentDishId ? findDish(state.currentDishId) : undefined
  if (!dish) return null

  const close = () => dispatch({ type: 'patch', patch: { sheet: null, currentDishId: null } })

  const add = () => {
    if (!state.me) {
      // Имя спрашиваем ровно в момент первой надобности; блюдо НЕ теряется
      dispatch({ type: 'patch', patch: { sheet: 'name' } })
      return
    }
    dispatch({ type: 'addLine', dishId: dish.id, qty, shared: target === 'table' })
    dispatch({ type: 'patch', patch: { sheet: null, currentDishId: null } })
    toast(target === 'table' ? `${dish.name} — добавлено на весь стол` : `${dish.name} — добавлено за ${state.me.name}`)
  }

  const segStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    textAlign: 'center',
    padding: '10px 6px',
    borderRadius: 50,
    cursor: 'pointer',
    fontSize: 13.5,
    fontWeight: active ? 600 : 440,
    background: active ? NAVY : 'transparent',
    color: active ? '#fff' : '#5C5C66',
    border: 'none'
  })

  return (
    <BottomSheet onClose={close}>
      <div className="ep-scroll" style={{ padding: '4px 22px 16px' }}>
        <div
          style={{
            width: '100%',
            height: 150,
            borderRadius: 18,
            marginBottom: 16,
            background: 'linear-gradient(135deg, #FBEFE4, #EAD9C4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 44
          }}
        >
          🍽
        </div>
        <div style={{ fontWeight: 680, fontSize: 22, letterSpacing: '-0.5px' }}>{dish.name}</div>
        <div style={{ fontSize: 14, color: '#7A7A84', lineHeight: 1.5, margin: '6px 0 16px' }}>{dish.desc}</div>

        {/* Кому блюдо — витрина УТП: привязка к персоне в момент заказа */}
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Кому</div>
        <div style={{ display: 'flex', gap: 4, background: '#F2F2F4', borderRadius: 50, padding: 4, marginBottom: 18 }}>
          <button style={segStyle(target === 'me')} onClick={() => setTarget('me')}>
            {state.me ? `За ${state.me.name === 'Аня' ? 'Аню' : state.me.name}` : 'Себе'}
          </button>
          <button style={segStyle(target === 'table')} onClick={() => setTarget('table')}>
            Общее на стол ÷3
          </button>
        </div>

        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>Острота</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <span style={{ flex: 1, textAlign: 'center', padding: 10, borderRadius: 12, border: '1px solid #ECECEF', fontSize: 14 }}>Слабо</span>
          <span style={{ flex: 1, textAlign: 'center', padding: 10, borderRadius: 12, border: `2px solid ${NAVY}`, fontWeight: 600, fontSize: 14 }}>Средне</span>
          <span style={{ flex: 1, textAlign: 'center', padding: 10, borderRadius: 12, border: '1px solid #ECECEF', fontSize: 14 }}>Остро</span>
        </div>
      </div>

      <div style={{ padding: '12px 22px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', borderTop: '1px solid #ECECEF', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '1px solid #ECECEF', borderRadius: 50, padding: '7px 12px' }}>
          <span style={{ fontSize: 20, color: '#9A9AA4', cursor: 'pointer' }} onClick={() => setQty(Math.max(1, qty - 1))}>
            −
          </span>
          <span style={{ fontWeight: 600, fontSize: 16, minWidth: 14, textAlign: 'center' }}>{qty}</span>
          <span style={{ fontSize: 20, cursor: 'pointer' }} onClick={() => setQty(qty + 1)}>
            +
          </span>
        </div>
        <PrimaryButton onClick={add} style={{ flex: 1, minHeight: 52, fontSize: 14.5 }}>
          Добавить · {fmt(dish.price * qty)}
        </PrimaryButton>
      </div>
    </BottomSheet>
  )
}
