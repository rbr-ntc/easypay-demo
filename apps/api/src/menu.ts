// Меню как данные сервера: цены, названия, цех и проверка модификаторов.
//
// Источник меню — документ из базы, который менеджер публикует из кабинета.
// menu.json — только начальное наполнение: пока ничего не опубликовано,
// работаем по нему. Документ — массив категорий, а не объект: jsonb в Postgres
// не хранит порядок ключей, а порядок категорий в меню — решение заведения.
import { menu } from '@easypay/config'
import { ALLERGENS, allergensFor, possibleAllergensFor, removedAllergensFor } from '@easypay/domain/allergens'

/** Напитки и алкоголь готовит бар, остальное — кухня: разные очереди и темп. */
const BAR_CATEGORIES = new Set(['Напитки', 'Вино и бар'])

export interface MenuCategory {
  name: string
  dishes: any[]
}

export interface MenuDoc {
  /** Растёт с каждой публикацией: клиенты по нему понимают, что меню сменилось. */
  version: number
  publishedAt: number | null
  categories: MenuCategory[]
}

/** Меню из файла — пока в базе ничего не опубликовано. */
export function menuFromConfig(): MenuDoc {
  const raw = menu as Record<string, any[]>
  return {
    version: 1,
    publishedAt: null,
    categories: Object.keys(raw).map(name => ({ name, dishes: raw[name] }))
  }
}

let MENU_DOC: MenuDoc = menuFromConfig()
let DISHES = new Map<string, any>()
/**
 * Снятые с меню блюда. Заказать их нельзя, но в открытом счёте, на кухне и в
 * чеке они должны называться по-человечески, а не кодом: позиция заказана
 * до публикации, её цена зафиксирована в строке счёта.
 */
const ARCHIVE = new Map<string, any>()

/** Опубликовать меню в памяти процесса: проверки заказа не ходят в базу. */
export function applyMenu(doc: MenuDoc) {
  const next = new Map<string, any>()
  for (const category of doc.categories) {
    for (const dish of category.dishes) {
      if (dish.hidden) continue
      // Станцию можно задать у блюда явно — иначе решает категория
      const station = dish.station ?? (BAR_CATEGORIES.has(category.name) ? 'bar' : 'kitchen')
      next.set(dish.id, { ...dish, category: category.name, station })
    }
  }
  for (const [id, dish] of DISHES) if (!next.has(id)) ARCHIVE.set(id, dish)
  for (const id of next.keys()) ARCHIVE.delete(id)
  DISHES = next
  MENU_DOC = doc
}
applyMenu(MENU_DOC)

export const currentMenu = (): MenuDoc => MENU_DOC
export const menuVersion = (): number => MENU_DOC.version

export function getDish(id: string | null) {
  return id ? DISHES.get(id) ?? null : null
}

// ── Стоп-лист ───────────────────────────────────────────────────────────
// В menu.json у блюда может стоять stop — это значение по умолчанию. Кухня
// выключает и включает блюда тумблером: переопределения хранятся в базе и
// здесь, в памяти процесса, чтобы проверка заказа не ходила в базу.

const stopOverrides = new Map<string, boolean>()

/** Загрузить переопределения из хранилища — при старте сервера. */
export function applyStopOverrides(overrides: Record<string, boolean>) {
  stopOverrides.clear()
  // Все, а не только известные: блюдо могут вернуть в меню следующей публикацией
  for (const [id, stop] of Object.entries(overrides)) stopOverrides.set(id, stop)
}

/**
 * Кто и когда выключил блюдо. Утка стояла в стопе с начала смены — по
 * умолчанию из меню или со вчера, — и повар не мог понять, правда ли она
 * закончилась. Метка «кто, когда» снимает этот вопрос.
 */
const stopMeta = new Map<string, { by: string | null; at: number | null }>()

export function setStopOverride(id: string, stop: boolean, by: string | null = null, at: number = Date.now()) {
  stopOverrides.set(id, stop)
  stopMeta.set(id, { by, at })
}

