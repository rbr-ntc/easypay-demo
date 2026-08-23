import { CATEGORIES, MENU, HALL_LABEL, dishEmoji, dishMark, possibleAllergens } from '../data'
import { tableId } from '../api'
import { Avatar } from '../avatars'
import { PrimaryButton } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

function DishPhoto({
  id,
  name,
  hasPhoto,
  size,
  emoji = '🍽'
}: {
  id: string
  name: string
  hasPhoto?: boolean
  size: number
  radius?: number
  emoji?: string
}) {
  // Реальное фото из public/dishes; для блюд без фото — градиент-заглушка
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  if (hasPhoto) {
    return (
      <img
        src={`./dishes/${id}.jpg`}
        alt={name}
        loading="lazy"
        className="shrink-0 rounded-box bg-base-200 object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-box"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hash} 55% 86%), hsl(${(hash + 40) % 360} 60% 70%))`,
        fontSize: size * 0.38
      }}
    >
      {emoji}
    </div>
  )
}

export { DishPhoto }

export function Menu() {
  const { ui, patch, me, snap, totals } = useStore()
  // Категория из состояния может устареть после правки меню — падаем на первую
  const cat = MENU[ui.menuCat] ? ui.menuCat : CATEGORIES[0]
  const items = MENU[cat] ?? []
  // Считаем и свои позиции, и общие блюда стола: и то, и другое лежит «в заказе»
  const cartCount = me
    ? (snap?.lines ?? []).filter(l => l.personaId === me.id || l.shared).length
    : 0
  const hasCart = cartCount > 0

  return (
    <div className="ep-screen">
      <div className="shrink-0 border-b border-base-300 bg-base-100 px-5 py-3">
        <div className="mb-3 flex items-center justify-between">
          {me ? (
            <div className="flex items-center gap-2.5">
              <Avatar animal={me.animal} size={32} label={me.name} />
              <div>
                <div className="text-xs text-base-content/60">
                  Стол №{tableId} · {HALL_LABEL}
                </div>
                <div className="text-sm leading-tight font-semibold">{me.name}</div>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-lg font-bold tracking-tight">Меню</div>
              <div className="text-xs text-base-content/60">
                Стол №{tableId} · {HALL_LABEL}
              </div>
            </div>
          )}
          {/* Счётчик — indicator: без него полная корзина выглядела как пустая */}
          <div className="indicator">
            {cartCount > 0 && <span className="indicator-item badge badge-sm badge-primary">{cartCount}</span>}
            <button
              aria-label={cartCount > 0 ? `Заказ, позиций: ${cartCount}` : 'Заказ пуст'}
              className="btn btn-circle size-11"
              disabled={!hasCart}
              onClick={() => patch({ screen: 'cart' })}
            >
              🛒
            </button>
          </div>
        </div>
        {/* h-11 на вкладке — это 44 px: у tabs-sm высота 32, а по категориям
            гость на телефоне мажет пальцем чаще всего после «+» */}
        <div role="tablist" className="tabs tabs-box w-full min-w-0 flex-nowrap overflow-x-auto">
          {CATEGORIES.map(c => (
            <button
              key={c}
              role="tab"
              className={c === cat ? 'tab tab-active h-11 whitespace-nowrap' : 'tab h-11 whitespace-nowrap'}
              onClick={() => patch({ menuCat: c })}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="ep-scroll px-5 pt-3.5 pb-5">
        <div className="ep-menu-grid">
          {items.length === 0 && (
            <div className="px-5 py-16 text-center">
              <div className="font-medium">В этой категории пока пусто</div>
              <div className="mt-1 text-sm text-base-content/60">Загляните в другие разделы меню</div>
            </div>
          )}
          {items.map(it => (
            <div key={it.id} className={`card card-border min-w-0 bg-base-100 ${it.stop ? 'opacity-55' : ''}`}>
              <div className="card-body min-w-0 flex-row gap-3 p-3">
                <DishPhoto id={it.id} name={it.name} hasPhoto={it.photo} size={74} emoji={dishEmoji(it)} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {it.name}
                      {dishMark(it)}
                    </span>
                    {it.stop && <span className="badge badge-sm">Нет в наличии</span>}
                  </div>
                  <div className="mt-1 text-xs leading-snug text-base-content/60">{it.desc}</div>
                  {(it.serving || it.kcal) && (
                    <div className="mt-1 text-xs text-base-content/60">
                      {[it.serving, it.kcal ? `${it.kcal} ккал` : null].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {/* Строка аллергенов — не мелкий шрифт: это здоровье гостя */}
                  {possibleAllergens(it).length > 0 && (
                    <div className="mt-1 text-sm font-medium text-warning">
                      аллергены: {possibleAllergens(it).join(' · ')}
                    </div>
                  )}
                  <div className="mt-auto flex items-end justify-between pt-2">
                    <span className="font-semibold">{fmt(it.price)}</span>
                    {/* size-11 — это 44 px: у daisyUI кнопка по умолчанию 40,
                        а по этой кнопке гость промахивается чаще всего */}
                    <button
                      className="btn btn-circle btn-primary size-11 text-xl"
                      disabled={it.stop}
                      aria-label={`Добавить ${it.name}`}
                      onClick={() => patch({ sheet: 'dish', currentDishId: it.id })}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {hasCart && (
        <div className="px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <PrimaryButton onClick={() => patch({ screen: 'cart' })}>
            <span className="badge badge-sm">Корзина</span>
            {fmt(totals.myTotal + totals.myDraft)} →
          </PrimaryButton>
        </div>
      )}
    </div>
  )
}
