import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allergyHits, allergyNote, rescues } from '../src/guest/allergy.ts'

/**
 * Аллергии в карточке и на витрине меню — на настоящих блюдах из menu.json:
 * если меню поменяют, тест должен это заметить, а не проверять выдумку.
 */

const menu = JSON.parse(readFileSync(new URL('../../../packages/config/menu.json', import.meta.url), 'utf8'))
const dish = (id: string) => Object.values(menu).flat().find((d: any) => d.id === id) as any

test('борщ со сметаной — лактоза есть, «без сметаны» её снимает', () => {
  const borsch = dish('borsch')
  assert.deepEqual(allergyHits(borsch, ['лактоза']), ['лактоза'])
  assert.deepEqual(allergyHits(borsch, ['лактоза'], { sourcream: 'Без сметаны' }), [])
  assert.deepEqual(
    rescues(borsch, ['лактоза'], ['лактоза']).map(r => r.choice),
    ['Без сметаны']
  )
  assert.equal(allergyNote(borsch, ['лактоза']), 'Есть лактоза — можно убрать')
})

test('спасение не приносит другой аллерген гостя: миндаль — не выход при аллергии на орехи', () => {
  const cappuccino = dish('cappuccino')
  assert.deepEqual(
    rescues(cappuccino, ['лактоза'], ['лактоза']).map(r => r.choice),
    ['Овсяное', 'Миндальное']
  )
  assert.deepEqual(
    rescues(cappuccino, ['лактоза'], ['лактоза', 'орехи']).map(r => r.choice),
    ['Овсяное']
  )
  // Лактоза и глютен: овсяное добавляет глютен, миндальное безопасно
  assert.deepEqual(
    rescues(cappuccino, ['лактоза'], ['лактоза', 'глютен']).map(r => r.choice),
    ['Миндальное']
  )
})

test('«можно убрать» — только если убираются ВСЕ совпавшие аллергены', () => {
  // В брускетте глютен и лактоза, вариантов нет — нельзя
  assert.equal(allergyNote(dish('bruschetta'), ['лактоза']), 'Есть лактоза — вам нельзя')
  // В борще глютен не снимается ничем: гостю с глютеном и лактозой — нельзя
  assert.equal(allergyNote(dish('borsch'), ['лактоза', 'глютен']), 'Есть глютен, лактоза — вам нельзя')
})

test('вариант, добавляющий аллерген, делает его видимым', () => {
  const ice = dish('icecream')
  assert.deepEqual(allergyHits(ice, ['орехи']), [])
  assert.deepEqual(allergyHits(ice, ['орехи'], { flavor: 'Фисташка' }), ['орехи'])
})

test('без заявленных аллергий предупреждений нет', () => {
  assert.equal(allergyNote(dish('borsch'), []), '')
  assert.deepEqual(allergyHits(dish('icecream'), []), [])
})