export function applyStopMeta(meta: Record<string, { by: string | null; at: number | null }>) {
  for (const [id, m] of Object.entries(meta)) stopMeta.set(id, m)
}

/** Для стоп-листа кухни: у каждого выключенного блюда — кто и когда, или «по умолчанию в меню». */
export function stopInfo(): Record<string, { by: string | null; at: number | null; byMenu: boolean }> {
  return Object.fromEntries(
    stopList().map(id => {
      const m = stopOverrides.has(id) ? stopMeta.get(id) : undefined
      return [id, { by: m?.by ?? null, at: m?.at ?? null, byMenu: !stopOverrides.has(id) }]
    })
  )
}

export function isStopped(id: string): boolean {
  return stopOverrides.get(id) ?? !!DISHES.get(id)?.stop
}

/** Что сейчас нельзя заказать — уходит гостям в снимке стола и кухне. */
export function stopList(): string[] {
  return [...DISHES.keys()].filter(isStopped)
}

/** Блюдо меню или снятое с него — для названий, цеха и старых строк счёта. */
const known = (id: string) => DISHES.get(id) ?? ARCHIVE.get(id)

export function priceOf(id: string) {
  return known(id)?.price ?? 0
}

export function dishName(id: string) {
  return known(id)?.name ?? id
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
  return known(id)?.station ?? 'kitchen'
}

/** Аллергены позиции считаем с учётом выбранных модификаторов: овсяное молоко снимает
 *  лактозу, миндальное добавляет орехи. Без опций получится ложь в обе стороны. */
export function allergensOf(id: string, options: Record<string, string> = {}) {
  return allergensFor(known(id), options)
}

/** Что аллергенного убрал выбранный модификатор — кухня обязана видеть это отдельно. */
export function removedAllergensOf(id: string, options: Record<string, string> = {}) {
  return removedAllergensFor(known(id), options)
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
    stop: isStopped(dish.id),
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

// ── Проверка документа меню ─────────────────────────────────────────────

const DISH_ID = /^[a-z0-9][a-z0-9-]{1,39}$/
const MAX_DISHES = 400

/**
 * Черновик проверяется мягко (можно сохранить недописанное блюдо), публикация —
 * строго: гость не должен увидеть блюдо без цены или без заявленных аллергенов.
 * Аллергены обязательны явно: пустой список — это решение «аллергенов нет»,
 * а отсутствие поля — «не проверяли», и такое не публикуем.
 */
export function checkMenuDoc(raw: unknown, strict: boolean): { doc?: Omit<MenuDoc, 'version' | 'publishedAt'>; errors: string[] } {
  const errors: string[] = []
  const cats = (raw as any)?.categories
  if (!Array.isArray(cats)) return { errors: ['categories required'] }
  const ids = new Set<string>()
  const names = new Set<string>()
  let total = 0
  const categories: MenuCategory[] = []
  for (const c of cats) {
    const name = String(c?.name ?? '').trim().slice(0, 40)
    if (!name) errors.push('category name required')
    else if (names.has(name)) errors.push(`duplicate category "${name}"`)
    names.add(name)
    const dishes: any[] = []
    for (const d of Array.isArray(c?.dishes) ? c.dishes : []) {
      total += 1
      const id = String(d?.id ?? '')
      if (!DISH_ID.test(id)) errors.push(`bad dish id "${id}"`)
      else if (ids.has(id)) errors.push(`duplicate dish "${id}"`)
      ids.add(id)
      const dishName = String(d?.name ?? '').trim().slice(0, 80)
      const price = Number(d?.price)
      if (!dishName) errors.push(`${id}: name required`)
      if (!Number.isFinite(price) || price < 0 || price > 1_000_000) errors.push(`${id}: bad price`)
      const allergens = Array.isArray(d?.allergens) ? d.allergens.map(String) : null
      if (allergens?.some((a: string) => !ALLERGENS.includes(a))) errors.push(`${id}: unknown allergen`)
      if (strict && !d?.hidden && allergens === null) errors.push(`${id}: allergens required`)
      const photoUrl = typeof d?.photoUrl === 'string' && /^\/api\/menu\/photo\/[a-f0-9-]{36}$/.test(d.photoUrl) ? d.photoUrl : undefined
      const base = Number.isFinite(price) ? price : 0
      const options = Array.isArray(d?.options) ? d.options.map((o: any) => checkOptionSpec(o, base)).filter(Boolean) : undefined
      dishes.push({
        ...pick(d, ['serving', 'tags']),
        // Флаги — только настоящие булевы: строка "false" иначе означала бы «в стопе»
        ...(d?.photo === true ? { photo: true } : {}),
        ...(d?.stop === true ? { stop: true } : {}),
        ...(d?.hidden === true ? { hidden: true } : {}),
        // Цех — только известный: иначе блюдо не попало бы ни в одну очередь
        ...(d?.station === 'kitchen' || d?.station === 'bar' ? { station: d.station } : {}),
        id,
        name: dishName,
        desc: String(d?.desc ?? '').slice(0, 300),
        price: Math.round((Number.isFinite(price) ? price : 0) * 100) / 100,
        ...(Number.isFinite(Number(d?.kcal)) && d?.kcal !== '' && d?.kcal !== null && d?.kcal !== undefined ? { kcal: Math.round(Number(d.kcal)) } : {}),
        ...(allergens ? { allergens: ALLERGENS.filter(a => allergens.includes(a)) } : {}),
        ...(photoUrl ? { photoUrl } : {}),
        ...(options?.length ? { options } : {})
      })
    }
    categories.push({ name, dishes })
  }
  if (total > MAX_DISHES) errors.push('too many dishes')
  if (strict && ![...categories].some(c => c.dishes.some(d => !d.hidden))) errors.push('menu is empty')
  return { doc: { categories }, errors }
}

function pick(obj: any, keys: string[]) {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k]
  return out
}

