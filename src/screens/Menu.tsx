import { CATEGORIES, MENU, NAVY, TABLE_LABEL, HALL_LABEL } from '../data'
import { Avatar } from '../avatars'
import { PrimaryButton } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

function DishPhoto({ name, size, radius }: { name: string; size: number; radius: number }) {
  // Детерминированный градиент-заглушка вместо фото
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        background: `linear-gradient(135deg, hsl(${hash} 45% 88%), hsl(${(hash + 40) % 360} 50% 74%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38
      }}
    >
      🍽
    </div>
  )
}

export { DishPhoto }

export function Menu() {
  const { state, dispatch, totals } = useStore()
  const items = MENU[state.menuCat] ?? []
  const hasCart = state.lines.length > 0

  return (
    <div className="ep-screen">
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #ECECEF', padding: '12px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {state.me ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Avatar animal={state.me.animal} size={32} />
              <div>
                <div style={{ fontSize: 11, color: '#8A8A92' }}>Заказ · {TABLE_LABEL}</div>
                <div style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.1 }}>{state.me.name}</div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.3px' }}>Меню</div>
              <div style={{ fontSize: 12, color: '#8A8A92' }}>
                {TABLE_LABEL} · {HALL_LABEL}
              </div>
            </div>
          )}
          <button
            onClick={() => hasCart && dispatch({ type: 'patch', patch: { screen: 'cart' } })}
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              border: 'none',
              background: '#F2F2F4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: hasCart ? 'pointer' : 'default',
              fontSize: 18
            }}
          >
            🛒
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => dispatch({ type: 'patch', patch: { menuCat: c } })}
              style={{
                fontSize: 14,
                fontWeight: c === state.menuCat ? 600 : 440,
                padding: '8px 15px',
                borderRadius: 50,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                border: 'none',
                background: c === state.menuCat ? NAVY : '#F2F2F4',
                color: c === state.menuCat ? '#fff' : '#5C5C66'
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="ep-scroll" style={{ padding: '14px 20px 22px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: '#9A9AA4' }}>
            <div style={{ fontWeight: 540, fontSize: 15, color: '#5C5C66' }}>В этой категории пока пусто</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Загляните в другие разделы меню</div>
          </div>
        )}
        {items.map(it => (
          <div
            key={it.id}
            style={{
              display: 'flex',
              gap: 13,
              padding: 12,
              borderRadius: 18,
              background: '#fff',
              border: '1px solid #ECECEF',
              opacity: it.stop ? 0.55 : 1
            }}
          >
            <DishPhoto name={it.name} size={74} radius={14} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{it.name}</span>
                {it.stop && (
                  <span
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 9.5,
                      letterSpacing: '0.4px',
                      textTransform: 'uppercase',
                      background: '#F2F2F4',
                      color: '#8A8A92',
                      padding: '3px 7px',
                      borderRadius: 50
                    }}
                  >
                    Нет в наличии
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: '#7A7A84', lineHeight: 1.4, margin: '3px 0 8px' }}>{it.desc}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto' }}>
                <span style={{ fontWeight: 620, fontSize: 15 }}>{fmt(it.price)}</span>
                <button
                  onClick={() => !it.stop && dispatch({ type: 'patch', patch: { sheet: 'dish', currentDishId: it.id } })}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    border: 'none',
                    cursor: it.stop ? 'not-allowed' : 'pointer',
                    background: it.stop ? '#EDEDEF' : NAVY,
                    color: it.stop ? '#B6B6BE' : '#fff',
                    fontSize: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1
                  }}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasCart && (
        <div style={{ padding: '12px 20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
          <PrimaryButton onClick={() => dispatch({ type: 'patch', patch: { screen: 'cart' } })}>
            <span style={{ background: 'rgba(255,255,255,.2)', padding: '3px 10px', borderRadius: 50, fontSize: 14, marginRight: 10 }}>
              Корзина
            </span>
            {fmt(totals.myOwn + totals.myShare)} →
          </PrimaryButton>
        </div>
      )}
    </div>
  )
}
