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
        style={{ width: size, height: size, flexShrink: 0, borderRadius: radius, objectFit: 'cover', background: 'var(--ep-soft)' }}
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
      <div style={{ flexShrink: 0, background: 'var(--ep-opaque)', borderBottom: '1px solid var(--ep-border)', padding: '12px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {me ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Avatar animal={me.animal} size={32} label={me.name} />
              <div>
                <div style={{ fontSize: 11, color: 'var(--ep-muted)' }}>Заказ · Стол №{tableId}</div>
                <div style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.1 }}>{me.name}</div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.3px' }}>Меню</div>
              <div style={{ fontSize: 12, color: 'var(--ep-muted)' }}>
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
              background: 'var(--ep-soft)',
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
                borderRadius: 'var(--ep-r-pill)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                border: 'none',
                background: c === ui.menuCat ? NAVY : 'var(--ep-soft)',
                color: c === ui.menuCat ? 'var(--ep-on-ink)' : 'var(--ep-text-2)'
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="ep-scroll" style={{ padding: '14px 20px 22px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--ep-muted)' }}>
            <div style={{ fontWeight: 540, fontSize: 15, color: 'var(--ep-text-2)' }}>В этой категории пока пусто</div>
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
              borderRadius: 'var(--ep-r-card)',
              background: 'var(--ep-surface)',
              border: '1px solid var(--ep-border)',
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
                      background: 'var(--ep-soft)',
                      color: 'var(--ep-muted)',
                      padding: '3px 7px',
                      borderRadius: 'var(--ep-r-pill)'
                    }}
                  >
                    Нет в наличии
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ep-muted)', lineHeight: 1.4, margin: '3px 0 4px' }}>{it.desc}</div>
              {(it.serving || it.kcal) && (
                <div style={{ fontSize: 11.5, color: 'var(--ep-muted)', marginBottom: 8 }}>
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
                    background: it.stop ? 'var(--ep-soft)' : NAVY,
                    color: it.stop ? 'var(--ep-muted)' : 'var(--ep-surface)',
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
            <span style={{ background: 'rgba(255,255,255,.2)', padding: '3px 10px', borderRadius: 'var(--ep-r-pill)', fontSize: 14, marginRight: 10 }}>
              Корзина
            </span>
            {fmt(totals.myTotal)} →
          </PrimaryButton>
        </div>
      )}
    </div>
  )
}
