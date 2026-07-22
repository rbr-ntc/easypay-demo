import { CATEGORIES, MENU, NAVY, HALL_LABEL } from '../data'
import { tableId } from '../api'
import { Avatar } from '../avatars'
import { PrimaryButton } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

function DishPhoto({ id, name, hasPhoto, size, radius }: { id: string; name: string; hasPhoto?: boolean; size: number; radius: number }) {
  // Реальное фото из public/dishes; для блюд без фото — градиент-заглушка
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  if (hasPhoto) {
    return (
      <img
        src={`./dishes/${id}.jpg`}
        alt={name}
        loading="lazy"
        style={{ width: size, height: size, flexShrink: 0, borderRadius: radius, objectFit: 'cover', background: '#F2F2F4' }}
      />
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        background: `linear-gradient(135deg, hsl(${hash} 55% 86%), hsl(${(hash + 40) % 360} 60% 70%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38
      }}
    >
      🍋
    </div>
  )
}

export { DishPhoto }

export function Menu() {
  const { ui, patch, me, snap, totals } = useStore()
  const items = MENU[ui.menuCat] ?? []
  const hasCart = !!me && (snap?.lines ?? []).some(l => l.personaId === me.id)

  return (
    <div className="ep-screen">
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #ECECEF', padding: '12px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {me ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Avatar animal={me.animal} size={32} />
              <div>
                <div style={{ fontSize: 11, color: '#8A8A92' }}>Заказ · Стол №{tableId}</div>
                <div style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.1 }}>{me.name}</div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.3px' }}>Меню</div>
              <div style={{ fontSize: 12, color: '#8A8A92' }}>
                Стол №{tableId} · {HALL_LABEL}
              </div>
            </div>
          )}
          <button
            onClick={() => hasCart && patch({ screen: 'cart' })}
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
              onClick={() => patch({ menuCat: c })}
              style={{
                fontSize: 14,
                fontWeight: c === ui.menuCat ? 600 : 440,
                padding: '8px 15px',
                borderRadius: 50,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                border: 'none',
                background: c === ui.menuCat ? NAVY : '#F2F2F4',
                color: c === ui.menuCat ? '#fff' : '#5C5C66'
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
            <DishPhoto id={it.id} name={it.name} hasPhoto={it.photo} size={74} radius={14} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                  {it.name}
                  {it.tags?.includes('острое') ? ' 🌶' : ''}
                </span>
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
              <div style={{ fontSize: 12.5, color: '#7A7A84', lineHeight: 1.4, margin: '3px 0 4px' }}>{it.desc}</div>
              {(it.serving || it.kcal) && (
                <div style={{ fontSize: 11.5, color: '#A6A6AE', marginBottom: 8 }}>
                  {[it.serving, it.kcal ? `${it.kcal} ккал` : null].filter(Boolean).join(' · ')}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto' }}>
                <span style={{ fontWeight: 620, fontSize: 15 }}>{fmt(it.price)}</span>
                <button
                  onClick={() => !it.stop && patch({ sheet: 'dish', currentDishId: it.id })}
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
          <PrimaryButton onClick={() => patch({ screen: 'cart' })}>
            <span style={{ background: 'rgba(255,255,255,.2)', padding: '3px 10px', borderRadius: 50, fontSize: 14, marginRight: 10 }}>
              Корзина
            </span>
            {fmt(totals.myTotal)} →
          </PrimaryButton>
        </div>
      )}
    </div>
  )
}
