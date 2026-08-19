import test from 'node:test'
import assert from 'node:assert/strict'
import { describeTable, summarizeHall, tableStatus, THRESHOLDS } from '../src/hall.ts'

const NOW = 1_700_000_000_000
const min = m => m * 60_000

const card = (over = {}) => ({
  id: '1',
  zoneId: 'main',
  zoneName: 'Основной зал',
  seats: 4,
  status: 'open',
  openedAt: NOW - min(1),
  closedAt: null,
  guests: 2,
  personas: [{ name: 'Аня', animal: 'fox' }, { name: 'Дима', animal: 'bear' }],
  tableTotal: 0,
  paidTotal: 0,
  remaining: 0,
  sentCount: 0,
  kitchenPending: 0,
  oldestPendingSentAt: null,
  lastSentAt: null,
  lastServedAt: null,
  lastPaidAt: null,
  ...over
})

test('свободный стол и «убрать стол» различаются по времени закрытия', () => {
  assert.equal(tableStatus(card({ status: 'closed', closedAt: null }), NOW), 'free')
  assert.equal(tableStatus(card({ status: 'closed', closedAt: NOW - min(1) }), NOW), 'dirty')
  assert.equal(tableStatus(card({ status: 'closed', closedAt: NOW - min(30) }), NOW), 'free')
})

test('статусы открытого стола идут по ходу обслуживания', () => {
  assert.equal(tableStatus(card(), NOW), 'seated')
  assert.equal(
    tableStatus(card({ sentCount: 2, kitchenPending: 2, tableTotal: 1290, remaining: 1290 }), NOW),
    'cooking'
  )
  assert.equal(tableStatus(card({ sentCount: 2, kitchenPending: 0, tableTotal: 1290, remaining: 1290 }), NOW), 'served')
  assert.equal(
    tableStatus(card({ sentCount: 2, tableTotal: 1290, paidTotal: 600, remaining: 690 }), NOW),
    'paying'
  )
  assert.equal(tableStatus(card({ sentCount: 2, tableTotal: 1290, paidTotal: 1290, remaining: 0 }), NOW), 'paid')
})

test('сели и не заказали дольше порога — алерт', () => {
  const fresh = describeTable(card({ openedAt: NOW - min(3) }), NOW)
  assert.deepEqual(fresh.alerts, [])

  const late = describeTable(card({ openedAt: NOW - THRESHOLDS.noOrderMs - 1000 }), NOW)
  assert.equal(late.alerts.some(a => a.id === 'no-order'), true)
})

test('кухня задерживает и стол ждёт оплаты', () => {
  const slow = describeTable(
    card({ sentCount: 1, kitchenPending: 1, oldestPendingSentAt: NOW - THRESHOLDS.kitchenSlowMs - 1000 }),
    NOW
  )
  assert.equal(slow.alerts.some(a => a.id === 'kitchen-slow' && a.severity === 'danger'), true)

  const waiting = describeTable(
    card({
      sentCount: 1,
      tableTotal: 690,
      remaining: 690,
      lastServedAt: NOW - THRESHOLDS.awaitingPaymentMs - 1000
    }),
    NOW
  )
  assert.equal(waiting.alerts.some(a => a.id === 'awaiting-payment'), true)
})

test('полностью оплаченный стол просит закрытия', () => {
  const paid = describeTable(card({ sentCount: 1, tableTotal: 690, paidTotal: 690, remaining: 0 }), NOW)
  assert.equal(paid.status, 'paid')
  assert.deepEqual(paid.alerts.map(a => a.id), ['ready-to-close'])
})

test('таймер статуса отсчитывается от нужного события', () => {
  const cooking = card({ sentCount: 1, kitchenPending: 1, oldestPendingSentAt: NOW - min(5) })
  assert.equal(describeTable(cooking, NOW).since, NOW - min(5))

  const served = card({ sentCount: 1, tableTotal: 690, remaining: 690, lastServedAt: NOW - min(2) })
  assert.equal(describeTable(served, NOW).since, NOW - min(2))
})

test('сводка зала считает занятость, деньги и внимание', () => {
  const cards = [
    card({ id: '1', tableTotal: 1290, remaining: 1290, sentCount: 1, kitchenPending: 1 }),
    card({ id: '2', status: 'closed', closedAt: NOW - min(40), guests: 0, personas: [] }),
    card({ id: '3', openedAt: NOW - THRESHOLDS.noOrderMs - 1000 }),
    card({ id: '4', tableTotal: 800, paidTotal: 800, remaining: 0, sentCount: 1 })
  ]
  const s = summarizeHall(cards, { tables: 2, revenue: 3000, guests: 5 }, NOW)

  assert.equal(s.tables, 4)
  assert.equal(s.occupied, 3, 'закрытый стол не занят')
  assert.equal(s.guests, 6)
  assert.equal(s.openBalance, 1290)
  assert.equal(s.kitchenPending, 1)
  assert.equal(s.attention, 1, 'только стол №3 просрочил заказ')
  assert.equal(s.shiftRevenue, 3800, 'смена + уже оплаченное на открытых столах')
  assert.equal(s.avgCheck, 1500)
})

test('пустой зал не ломает сводку', () => {
  const s = summarizeHall([], null, NOW)
  assert.equal(s.occupied, 0)
  assert.equal(s.avgCheck, null)
  assert.equal(s.shiftRevenue, 0)
})
