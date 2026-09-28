import test from 'node:test'
import assert from 'node:assert/strict'
import { isYooKassaIp } from '../src/payments/webhookIps.ts'

test('уведомления — только с адресов ЮKassa, границы подсетей точные', () => {
  for (const ip of ['185.71.76.0', '185.71.76.31', '185.71.77.5', '77.75.153.127', '77.75.154.128', '77.75.154.255', '77.75.156.11', '77.75.156.35', '::ffff:185.71.76.1', '2A02:5180::1']) {
    assert.equal(isYooKassaIp(ip), true, ip)
  }
  for (const ip of ['185.71.76.32', '77.75.153.128', '77.75.154.127', '77.75.156.12', '1.2.3.4', '2a02:518::1', 'unknown', '']) {
    assert.equal(isYooKassaIp(ip), false, ip)
  }
})
