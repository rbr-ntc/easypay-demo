import { useState } from 'react'
import { CATEGORIES, MENU, HALL_LABEL, dishMark, possibleAllergens } from '../data'
import { allergenGenitive } from '@easypay/domain/allergens'
import type { Dish } from '../data'
import { tableId } from '../api'
import { Avatar } from '../avatars'
import { useStore } from '../store'
import { fmt } from '../format'

/**
 * Фотография блюда. Настоящее фото лежит в public/dishes; у блюд без фото —
 * полосатая заглушка с названием. Это временное решение под реальные фото,
 * а не приём: заглушка честно выглядит заглушкой и не притворяется дизайном.
 */
function DishPhoto({ dish, className = '' }: { dish: Dish; className?: string }) {
  if (dish.photo) {
    return (
      <img
        src={`./dishes/${dish.id}.jpg`}
        alt={dish.name}
        loading="lazy"
        className={`absolute inset-0 size-full object-cover ${className}`}
      />
    )
  }
  return (
    <div
      className={`absolute inset-0 flex items-end p-4 ${className}`}
      style={{
        background:
          'repeating-linear-gradient(135deg, #0C2C21 0 14px, #10382A 14px 28px)'
      }}
    >
      <span className="font-mono text-xs tracking-widest uppercase" style={{ color: '#5E7A6C' }}>
        фото готовится
      </span>
    </div>
  )
}

export { DishPhoto }

/**
 * Ищем по названию, составу, тегам, РАЗДЕЛУ и аллергенам — гость помнит блюдо
 * по-разному. Без раздела запрос «вино» не находил ничего, хотя раздел «Вино и
 * бар» есть; без аллергенов «сельдерей» не находил стейк, в котором он указан.
 */
function matches(dish: Dish, q: string, category: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [dish.name, dish.desc, category, ...(dish.tags ?? []), ...possibleAllergens(dish)]
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}

