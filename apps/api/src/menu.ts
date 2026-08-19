// Меню как данные сервера: цены, названия, цех и проверка модификаторов.
import { menu } from '@easypay/config'
import { ALLERGENS, allergensFor, possibleAllergensFor, removedAllergensFor } from '@easypay/domain/allergens'

const MENU = menu

/** Напитки готовит бар, остальное — кухня: у них разные очереди и разный темп. */
const BAR_CATEGORIES = new Set(['Напитки'])

const DISHES = new Map<string, any>()
for (const category of Object.keys(MENU)) {
  for (const dish of MENU[category]) {
    DISHES.set(dish.id, { ...dish, category, station: BAR_CATEGORIES.has(category) ? 'bar' : 'kitchen' })
  }
}

export function getDish(id: string | null) {
  return id ? DISHES.get(id) ?? null : null
}

export function priceOf(id: string) {
  return DISHES.get(id)?.price ?? 0
}

export function dishName(id: string) {
  return DISHES.get(id)?.name ?? id
}

export function stationOf(id: string) {
  return DISHES.get(id)?.station ?? 'kitchen'
}

/** Аллергены позиции считаем с учётом выбранных модификаторов: овсяное молоко снимает
 *  лактозу, миндальное добавляет орехи. Без опций получится ложь в обе стороны. */
export function allergensOf(id: string, options: Record<string, string> = {}) {
  return allergensFor(DISHES.get(id), options)
}

/** Что аллергенного убрал выбранный модификатор — кухня обязана видеть это отдельно. */
export function removedAllergensOf(id: string, options: Record<string, string> = {}) {
  return removedAllergensFor(DISHES.get(id), options)
}

/**
 * Модификаторы блюда. Незнакомую группу или значение НЕ подменяем молча:
 * «верблюжье молоко вместо овсяного» — это чужой заказ и риск аллергии.
 * Возвращает {options} либо {error} с понятной причиной.
 */
export function checkOptions(dish: any, raw: unknown): { options?: Record<string, string>; error?: string } {
  const spec = dish.options ?? []
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { error: 'options must be an object' }
  }
  const given = raw && typeof raw === 'object' ? raw : {}

  for (const key of Object.keys(given)) {
    if (!spec.some(opt => opt.id === key)) return { error: `unknown option "${key}"` }
  }

  const options: Record<string, string> = {}
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

/**
 * Меню для клиента и интеграторов: с ценами, модификаторами и аллергенами —
 * как заявленными у блюда, так и худшим случаем по всем вариантам опций.
 */
export function menuPayload() {
  const dishes = [...DISHES.values()].map(dish => ({
    id: dish.id,
    name: dish.name,
    desc: dish.desc ?? null,
    price: dish.price,
    category: dish.category ?? null,
    station: dish.station ?? 'kitchen',
    stop: !!dish.stop,
    options: dish.options ?? [],
    allergens: allergensFor(dish, {}),
    possibleAllergens: possibleAllergensFor(dish)
  }))
  return { dishes, allergens: ALLERGENS }
}
