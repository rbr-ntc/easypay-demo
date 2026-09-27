import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore } from '../src/store/memory.ts'
import { dropSession, forgetSessionsInMemory, loginByPin, restoreSessions, sessionStaff, takeSessionEvents } from '../src/staff.ts'

/**
 * Сессии персонала переживают рестарт сервера. Раньше они жили только в
 * памяти, и каждая выкладка выкидывала из смены весь персонал — на живом
 * столе повар посреди готовки получил «войдите заново».
 */

test('вход пишется в базу; после рестарта сессия поднимается, после выхода — нет', async () => {
  const store = createMemoryStore()
  const cook = loginByPin('4444', '10.0.0.1', 'kitchen-1')!
  const waiter = loginByPin('2222', '10.0.0.1', 'phone-olya')!
  await store.applySessionEvents(takeSessionEvents())

  dropSession(waiter.token)
  await store.applySessionEvents(takeSessionEvents())

  // «Рестарт»: память пуста, база на месте
  forgetSessionsInMemory()
  assert.equal(sessionStaff(cook.token), null)
  restoreSessions(await store.staffSessions())

  const back = sessionStaff(cook.token)
  assert.equal(back?.name, 'Шеф Артём', 'повар остался в смене')
  assert.equal(back?.device, 'kitchen-1')
  assert.equal(sessionStaff(waiter.token), null, 'вышедший не воскресает')

  // Сам токен в базе не хранится — только его хеш
  const rows = await store.staffSessions()
  assert.ok(rows.every(r => r.tokenHash !== cook.token && r.tokenHash.length === 64))
})