/** Подсветка совпадения: гость должен видеть, за что зацепился поиск. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim()
  if (!needle) return <>{text}</>
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark style={{ background: '#D5F94E', color: '#062119' }}>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

export function Menu() {
  const { ui, patch, me, snap, totals } = useStore()
  const [query, setQuery] = useState('')

  // Категория из состояния может устареть после правки меню — падаем на первую
  const cat = MENU[ui.menuCat] ? ui.menuCat : CATEGORIES[0]
  const searching = query.trim().length > 0
  // При поиске категории не при чём: гость ищет по всему меню
  const items = searching
    ? CATEGORIES.flatMap(c => (MENU[c] ?? []).filter(d => matches(d, query, c)))
    : (MENU[cat] ?? [])

  const mine = me ? snap?.lines.filter(l => l.personaId === me.id || l.shared) ?? [] : []
  const draftCount = mine.filter(l => !l.sent).length
  const neighbours = (snap?.personas ?? []).filter(p => p.id !== me?.id)
  const myAllergies = me?.allergies ?? []

  /** Блюдо, которое лично этому гостю нельзя: не «возможно», а по его списку. */
  const forbidden = (dish: Dish) => possibleAllergens(dish).filter(a => myAllergies.includes(a))

  return (
    <div className="ep-screen">
      {/* Шапка на еловом: кто я, где я, с кем — и как позвать человека */}
      <div className="ep-forest shrink-0 rounded-b-[26px] px-5 pt-4 pb-4.5">
        <div className="flex items-center gap-3">
          {me ? (
            <div className="shrink-0 rounded-full" style={{ boxShadow: '0 0 0 2px #D5F94E' }}>
              <Avatar animal={me.animal} size={44} label={me.name} />
            </div>
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-extrabold text-primary-content">
              e
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] leading-tight font-extrabold tracking-tight">
              {me ? `${me.name} · стол ${tableId}` : `Стол ${tableId}`}
            </div>
            <div className="truncate text-[13px] font-semibold" style={{ color: '#8CA396' }}>
              {HALL_LABEL}
              {neighbours.length > 0 ? ` · с вами ${neighbours.map(p => p.name).join(' и ')}` : ''}
            </div>
          </div>
          <button
            aria-label="Позвать официанта"
            disabled={!me || !!snap?.call}
            onClick={() => patch({ sheet: 'call' })}
            className="h-11 shrink-0 rounded-full px-4 text-[13px] font-bold disabled:opacity-45"
            style={{ border: '1px solid rgba(213,249,78,.35)', background: 'rgba(213,249,78,.12)', color: '#D5F94E' }}
          >
            {snap?.call ? 'Идёт ✓' : 'Официант'}
          </button>
        </div>

        <label
          className="mt-3.5 flex h-12 items-center gap-2.5 rounded-field px-4"
          style={{ background: 'rgba(250,245,234,.1)', border: '1px solid rgba(250,245,234,.14)' }}
        >
          <span aria-hidden style={{ color: '#8CA396' }}>
            ⌕
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Найти блюдо или напиток"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-[#8CA396]"
          />
          {searching && (
            <button aria-label="Очистить поиск" onClick={() => setQuery('')} style={{ color: '#8CA396' }}>
              ✕
            </button>
          )}
        </label>

        {!searching && (
          <div className="mt-3.5 flex gap-2 overflow-x-auto pb-0.5">
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => patch({ menuCat: c })}
                className="h-11 shrink-0 rounded-full px-4.5 text-[15px] font-bold whitespace-nowrap"
                style={
                  c === cat
                    ? { background: '#D5F94E', color: '#062119', fontWeight: 800 }
                    : { border: '1px solid rgba(250,245,234,.2)', color: '#C6D5CC' }
                }
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ep-scroll px-5 pt-4 pb-5">
        {myAllergies.length > 0 && (
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            {myAllergies.map(a => (
              <span
                key={a}
                className="inline-flex h-7.5 items-center rounded-full px-3 text-[13px] font-bold"
                style={{ background: '#F2E6DE', color: '#9E4225' }}
              >
                без {allergenGenitive(a)}
              </span>
            ))}
            <span className="text-[13px] font-semibold text-muted">учитываем вашу аллергию</span>
          </div>
        )}

        <div className="ep-menu-grid">
          {items.length === 0 && (
            <div className="px-5 py-16 text-center">
              <div className="font-bold">
                {searching ? `По запросу «${query.trim()}» ничего нет` : 'В этой категории пока пусто'}
              </div>
              <div className="mt-1 text-sm text-muted">
                {searching ? 'Спросите официанта — он подскажет' : 'Загляните в другие разделы меню'}
              </div>
            </div>
          )}

          {items.map(it => {
            const bad = forbidden(it)

            // Стоп-блюдо не притворяется доступным: карточка-пунктир и прямая
            // подпись вместо кнопки, по которой всё равно ничего не выйдет
            if (it.stop) {
              return (
                <div
                  key={it.id}
                  className="flex items-center gap-3 rounded-box p-3"
                  style={{ border: '1px dashed #DFD6C3', background: 'transparent' }}
                >
                  <div className="relative size-18 shrink-0 overflow-hidden rounded-field grayscale">
                    <DishPhoto dish={it} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px] font-extrabold">{it.name}</div>
                    <div className="mt-0.5 text-[13px] font-semibold text-muted">Закончилась сегодня</div>
                  </div>
                  <span className="ep-sum text-[15px] font-bold text-muted-soft">{fmt(it.price)}</span>
                </div>
              )
            }

            return (
              <div
                key={it.id}
                className="relative h-70 overflow-hidden rounded-[24px]"
                style={{ boxShadow: '0 10px 26px -18px rgba(6,33,25,.7)' }}
              >
                <DishPhoto dish={it} />
                {/* Скрим лежит на фото и попадает под backdrop-filter стекла:
                    затемнять надо фотографию, а не саму карточку */}
                <div className="ep-scrim absolute inset-0" />

                {bad.length > 0 && (
                  <span
                    className="absolute top-3.5 left-3.5 inline-flex h-7.5 items-center rounded-full px-3 text-[12px] font-bold"
                    style={{ background: '#9E3517', color: '#FFF1EC' }}
                  >
                    вам нельзя: {bad.join(' · ')}
                  </span>
                )}

                <div className="ep-glass absolute right-3 bottom-3 left-3 flex items-center gap-3 rounded-[20px] py-3.5 pr-3.5 pl-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[19px] leading-tight font-extrabold tracking-tight text-white">
                      <Highlight text={it.name} q={query} />
                      {dishMark(it)}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug font-semibold" style={{ color: '#D3E0D8' }}>
                      {[it.serving, it.desc].filter(Boolean).join(' · ')}
                    </div>
                    <div className="ep-sum mt-2 text-[20px] font-extrabold text-white">{fmt(it.price)}</div>
                  </div>
                  <button
                    aria-label={bad.length > 0 ? `Состав ${it.name}` : `Добавить ${it.name}`}
                    onClick={() => patch({ sheet: 'dish', currentDishId: it.id })}
                    className="flex size-14 shrink-0 items-center justify-center rounded-full text-[26px] font-extrabold"
                    style={
                      bad.length > 0
                        ? { background: 'rgba(255,255,255,.16)', color: '#FFF1EC', fontSize: 13, fontWeight: 700 }
                        : { background: '#D5F94E', color: '#062119', boxShadow: '0 8px 18px -8px rgba(6,33,25,.8)' }
                    }
                  >
                    {bad.length > 0 ? 'Состав' : '+'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Футер — единая кнопка стола: сколько блюд, сколько ещё не ушло на кухню */}
      {me && mine.length > 0 && (
        <div className="shrink-0 px-5 pt-3 pb-[calc(1.375rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => patch({ screen: 'table' })}
            className="ep-forest flex h-15 w-full items-center gap-3 rounded-field px-3.5"
            style={{ boxShadow: '0 12px 26px -14px rgba(6,33,25,.9)' }}
          >
            <Avatar animal={me.animal} size={34} label={me.name} />
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[15px] font-extrabold">
                Ваш стол · {mine.length} {mine.length === 1 ? 'блюдо' : mine.length < 5 ? 'блюда' : 'блюд'}
              </div>
              {draftCount > 0 && (
                <div className="text-[13px] font-semibold" style={{ color: '#FFC9B6' }}>
                  {draftCount} ещё не отправлено
                </div>
              )}
            </div>
            <span
              className="ep-sum inline-flex h-9 items-center rounded-full px-3.5 text-[15px] font-extrabold"
              style={{ background: '#D5F94E', color: '#062119' }}
            >
              {fmt(totals.myTotal + totals.myDraft)}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
