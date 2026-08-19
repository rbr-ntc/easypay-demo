// Меню как данные сервера: цены, названия, цех и проверка модификаторов.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MENU = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'menu.json'), 'utf8'))

/** Напитки готовит бар, остальное — кухня: у них разные очереди и разный темп. */
const BAR_CATEGORIES = new Set(['Напитки'])

const DISHES = new Map()
for (const category of Object.keys(MENU)) {
  for (const dish of MENU[category]) {
    DISHES.set(dish.id, { ...dish, category, station: BAR_CATEGORIES.has(category) ? 'bar' : 'kitchen' })
  }
}

export function getDish(id) {
  return DISHES.get(id) ?? null
}

export function priceOf(id) {
  return DISHES.get(id)?.price ?? 0
}

export function dishName(id) {
  return DISHES.get(id)?.name ?? id
}

export function stationOf(id) {
  return DISHES.get(id)?.station ?? 'kitchen'
}

export function allergensOf(id) {
  const ALLERGENS = new Set(['глютен', 'лактоза', 'орехи', 'арахис', 'рыба', 'морепродукты', 'яйцо', 'кунжут'])
  return (DISHES.get(id)?.tags ?? []).filter(t => ALLERGENS.has(t))
}

/**
 * Модификаторы блюда. Незнакомую группу или значение НЕ подменяем молча:
 * «верблюжье молоко вместо овсяного» — это чужой заказ и риск аллергии.
 * Возвращает {options} либо {error} с понятной причиной.
 */
export function checkOptions(dish, raw) {
  const spec = dish.options ?? []
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { error: 'options must be an object' }
  }
  const given = raw && typeof raw === 'object' ? raw : {}

  for (const key of Object.keys(given)) {
    if (!spec.some(opt => opt.id === key)) return { error: `unknown option "${key}"` }
  }

  const options = {}
  for (const opt of spec) {
    const value = given[opt.id]
    if (value === undefined) {
      options[opt.id] = opt.default ?? opt.choices[0] // не выбрали — берём дефолт меню
      continue
    }
    if (!opt.choices.includes(value)) return { error: `bad value for "${opt.id}"` }
    options[opt.id] = value
  }
  return { options }
}
