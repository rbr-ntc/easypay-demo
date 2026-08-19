// Аллергены — один список и одно правило расчёта для сервера, гостя и кухни.
// Вынесено в shared по тому же принципу, что и деньги: ложноотрицательный аллерген
// дороже любой ошибки в рублях, две копии списка разъедутся на первом же добавлении.


export interface AllergenOptionEffect {
  adds?: string[]
  removes?: string[]
}

export interface AllergenDishOption {
  id: string
  name: string
  choices: string[]
  default?: string
  effects?: Record<string, AllergenOptionEffect>
}

export interface AllergenDish {
  allergens?: string[]
  tags?: string[]
  options?: AllergenDishOption[]
}

/** Перечень по ТР ТС 022/2011 в объёме, который встречается в нашем меню. */
export const ALLERGENS: string[] = [
  'глютен',
  'лактоза',
  'яйцо',
  'рыба',
  'морепродукты',
  'орехи',
  'арахис',
  'кунжут',
  'соя',
  'сельдерей',
  'горчица'
]

const ALLERGEN_SET = new Set(ALLERGENS)

export function isAllergen(tag: string): boolean {
  return ALLERGEN_SET.has(tag)
}

/** Диетические пометки — это не аллергены: «веган» не обещает отсутствие глютена. */
export function dietTagsOf(dish: AllergenDish | null | undefined): string[] {
  return (dish?.tags ?? []).filter(t => !isAllergen(t))
}

/**
 * Аллергены блюда С УЧЁТОМ выбранных модификаторов.
 * Вариант опции может и добавлять аллерген (миндальное молоко → орехи),
 * и снимать его (овсяное молоко → лактозы нет). Без этого карточка врёт в обе стороны.
 */
export function allergensFor(dish: AllergenDish | null | undefined, options?: Record<string, string>): string[] {
  if (!dish) return []
  const base = new Set((dish.allergens ?? (dish.tags ?? []).filter(isAllergen)).filter(isAllergen))

  for (const opt of dish.options ?? []) {
    const chosen = options?.[opt.id] ?? opt.default ?? opt.choices?.[0]
    const effect = opt.effects?.[chosen]
    if (!effect) continue
    for (const tag of effect.adds ?? []) if (isAllergen(tag)) base.add(tag)
    for (const tag of effect.removes ?? []) base.delete(tag)
  }

  return ALLERGENS.filter(tag => base.has(tag))
}

/** Худший случай по блюду: что может приехать при любом выборе опций. */
export function possibleAllergensFor(dish: AllergenDish | null | undefined): string[] {
  if (!dish) return []
  const worst = new Set(allergensFor(dish, {}))
  for (const opt of dish.options ?? []) {
    for (const choice of opt.choices ?? []) {
      for (const tag of allergensFor(dish, { [opt.id]: choice })) worst.add(tag)
    }
  }
  return ALLERGENS.filter(tag => worst.has(tag))
}
