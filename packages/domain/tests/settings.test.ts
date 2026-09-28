import test from 'node:test'
import assert from 'node:assert/strict'
import { applySettings, checkSettings, DEFAULT_SETTINGS, tipPresets } from '../src/settings.ts'
import { tableAlerts } from '../src/hall.ts'
import { ticketUrgency } from '../src/kitchen.ts'
import { hourOf } from '../src/shift.ts'

const NOW = 1_700_000_000_000
const min = (m: number) => m * 60_000
const base = { ...DEFAULT_SETTINGS, venue: { ...DEFAULT_SETTINGS.venue, name: 'Времена года' } }

const card = (over = {}) =>
  ({
    id: '1',
    zoneId: 'main',
    zoneName: 'Зал',
    seats: 4,
    status: 'open',
    openedAt: NOW - min(9),
    closedAt: null,
    guests: 1,
    personas: [],
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
  }) as any

test('числа зажимаются в разумные границы, чужие поля отбрасываются', () => {
  const { settings, errors } = checkSettings({ alerts: { noOrderMin: 0, kitchenMin: 999, evil: 1 }, hack: true }, base)
  assert.deepEqual(errors, [])
  assert.equal(settings.alerts.noOrderMin, 2, 'порог «0 минут» покрасил бы весь зал')
  assert.equal(settings.alerts.kitchenMin, 120)
  assert.equal((settings as any).hack, undefined)
})

test('без способа оплаты и с кривым ИНН — ошибка, а не молчаливая правка', () => {
  const noPay = checkSettings({ pay: { sbp: false, card: false, cash: false } }, base)
  assert.ok(noPay.errors.includes('no payment method'))
  const inn = checkSettings({ venue: { inn: '12345' } }, base)
  assert.ok(inn.errors.includes('bad inn'))
  assert.deepEqual(checkSettings({ venue: { inn: '7703 456 789' } }, base).errors, [])
})

test('пороги из настроек красят зал и кухню', () => {
  const seated = card()
  applySettings(checkSettings({ alerts: { noOrderMin: 10 } }, base).settings)
  assert.equal(tableAlerts(seated, NOW).some(a => a.id === 'no-order'), false, '9 минут < 10')
  applySettings(checkSettings({ alerts: { noOrderMin: 5, kitchenMin: 30 } }, base).settings)
  assert.equal(tableAlerts(seated, NOW).some(a => a.id === 'no-order'), true)

  const ticket = { sentAt: NOW - min(20), station: 'kitchen' } as any
  assert.equal(ticketUrgency(ticket, NOW), 'warn', 'половина порога — жёлтый')
  applySettings(base)
  assert.equal(ticketUrgency(ticket, NOW), 'danger', 'по умолчанию 20 минут — уже красный')
})

test('вызов без ответа дольше порога — видно, сколько ждут', () => {
  applySettings(base)
  const calling = card({ call: { name: 'Аня', reason: 'help', at: NOW - min(4) } })
  assert.match(tableAlerts(calling, NOW)[0].label, /ждёт 4 мин/)
  applySettings(checkSettings({ alerts: { callMin: 10 } }, base).settings)
  assert.doesNotMatch(tableAlerts(calling, NOW)[0].label, /ждёт/)
  applySettings(base)
})

test('пояс заведения сдвигает часы отчёта', () => {
  const at = Date.UTC(2026, 8, 24, 17, 30) // 20:30 в Москве, 22:30 в Екатеринбурге
  applySettings(base)
  assert.equal(hourOf(at), 20)
  applySettings(checkSettings({ venue: { tz: 'Asia/Yekaterinburg' } }, base).settings)
  assert.equal(hourOf(at), 22)
  applySettings(base)
})

test('чаевые процентом — от оплаченного, круглыми десятками', () => {
  assert.deepEqual(
    tipPresets('pct', 2340).map(t => t.amount),
    [0, 120, 230, 350]
  )
  assert.deepEqual(
    tipPresets('rub', 2340).map(t => t.amount),
    [0, 100, 200, 300]
  )
})