/**
 * Группа модификаторов: название, варианты, надбавки и аллергенные эффекты.
 * Надбавка не может увести цену позиции ниже нуля, эффекты — только из справочника.
 */
function checkOptionSpec(o: any, basePrice: number) {
  const id = String(o?.id ?? '').trim()
  const name = String(o?.name ?? '').trim().slice(0, 40)
  const choices = Array.isArray(o?.choices) ? o.choices.map((c: unknown) => String(c).trim().slice(0, 40)).filter(Boolean) : []
  if (!/^[a-z0-9-]{1,30}$/.test(id) || !name || choices.length < 2) return null
  const priceDelta: Record<string, number> = {}
  for (const [choice, delta] of Object.entries(o?.priceDelta ?? {})) {
    const n = Number(delta)
    if (choices.includes(choice) && Number.isFinite(n) && n !== 0) priceDelta[choice] = Math.max(-basePrice, Math.round(n * 100) / 100)
  }
  const effects: Record<string, { adds?: string[]; removes?: string[] }> = {}
  for (const [choice, eff] of Object.entries(o?.effects ?? {})) {
    if (!choices.includes(choice) || !eff || typeof eff !== 'object') continue
    const clean = (list: unknown) => (Array.isArray(list) ? list.map(String).filter(a => ALLERGENS.includes(a)) : [])
    const adds = clean((eff as any).adds)
    const removes = clean((eff as any).removes)
    if (adds.length || removes.length) effects[choice] = { ...(adds.length ? { adds } : {}), ...(removes.length ? { removes } : {}) }
  }
  return {
    ...(Object.keys(priceDelta).length ? { priceDelta } : {}),
    ...(Object.keys(effects).length ? { effects } : {}),
    id,
    name,
    choices: [...new Set(choices)],
    default: choices.includes(o?.default) ? o.default : choices[0]
  }
}
