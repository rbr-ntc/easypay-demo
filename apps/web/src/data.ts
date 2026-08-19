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
  stop?: boolean
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

export const MENU = menuJson as Record<string, Dish[]>
export const CATEGORIES = Object.keys(MENU)

export function findDish(id: string): Dish | undefined {
  for (const cat of CATEGORIES) {
    const d = MENU[cat].find(x => x.id === id)
    if (d) return d
  }
  return undefined
}

export const RESTAURANT = HALL_CONFIG.restaurant
// Зона стола берётся из плана зала (src/hall.json), а не хардкодом
export const HALL_LABEL = (tableId ? zoneOfTable(tableId) : null) ?? 'Зал'
export const TABLE_SEATS = tableId ? seatsOfTable(tableId) : null
export const WAITER_NAME = 'Максим'
