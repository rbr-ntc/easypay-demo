import menuJson from '@easypay/config/menu.json'
import { allergensFor, dietTagsOf, possibleAllergensFor } from '@easypay/domain/allergens'
import { tableId } from './api'
import { HALL as HALL_CONFIG, seatsOfTable, zoneOfTable } from './hallConfig'

export const NAVY = 'var(--ep-ink)'
export const SBP_GRADIENT = 'linear-gradient(118deg,#5A1E9B 0%,#8E2A8C 46%,#E5097F 100%)'

export type Animal = 'fox' | 'bear' | 'panda' | 'raccoon' | 'owl' | 'cat'

/** Модификатор блюда: острота, прожарка, лёд. На цену не влияет — уходит на кухню. */
export interface DishOption {
  id: string
  name: string
  choices: string[]
  default?: string
  /** Что вариант добавляет или снимает по аллергенам. */
  effects?: Record<string, { adds?: string[]; removes?: string[] }>
  /** Надбавка к цене блюда: бутылка вина не может стоить как бокал. */
  priceDelta?: Record<string, number>
}

export interface Dish {
  allergens?: string[]
  id: string
  name: string
  desc: string
  price: number
  serving?: string
  kcal?: number
  tags?: string[]
  photo?: boolean
  /** Фото, загруженное из кабинета: `/api/menu/photo/<id>`. */
  photoUrl?: string
  stop?: boolean
  /** Цех явно; иначе решает категория (напитки и вино — бар). */
  station?: 'kitchen' | 'bar'
  options?: DishOption[]
}

export type LineOptions = Record<string, string>

/** Аллергены и диета — разные вопросы гостя; список общий с сервером. */
export function allergenTags(dish: Dish, options: LineOptions = {}): string[] {
  return allergensFor(dish, options)
}

export function possibleAllergens(dish: Dish): string[] {
  return possibleAllergensFor(dish)
}

export function dietTags(dish: Dish): string[] {
  return dietTagsOf(dish)
}

const CATEGORY_EMOJI: Record<string, string> = {
  Закуски: '🫒',
  Салаты: '🥗',
  Супы: '🍲',
  Горячее: '🍽',
  'Паста и пицца': '🍕',
  Гарниры: '🍟',
  Десерты: '🍰',
  Напитки: '🥤'
}

export function categoryOfDish(id: string): string | null {
  for (const cat of CATEGORIES) if (MENU[cat].some(d => d.id === id)) return cat
  return null
}

/** Заглушка вместо фото: по блюду, а не один лимон на всё меню. */
export function dishEmoji(dish: Dish): string {
  if (dish.id === 'espresso' || dish.id === 'cappuccino') return '☕'
  if (dish.id === 'seatea') return '🫖'
  const cat = categoryOfDish(dish.id)
  // Рыбу и морепродукты выделяем только там, где это главное в блюде
  if (cat === 'Горячее' || cat === 'Закуски') {
    const tags = dish.tags ?? []
    if (tags.includes('морепродукты')) return '🦐'
    if (tags.includes('рыба')) return '🐟'
  }
  return (cat && CATEGORY_EMOJI[cat]) || '🍽'
}

/** Значок в карточке меню: острое / растительное. */
export function dishMark(dish: Dish): string {
  const tags = dish.tags ?? []
  if (tags.includes('острое')) return ' 🌶'
  if (tags.includes('веган') || tags.includes('вегетарианское')) return ' 🌱'
  return ''
}

/** «Остро · Без льда» — короткая подпись выбранных модификаторов. */
/**
 * Цена позиции с учётом выбранных модификаторов — то же правило, что на сервере
 * (apps/api/src/menu.ts). Гость обязан видеть на кнопке ту сумму, которая уйдёт
 * в счёт: раньше карточка показывала базовые 590 ₽ за бутылку за 2800 ₽.
 */
