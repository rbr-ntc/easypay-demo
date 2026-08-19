import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KITCHEN_THRESHOLDS,
  sortTickets,
  summarizeKitchen,
  ticketState,
  ticketUrgency,
  ticketWait
} from '../kitchen.js'

const NOW = 1_700_000_000_000
const min = m => m * 60_000

const ticket = (over = {}) => ({
  tableId: '12',
  zoneName: 'Терраса',
  uid: 1,
  dishId: 'tomyam',
  qty: 1,
  options: {},
  shared: false,
  guest: 'Аня',
  animal: 'fox',
  sentAt: NOW - min(2),
  startedAt: null,
  ...over
})

test('позиция в очереди и в работе различаются по startedAt', () => {
  assert.equal(ticketState(ticket()), 'queued')
  assert.equal(ticketState(ticket({ startedAt: NOW - min(1) })), 'cooking')
})

test('ожидание считается от отправки на кухню, а не от взятия в работу', () => {
  const t = ticket({ sentAt: NOW - min(7), startedAt: NOW - min(1) })
  assert.equal(ticketWait(t, NOW), min(7))
  assert.equal(ticketWait(ticket({ sentAt: null }), NOW), 0)
})

test('срочность растёт по порогам', () => {
  assert.equal(ticketUrgency(ticket({ sentAt: NOW - min(3) }), NOW), 'ok')
  assert.equal(ticketUrgency(ticket({ sentAt: NOW - KITCHEN_THRESHOLDS.warnMs }), NOW), 'warn')
  assert.equal(ticketUrgency(ticket({ sentAt: NOW - KITCHEN_THRESHOLDS.dangerMs }), NOW), 'danger')
})

test('очередь сортируется от самого старого', () => {
  const list = [
    ticket({ uid: 1, sentAt: NOW - min(2) }),
    ticket({ uid: 2, sentAt: NOW - min(9) }),
    ticket({ uid: 3, sentAt: NOW - min(5) })
  ]
  assert.deepEqual(sortTickets(list).map(t => t.uid), [2, 3, 1])
  assert.deepEqual(list.map(t => t.uid), [1, 2, 3], 'исходный список не мутируется')
})

test('сводка кухни считает очередь, работу, столы и просрочку', () => {
  const list = [
    ticket({ uid: 1, tableId: '12', qty: 2 }),
    ticket({ uid: 2, tableId: '12', startedAt: NOW - min(1) }),
    ticket({ uid: 3, tableId: '3', sentAt: NOW - min(25) })
  ]
  const s = summarizeKitchen(list, NOW)
  assert.equal(s.queued, 2)
  assert.equal(s.cooking, 1)
  assert.equal(s.positions, 4)
  assert.equal(s.tables, 2)
  assert.equal(s.oldestWaitMs, min(25))
  assert.equal(s.overdue, 1)
})

test('пустая кухня не ломает сводку', () => {
  const s = summarizeKitchen([], NOW)
  assert.equal(s.queued, 0)
  assert.equal(s.oldestWaitMs, null)
})
