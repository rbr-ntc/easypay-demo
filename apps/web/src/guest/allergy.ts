import { allergensFor } from '@easypay/domain/allergens'
import type { Dish, LineOptions } from '../data'

/**
 * Аллергии гостя против блюда. Модуль без зависимостей от остального
 * клиента — только домен: это здоровье, и оно покрыто тестами
 * (`apps/web/tests/allergy.test.ts`).
 */

/** То же, что `defaultOptions` в data.ts: вариант по умолчанию или первый. */
function defaults(dish: Dish): LineOptions {
  const out: LineOptions = {}
  for (const opt of dish.options ?? []) out[opt.id] = opt.default ?? opt.choices[0]
  return out
}

/**
 * Варианты, которые снимают заявленный аллерген. Меню это уже описывает
 * (`effects.removes`) — кухня видит «Без сметаны — снимает лактозу», и гость
 * должен видеть то же.
 */
export function rescues(dish: Dish, blocked: string[] | null, mine: string[]) {
  if (!blocked || blocked.length === 0) return []
  const hits: { optionId: string; optionName: string; choice: string; removes: string[] }[] = []
  for (const opt of dish.options ?? []) {
    for (const choice of opt.choices ?? []) {
      const removes = (opt.effects?.[choice]?.removes ?? []).filter(a => blocked.includes(a))
      const adds = opt.effects?.[choice]?.adds ?? []
      // Спасение — то, что снимает заявленный аллерген и не приносит другой
      // из СПИСКА ЭТОГО ГОСТЯ. Овсяное молоко добавляет глютен: человеку с
      // непереносимостью лактозы оно подходит, человеку с целиакией — нет.
      const dangerous = adds.some(a => mine.includes(a))
      if (removes.length > 0 && !dangerous) hits.push({ optionId: opt.id, optionName: opt.name, choice, removes })
    }
  }
  return hits
}

/** Что из аллергий гостя есть в блюде при выбранных вариантах. */
export function allergyHits(dish: Dish, mine: string[], options: LineOptions = defaults(dish)): string[] {
  if (mine.length === 0) return []
  return allergensFor(dish, options).filter(a => mine.includes(a))
}

/**
 * Подпись на карточке меню: «Есть лактоза — вам нельзя» или «— можно убрать».
 * «Можно убрать» — только если варианты снимают ВСЕ совпавшие аллергены:
 * иначе человеку с лактозой и орехами обещали бы безопасное блюдо, в
 * котором останутся орехи.
 */
export function allergyNote(dish: Dish, mine: string[]): string {
  const hits = allergyHits(dish, mine)
  if (hits.length === 0) return ''
  const removable = new Set(rescues(dish, hits, mine).flatMap(r => r.removes))
  const fixable = hits.every(a => removable.has(a))
  return `Есть ${hits.join(', ')} — ${fixable ? 'можно убрать' : 'вам нельзя'}`
}