export function priceWithOptions(dish: Dish, options: LineOptions = {}): number {
  let price = dish.price
  for (const opt of dish.options ?? []) {
    const chosen = options[opt.id] ?? opt.default ?? opt.choices[0]
    const delta = opt.priceDelta?.[chosen]
    if (typeof delta === 'number') price += delta
  }
  return Math.round(price * 100) / 100
}

export function optionsLabel(options: LineOptions | undefined): string {
  const values = Object.values(options ?? {})
  return values.length ? values.join(' · ') : ''
}

export function defaultOptions(dish: Dish): LineOptions {
  const out: LineOptions = {}
  for (const opt of dish.options ?? []) out[opt.id] = opt.default ?? opt.choices[0]
  return out
}

/**
 * Меню — живое: сервер отдаёт опубликованное из кабинета (`/api/menu/live`),
 * а menu.json в сборке — только запасной вариант, пока сервер не ответил.
 * `let` здесь намеренно: экраны читают MENU при отрисовке, а после публикации
 * меню подменяется целиком и все подписчики перерисовываются.
 */
export let MENU = menuJson as Record<string, Dish[]>
export let CATEGORIES = Object.keys(MENU)
/** 0 — меню из сборки; иначе версия публикации с сервера. */
export let MENU_VERSION = 0

export interface MenuDocument {
  version: number
  categories: { name: string; dishes: Dish[] }[]
}

const menuListeners = new Set<() => void>()

export function setMenu(doc: MenuDocument) {
  const next: Record<string, Dish[]> = {}
  for (const c of doc.categories) {
    const shown = c.dishes.filter(d => !(d as { hidden?: boolean }).hidden)
    if (shown.length) next[c.name] = shown
  }
  MENU = next
  CATEGORIES = Object.keys(next)
  MENU_VERSION = doc.version
  for (const fn of menuListeners) fn()
}

export function onMenuChange(fn: () => void): () => void {
  menuListeners.add(fn)
  return () => menuListeners.delete(fn)
}

let loading: Promise<boolean> | null = null

/** Перечитать меню с сервера. Не вышло — остаёмся на том, что есть. */
export function loadMenu(timeoutMs = 3000): Promise<boolean> {
  loading ??= (async () => {
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), timeoutMs)
    try {
      const res = await fetch('/api/menu/live', { signal: stop.signal })
      if (!res.ok) return false
      const doc = (await res.json()) as MenuDocument
      if (!Array.isArray(doc.categories) || typeof doc.version !== 'number') return false
      setMenu(doc)
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
      loading = null
    }
  })()
  return loading
}

/** Снимок пришёл с другой версией меню — значит, его только что опубликовали. */
export function ensureMenu(version: number | null | undefined) {
  if (typeof version === 'number' && version !== MENU_VERSION) void loadMenu()
}

/**
 * Блюдо с живым стоп-листом. Сервер присылает актуальный список в снимке
 * стола (`snap.stop`): кухня выключает блюда тумблером, и флаг в menu.json —
 * только значение по умолчанию. Пока снимка нет, верим файлу.
 */
export function withStop(dish: Dish, live: string[] | null | undefined): Dish {
  const stop = live ? live.includes(dish.id) : !!dish.stop
  return stop === !!dish.stop ? dish : { ...dish, stop }
}

export function findDish(id: string): Dish | undefined {
  for (const cat of CATEGORIES) {
    const d = MENU[cat].find(x => x.id === id)
    if (d) return d
  }
  return undefined
}

/** Название заведения — из настроек кабинета; до их загрузки — из плана зала. */
export let RESTAURANT = HALL_CONFIG.restaurant
export function setRestaurant(name: string) {
  RESTAURANT = name
}
// Зона стола берётся из плана зала (src/hall.json), а не хардкодом
export const HALL_LABEL = (tableId ? zoneOfTable(tableId) : null) ?? 'Зал'
export const TABLE_SEATS = tableId ? seatsOfTable(tableId) : null
export const WAITER_NAME = 'Максим'
