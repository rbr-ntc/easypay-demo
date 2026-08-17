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
