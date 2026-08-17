import menuJson from './menu.json'
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
}

export interface Dish {
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

/** Теги-аллергены отделяем от «диетических»: гостю это разные вопросы. */
const ALLERGENS = new Set(['глютен', 'лактоза', 'орехи', 'арахис', 'рыба', 'морепродукты', 'яйцо', 'кунжут'])

export function allergenTags(dish: Dish): string[] {
  return (dish.tags ?? []).filter(t => ALLERGENS.has(t))
}

export function dietTags(dish: Dish): string[] {
  return (dish.tags ?? []).filter(t => !ALLERGENS.has(t))
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
