// Меню как данные сервера: цены, названия, цех и проверка модификаторов.
import { menu } from '@easypay/config'
import { ALLERGENS, allergensFor, possibleAllergensFor, removedAllergensFor } from '@easypay/domain/allergens'

const MENU = menu

/** Напитки и алкоголь готовит бар, остальное — кухня: разные очереди и темп. */
const BAR_CATEGORIES = new Set(['Напитки', 'Вино и бар'])

const DISHES = new Map<string, any>()
for (const category of Object.keys(MENU)) {
  for (const dish of MENU[category]) {
    // Станцию можно задать у блюда явно — иначе решает категория
    const station = dish.station ?? (BAR_CATEGORIES.has(category) ? 'bar' : 'kitchen')
    DISHES.set(dish.id, { ...dish, category, station })
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

/**
 * Цена позиции с учётом модификаторов. Бутылка вина не может стоить как бокал:
 * надбавка объявляется в меню (priceDelta у варианта опции) и прибавляется к
 * цене блюда. Считает сервер — клиент такие вещи считать не должен.
 */
export function priceWithOptions(id: string, options: Record<string, string> = {}) {
  const dish = DISHES.get(id)
  if (!dish) return 0
  let price = Number(dish.price) || 0
  for (const opt of dish.options ?? []) {
    const chosen = options[opt.id] ?? opt.default
    const delta = opt.priceDelta?.[chosen]
    if (typeof delta === 'number') price += delta
  }
  return Math.round(price * 100) / 100
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
    // Надбавки за модификаторы: гость должен видеть цену бутылки до заказа
    priceDeltas: Object.fromEntries(
      (dish.options ?? []).filter((o: any) => o.priceDelta).map((o: any) => [o.id, o.priceDelta])
    ),
    allergens: allergensFor(dish, {}),
    possibleAllergens: possibleAllergensFor(dish)
  }))
  return { dishes, allergens: ALLERGENS }
}
