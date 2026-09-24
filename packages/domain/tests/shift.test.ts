import test from 'node:test'
import assert from 'node:assert/strict'
import { buildShiftReport, type ReportCheck } from '../src/shift.ts'

/**
 * Отчёт смены — одна функция для X (идёт) и Z (закрыта). Раньше цифры смены
 * считались в трёх местах по-разному, и витрина спорила с реестром чеков.
 */

// Время по Москве (UTC+3) — отчёт считает часы заведения, а не машины, где идут тесты
const h = (hour: number, min = 0) => Date.UTC(2026, 8, 24, hour - 3, min)

const check = (over: Partial<ReportCheck>): ReportCheck => ({
  sessionId: over.sessionId ?? `s${Math.random()}`,
  tableId: '1',
  openedAt: h(12),
  closedAt: h(13),
  guests: 2,
  waiter: 'Максим',
  total: 0,
  paid: 0,
  debt: 0,
  overpaid: 0,
  refunded: 0,
  cancelledTotal: 0,
  payments: [],
  tips: [],
  lines: [],
  ...over
})

test('выручка по способам и по часам — из платежей, а не из счетов', () => {
  const r = buildShiftReport([
    check({
      total: 1500,
      paid: 1500,
      payments: [
        { amount: 1000, method: 'sbp', at: h(12, 40) },
        { amount: 500, method: 'cash', at: h(13, 5) }
      ]
    }),
    check({ total: 800, paid: 800, payments: [{ amount: 800, method: 'card', at: h(13, 30) }] })
  ])
  assert.equal(r.revenue, 2300)
  assert.deepEqual(r.byMethod, { sbp: 1000, card: 800, cash: 500 })
  assert.deepEqual(
    r.byHour.filter(x => x.amount > 0).map(x => [x.hour, x.amount]),
    [
      [12, 1000],
      [13, 1300]
    ]
  )
})

test('средний чек — по столам с деньгами; открытые столы в чеки не входят', () => {
  const r = buildShiftReport([
    check({ total: 1000, paid: 1000, payments: [{ amount: 1000, method: 'sbp', at: h(12) }] }),
    check({ total: 2000, paid: 2000, payments: [{ amount: 2000, method: 'sbp', at: h(12) }] }),
    check({ total: 500, paid: 0, debt: 500 }), // ушли, не заплатив
    check({ closedAt: null, total: 900, paid: 300, payments: [{ amount: 300, method: 'sbp', at: h(14) }] })
  ])
  assert.equal(r.checks, 3, 'чеков — закрытых столов')
  assert.equal(r.openTables, 1)
  assert.equal(r.openRemaining, 600)
  assert.equal(r.avgCheck, 1100, '(1000 + 2000 + 300) / 3 стола с деньгами')
  assert.equal(r.debt, 500)
})

test('возвраты вычитаются из выручки, списания кухни — отдельной строкой', () => {
  const r = buildShiftReport([
    check({
      total: 1000,
      paid: 1350,
      overpaid: 0,
      refunded: 350,
      cancelledTotal: 350,
      payments: [{ amount: 1350, method: 'sbp', at: h(12) }]
    })
  ])
  assert.equal(r.revenue, 1350)
  assert.equal(r.refunds, 350)
  assert.equal(r.netRevenue, 1000)
  assert.equal(r.writtenOff, 350)
})

test('чаевые — по официантам, мимо выручки', () => {
  const r = buildShiftReport([
    check({ waiter: 'Максим', tips: [{ amount: 200, waiter: 'Максим' }] }),
    check({ waiter: 'Лиана', tips: [{ amount: 100, waiter: 'Лиана' }, { amount: 50, waiter: 'Лиана' }] })
  ])
  assert.equal(r.tips, 350)
  assert.deepEqual(r.tipsByWaiter, [
    { name: 'Максим', amount: 200 },
    { name: 'Лиана', amount: 150 }
  ])
  assert.equal(r.revenue, 0, 'чаевые — не выручка ресторана')
})

test('официанты: выручка, столы, чаевые; сортировка по выручке', () => {
  const r = buildShiftReport([
    check({ waiter: 'Лиана', paid: 500, payments: [{ amount: 500, method: 'sbp', at: h(12) }] }),
    check({ waiter: 'Максим', paid: 900, payments: [{ amount: 900, method: 'sbp', at: h(12) }] }),
    check({ waiter: 'Максим', paid: 300, payments: [{ amount: 300, method: 'cash', at: h(12) }] })
  ])
  assert.deepEqual(
    r.waiters.map(w => [w.name, w.revenue, w.tables]),
    [
      ['Максим', 1200, 2],
      ['Лиана', 500, 1]
    ]
  )
})

test('топ и аутсайдеры — по проданным порциям, снятое не считается', () => {
  const r = buildShiftReport([
    check({
      lines: [
        { name: 'Борщ', qty: 3, amount: 1470, cancelled: false },
        { name: 'Стейк', qty: 1, amount: 1290, cancelled: false },
        { name: 'Капучино', qty: 2, amount: 480, cancelled: true }
      ]
    }),
    check({ lines: [{ name: 'Борщ', qty: 1, amount: 490, cancelled: false }] })
  ])
  assert.deepEqual(r.top[0], { name: 'Борщ', qty: 4 })
  assert.equal(r.top.some(x => x.name === 'Капучино'), false)
  assert.deepEqual(r.low.at(-1), { name: 'Борщ', qty: 4 })
})

test('пустая смена — нули, а не NaN', () => {
  const r = buildShiftReport([])
  assert.equal(r.revenue, 0)
  assert.equal(r.avgCheck, 0)
  assert.equal(r.checks, 0)
  assert.equal(r.byHour.length, 0)
})

test('часы по времени заведения и через полночь: 22, 23, 0, а не 0…23', () => {
  const r = buildShiftReport([
    check({ total: 900, paid: 900, payments: [{ amount: 400, method: 'sbp', at: h(22, 30) }, { amount: 500, method: 'sbp', at: h(24, 20) }] })
  ])
  assert.deepEqual(
    r.byHour.map(x => x.hour),
    [22, 23, 0]
  )
  assert.equal(r.byHour[2].amount, 500)
})
