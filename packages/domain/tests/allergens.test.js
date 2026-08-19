import test from 'node:test'
import assert from 'node:assert/strict'
import { menu as MENU } from '@easypay/config'
import { ALLERGENS, allergensFor, dietTagsOf, isAllergen, possibleAllergensFor } from '../allergens.js'

const dishes = Object.values(MENU).flat()
const dish = id => dishes.find(d => d.id === id)

test('у каждого блюда есть явный список аллергенов', () => {
  for (const d of dishes) {
    assert.equal(Array.isArray(d.allergens), true, `${d.id}: поле allergens обязательно`)
    for (const tag of d.allergens) {
      assert.equal(isAllergen(tag), true, `${d.id}: "${tag}" не из справочника аллергенов`)
    }
  }
})

test('диетические пометки не смешиваются с аллергенами', () => {
  for (const d of dishes) {
    for (const tag of d.tags ?? []) {
      assert.equal(isAllergen(tag), false, `${d.id}: аллерген "${tag}" должен жить в allergens, а не в tags`)
    }
  }
  assert.deepEqual(dietTagsOf(dish('hummus')), ['веган'])
})

test('находки смены закрыты по данным меню', () => {
  // «веган» читается как гарантия безопасности, а внутри пита
  assert.equal(allergensFor(dish('hummus')).includes('глютен'), true)
  assert.equal(allergensFor(dish('caesar')).includes('лактоза'), true)
  assert.equal(allergensFor(dish('bruschetta')).includes('лактоза'), true)
  assert.equal(allergensFor(dish('tartare')).includes('глютен'), true)
  assert.equal(allergensFor(dish('medovik')).includes('глютен'), true)
})

test('модификатор добавляет аллерген', () => {
  assert.equal(allergensFor(dish('cappuccino'), { milk: 'Миндальное' }).includes('орехи'), true)
  assert.equal(allergensFor(dish('icecream'), { flavor: 'Фисташка' }).includes('орехи'), true)
  assert.equal(allergensFor(dish('fries'), { sauce: 'Сырный' }).includes('лактоза'), true)
})

test('модификатор снимает аллерген', () => {
  assert.equal(allergensFor(dish('cappuccino'), { milk: 'Овсяное' }).includes('лактоза'), false)
  assert.equal(allergensFor(dish('borsch'), { sourcream: 'Без сметаны' }).includes('лактоза'), false)
})

test('капучино не врёт в обе стороны одной позицией', () => {
  const oat = allergensFor(dish('cappuccino'), { milk: 'Овсяное' })
  const almond = allergensFor(dish('cappuccino'), { milk: 'Миндальное' })
  assert.equal(oat.includes('лактоза'), false)
  assert.equal(oat.includes('глютен'), true, 'овсяное молоко приносит глютен')
  assert.equal(almond.includes('орехи'), true)
  assert.equal(almond.includes('лактоза'), false)
})

test('дефолт блюда не приносит аллерген молча', () => {
  for (const d of dishes) {
    const byDefault = allergensFor(d, {})
    const declared = new Set(d.allergens)
    for (const tag of byDefault) {
      assert.equal(declared.has(tag), true, `${d.id}: дефолтные опции добавляют "${tag}" — гость об этом не узнает`)
    }
  }
})

test('худший случай по блюду включает все варианты опций', () => {
  const worst = possibleAllergensFor(dish('cappuccino'))
  assert.equal(worst.includes('лактоза'), true)
  assert.equal(worst.includes('орехи'), true)
  assert.equal(worst.includes('глютен'), true)
})

test('справочник аллергенов покрывает обязательный перечень ТР ТС 022/2011 в объёме меню', () => {
  for (const tag of ['глютен', 'лактоза', 'яйцо', 'рыба', 'морепродукты', 'орехи', 'арахис', 'кунжут', 'соя', 'сельдерей', 'горчица']) {
    assert.equal(ALLERGENS.includes(tag), true)
  }
})
