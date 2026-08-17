import test from 'node:test'
import assert from 'node:assert/strict'
import { amountFor, computeTotals, round2 } from '../shared/money.js'

const PRICES = { tomyam: 690, padthai: 600, steak: 1290, lemonade: 220 }
const priceOf = id => PRICES[id] ?? 0

const persona = id => ({ id })
const line = (personaId, dishId, opts = {}) => ({ personaId, dishId, qty: opts.qty ?? 1, shared: !!opts.shared })

// Стол из разбора прототипа: у каждого своё + общие делятся на троих
function threeGuests() {
  return {
    personas: [persona('anya'), persona('dima'), persona('lena')],
    lines: [
      line('anya', 'tomyam'), // 690
      line('dima', 'padthai'), // 600
      line('lena', 'steak'), // 1290
      line('anya', 'lemonade', { qty: 2, shared: true }) // 440 общие
    ],
    payments: []
  }
}

test('пустой стол считается без деления на ноль', () => {
  const t = computeTotals({}, priceOf)
  assert.equal(t.participants, 1)
  assert.equal(t.tableTotal, 0)
  assert.equal(t.remaining, 0)
  assert.equal(t.ownOf(null), 0)
})

test('своё, доля общего и итог стола', () => {
  const t = computeTotals(threeGuests(), priceOf)
  assert.equal(t.tableTotal, 690 + 600 + 1290 + 440)
  assert.equal(t.sharedTotal, 440)
  assert.equal(round2(t.share), round2(440 / 3))
  assert.equal(t.ownOf('anya'), 690)
  assert.equal(round2(t.totalOf('anya')), round2(690 + 440 / 3))
})

test('количество умножается на цену', () => {
  const t = computeTotals({ personas: [persona('a')], lines: [line('a', 'padthai', { qty: 3 })] }, priceOf)
  assert.equal(t.tableTotal, 1800)
})

test('неизвестное блюдо не ломает счёт', () => {
  const t = computeTotals({ personas: [persona('a')], lines: [line('a', 'ghost')] }, priceOf)
  assert.equal(t.tableTotal, 0)
})

test('оплата уменьшает остаток стола и остаток персоны', () => {
  const state = threeGuests()
  const own = computeTotals(state, priceOf)
  const anyaPart = amountFor(own, 'anya', 'own')
  state.payments.push({ personaId: 'anya', amount: anyaPart })
  const after = computeTotals(state, priceOf)
  assert.equal(after.paidTotal, anyaPart)
  assert.equal(round2(after.remaining), round2(own.tableTotal - anyaPart))
  assert.equal(after.remainingOf('anya'), 0)
})

test('«своё» = своё + доля общего, повторно платить нечего', () => {
  const state = threeGuests()
  const first = amountFor(computeTotals(state, priceOf), 'anya', 'own')
  assert.equal(first, round2(690 + 440 / 3))
  state.payments.push({ personaId: 'anya', amount: first })
  assert.equal(amountFor(computeTotals(state, priceOf), 'anya', 'own'), 0)
})

test('«поровну» не превышает неоплаченный остаток', () => {
  const state = threeGuests()
  const t0 = computeTotals(state, priceOf)
  assert.equal(amountFor(t0, 'dima', 'equal'), round2(t0.tableTotal / 3))
  // почти всё уже оплачено — поровну ограничивается остатком
  state.payments.push({ personaId: 'anya', amount: t0.tableTotal - 100 })
  assert.equal(amountFor(computeTotals(state, priceOf), 'dima', 'equal'), 100)
})

test('двойная оплата стола невозможна: второму остаётся ноль', () => {
  const state = threeGuests()
  const full = amountFor(computeTotals(state, priceOf), 'anya', 'full')
  state.payments.push({ personaId: 'anya', amount: full })
  const after = computeTotals(state, priceOf)
  assert.equal(amountFor(after, 'dima', 'full'), 0)
  assert.equal(amountFor(after, 'dima', 'own'), 0)
  assert.equal(amountFor(after, 'dima', 'equal'), 0)
})

test('оплата чужой доли уменьшает мой остаток только через личные платежи', () => {
  const state = threeGuests()
  const t0 = computeTotals(state, priceOf)
  state.payments.push({ personaId: 'anya', amount: amountFor(t0, 'anya', 'own') })
  const after = computeTotals(state, priceOf)
  assert.equal(after.paidOf('dima'), 0)
  assert.equal(round2(after.remainingOf('dima')), round2(600 + 440 / 3))
})

test('round2 округляет до копеек и переживает мусор', () => {
  assert.equal(round2(666.666666), 666.67)
  assert.equal(round2('12.345'), 12.35)
  assert.equal(round2(undefined), 0)
})
