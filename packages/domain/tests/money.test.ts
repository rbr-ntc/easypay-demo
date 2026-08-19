import test from 'node:test'
import assert from 'node:assert/strict'
import { amountFor, computeTotals, isBillLine, round2 } from '../src/money.ts'

const PRICES = { tomyam: 690, padthai: 600, steak: 1290, lemonade: 220 }
const priceOf = id => PRICES[id] ?? 0

const persona = id => ({ id })
/** По умолчанию позиция уже отправлена на кухню — то есть в счёте. */
const line = (personaId, dishId, opts = {}) => ({
  personaId,
  dishId,
  qty: opts.qty ?? 1,
  shared: !!opts.shared,
  sharedWith: opts.sharedWith ?? [],
  sent: opts.sent !== false,
  cancelled: !!opts.cancelled,
  price: opts.price
})

// Стол: у каждого своё, общий лимонад заказан, когда за столом были Аня и Дима
function table() {
  return {
    personas: [persona('anya'), persona('dima'), persona('lena')],
    lines: [
      line('anya', 'tomyam'), // 690
      line('dima', 'padthai'), // 600
      line('lena', 'steak'), // 1290
      line('anya', 'lemonade', { qty: 2, shared: true, sharedWith: ['anya', 'dima'] }) // 440 на двоих
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

test('в счёт входит только отправленное на кухню', () => {
  const state = {
    personas: [persona('a')],
    lines: [line('a', 'tomyam'), line('a', 'steak', { sent: false })],
    payments: []
  }
  const t = computeTotals(state, priceOf)
  assert.equal(t.tableTotal, 690, 'черновик не долг стола')
  assert.equal(t.draftTotal, 1290)
  assert.equal(t.draftOf('a'), 1290)
  assert.equal(isBillLine(state.lines[0]), true)
  assert.equal(isBillLine(state.lines[1]), false)
})

test('отменённая позиция выпадает из счёта', () => {
  const t = computeTotals(
    { personas: [persona('a')], lines: [line('a', 'tomyam'), line('a', 'steak', { cancelled: true })], payments: [] },
    priceOf
  )
  assert.equal(t.tableTotal, 690)
})

test('цена берётся с позиции, если она зафиксирована при заказе', () => {
  const t = computeTotals({ personas: [persona('a')], lines: [line('a', 'tomyam', { price: 500 })], payments: [] }, priceOf)
  assert.equal(t.tableTotal, 500, 'правка меню задним числом не меняет открытый счёт')
})

test('общее блюдо делят только те, кто был за столом в момент заказа', () => {
  const t = computeTotals(table(), priceOf)
  assert.equal(t.tableTotal, 690 + 600 + 1290 + 440)
  assert.equal(t.sharedTotal, 440)
  assert.equal(t.shareOf('anya'), 220)
  assert.equal(t.shareOf('dima'), 220)
  assert.equal(t.shareOf('lena'), 0, 'Лена подсела позже — за чужой лимонад не платит')
  assert.equal(t.totalOf('anya'), 910)
  assert.equal(t.totalOf('lena'), 1290)
})

test('доля не меняется задним числом при подсадке гостя', () => {
  const state = table()
  const before = amountFor(computeTotals(state, priceOf), 'anya', 'own')
  state.personas.push(persona('kira')) // подсел четвёртый
  const after = amountFor(computeTotals(state, priceOf), 'anya', 'own')
  assert.equal(before, after, 'заплативший раньше не переплачивает')
  assert.equal(before, 910)
})

test('сумма долей общего равна стоимости общих блюд', () => {
  const t = computeTotals(table(), priceOf)
  const sum = ['anya', 'dima', 'lena'].reduce((s, id) => s + t.shareOf(id), 0)
  assert.equal(round2(sum), t.sharedTotal)
})

test('оплата уменьшает остаток стола и остаток персоны', () => {
  const state = table()
  const own = computeTotals(state, priceOf)
  const part = amountFor(own, 'anya', 'own')
  state.payments.push({ personaId: 'anya', amount: part })
  const after = computeTotals(state, priceOf)
  assert.equal(after.paidTotal, part)
  assert.equal(round2(after.remaining), round2(own.tableTotal - part))
  assert.equal(after.remainingOf('anya'), 0)
})

test('«поровну» не превышает неоплаченный остаток', () => {
  const state = table()
  const t0 = computeTotals(state, priceOf)
  assert.equal(amountFor(t0, 'dima', 'equal'), round2(t0.tableTotal / 3))
  state.payments.push({ personaId: 'anya', amount: t0.tableTotal - 100 })
  assert.equal(amountFor(computeTotals(state, priceOf), 'dima', 'equal'), 100)
})

test('двойная оплата стола невозможна: второму остаётся ноль', () => {
  const state = table()
  const full = amountFor(computeTotals(state, priceOf), 'anya', 'full')
  state.payments.push({ personaId: 'anya', amount: full })
  const after = computeTotals(state, priceOf)
  assert.equal(amountFor(after, 'dima', 'full'), 0)
  assert.equal(amountFor(after, 'dima', 'own'), 0)
  assert.equal(amountFor(after, 'dima', 'equal'), 0)
})

test('round2 округляет до копеек и переживает мусор', () => {
  assert.equal(round2(666.666666), 666.67)
  assert.equal(round2('12.345'), 12.35)
  assert.equal(round2(undefined), 0)
})

test('копейка от деления на троих не остаётся висеть на столе', () => {
  const t = {
    personas: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    lines: [
      { uid: 1, dishId: 'brusketta', qty: 1, price: 490, shared: true, sharedWith: ['a', 'b', 'c'], sent: true }
    ],
    payments: [],
    tips: []
  }
  const priceOf = () => 490

  // Первые двое платят свою долю как есть
  const first = amountFor(computeTotals(t, priceOf), 'a', 'own')
  assert.equal(first, 163.33)
  t.payments.push({ personaId: 'a', amount: first })

  const second = amountFor(computeTotals(t, priceOf), 'b', 'own')
  assert.equal(second, 163.33)
  t.payments.push({ personaId: 'b', amount: second })

  // Третий добирает хвост округления, иначе стол закрывать через force
  const third = amountFor(computeTotals(t, priceOf), 'c', 'own')
  assert.equal(third, 163.34, 'последний плательщик забирает копейку округления')
  t.payments.push({ personaId: 'c', amount: third })

  assert.equal(round2(computeTotals(t, priceOf).remaining), 0, 'стол рассчитан полностью')
})

test('за кого заплатил сосед — тот больше ничего не должен', () => {
  const t = {
    personas: [{ id: 'a' }, { id: 'b' }],
    lines: [
      { uid: 1, dishId: 'steak', qty: 1, price: 1290, personaId: 'a', sent: true },
      { uid: 2, dishId: 'pasta', qty: 1, price: 690, personaId: 'b', sent: true }
    ],
    // Аня платит за весь стол
    payments: [{ personaId: 'a', amount: 1980, scope: 'full' }],
    tips: []
  }
  const money = computeTotals(t, () => 0)

  assert.equal(money.remaining, 0)
  assert.equal(money.totalOf('b'), 690, 'его блюдо по-прежнему его')
  assert.equal(money.remainingOf('b'), 0, 'но лично он уже ничего не должен')
  assert.equal(amountFor(money, 'b', 'own'), 0)
})

test('переплата соседа гасит долги целиком, а не размазывается по всем', () => {
  // Два требования сразу: показанное совпадает со списываемым, и сумма личных
  // остатков равна остатку стола. Пропорция давала второе и ломала первое —
  // гостей догоняли платежи на 60 копеек. Кламп давал первое и ломал второе:
  // двум гостям показывали долги, вдвое превышающие долг стола.
  const t = {
    personas: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    lines: [
      { uid: 1, dishId: 'steak', qty: 1, price: 1290, personaId: 'a', sent: true },
      { uid: 2, dishId: 'tomyam', qty: 1, price: 690, personaId: 'b', sent: true },
      { uid: 3, dishId: 'padthai', qty: 1, price: 600, personaId: 'c', sent: true }
    ],
    // Первый гость заплатил за стол больше своего счёта
    payments: [{ personaId: 'a', amount: 1980, scope: 'full' }],
    tips: []
  }
  const money = computeTotals(t, () => 0)

  const left = ['a', 'b', 'c'].map(id => money.remainingOf(id))
  assert.equal(round2(left.reduce((s, x) => s + x, 0)), round2(money.remaining), 'сумма личных = остаток стола')
  assert.equal(left[0], 0, 'заплативший больше не должен')

  // Каждому показывают ровно то, что с него спишут
  for (const id of ['b', 'c']) {
    assert.equal(amountFor(money, id, 'own'), money.remainingOf(id))
  }

  // Первый должник гасится целиком, а не наполовину: хвостов не остаётся
  assert.equal(left[1], 0, 'долг того, кто сел раньше, покрыт полностью')
  assert.equal(left[2], 600)
})

test('без переплаты личные остатки не трогаются', () => {
  const t = {
    personas: [{ id: 'a' }, { id: 'b' }],
    lines: [
      { uid: 1, dishId: 'steak', qty: 1, price: 1290, personaId: 'a', sent: true },
      { uid: 2, dishId: 'tomyam', qty: 1, price: 690, personaId: 'b', sent: true }
    ],
    payments: [],
    tips: []
  }
  const money = computeTotals(t, () => 0)
  assert.equal(money.remainingOf('a'), 1290)
  assert.equal(money.remainingOf('b'), 690)
  assert.equal(money.remainingOf('a') + money.remainingOf('b'), money.remaining)
})
