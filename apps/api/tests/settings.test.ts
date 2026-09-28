import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Настройки заведения. Каждая настройка обязана что-то менять: выключенный
 * способ оплаты сервер не примет, даже если старый экран гостя его покажет.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'settings-test-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'settings-test-master'
let seq = 0
const fresh = () => `se${Date.now().toString(36)}${seq++}`

function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const get = (path: string) => fetch(`${base}${path}`, { headers: { 'x-staff-token': M } }).then(r => r.json())

/** Стол на двоих с поданным блюдом у каждого. */
async function tableForTwo() {
  const table = fresh()
  const guests: string[] = []
  for (const name of ['Аня', 'Боря']) {
    const j = await (await post(`/api/t/${table}/join`, { name, animal: 'fox', idemKey: `${table}${name}` })).json()
    guests.push(j.guestToken)
    await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: j.guestToken })
    await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: j.guestToken })
  }
  return { table, guests }
}

test('настройки читает каждый: гостю нужны способы оплаты и реквизиты', async () => {
  const res = await fetch(`${base}/api/settings`)
  assert.equal(res.status, 200)
  const { settings } = await res.json()
  assert.ok(settings.venue.name, 'название — из плана зала')
  assert.equal(settings.pay.sbp, true)
})

test('менять — только менеджер; без способа оплаты не сохранить', async () => {
  const cook = await (await post('/api/staff/login', { pin: '4444' })).json()
  assert.equal((await post('/api/settings', { settings: {} }, { staff: cook.token })).status, 403)
  const bad = await post('/api/settings', { settings: { pay: { sbp: false, card: false, cash: false } } }, { staff: M })
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error, 'no payment method')
})

test('выключенные карта, делёж и чаевые сервер не принимает', async () => {
  const before = (await get('/api/settings')).version
  const { table, guests } = await tableForTwo()

  const saved = await post('/api/settings', { settings: { pay: { card: false, split: false, tips: false } } }, { staff: M })
  assert.equal(saved.status, 200)
  const snap = await get(`/api/t/${table}`)
  assert.notEqual(snap.settingsVersion, before, 'снимок несёт новую версию — экран гостя перестроится')

  const card = await post(`/api/t/${table}/pay`, { scope: 'full', method: 'card', idemKey: fresh() }, { guest: guests[0] })
  assert.equal(card.status, 409)
  assert.equal((await card.json()).error, 'method disabled')

  const own = await post(`/api/t/${table}/pay`, { scope: 'own', method: 'sbp', idemKey: fresh() }, { guest: guests[0] })
  assert.equal(own.status, 409)
  assert.equal((await own.json()).error, 'split disabled')

  const full = await post(`/api/t/${table}/pay`, { scope: 'full', method: 'sbp', idemKey: fresh() }, { guest: guests[0] })
  assert.equal(full.status, 200, 'весь стол по СБП — можно')

  const tip = await post(`/api/t/${table}/tip`, { amount: 100, idemKey: fresh() }, { guest: guests[0] })
  assert.equal(tip.status, 409)
  assert.equal((await tip.json()).error, 'tips disabled')

  await post('/api/settings', { settings: { pay: { card: true, split: true, tips: true } } }, { staff: M })
})

test('правило «нельзя закрыть смену с долгом» можно выключить', async () => {
  const table = fresh()
  const j = await (await post(`/api/t/${table}/join`, { name: 'Вера', animal: 'owl', idemKey: table })).json()
  await post(`/api/t/${table}/lines`, { dishId: 'borsch' }, { guest: j.guestToken })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: j.guestToken })
  const s = await get(`/api/t/${table}`)
  // Подано и не оплачено — это долг; неподанное при закрытии снялось бы с кухни
  const uid = s.lines[0].uid
  await post(`/api/t/${table}/start`, { uid, sessionId: s.sessionId }, { staff: M })
  await post(`/api/t/${table}/serve`, { uid, sessionId: s.sessionId }, { staff: M })
  await post(`/api/t/${table}/close`, { force: true, sessionId: s.sessionId }, { staff: M })

  const state = await get('/api/shift')
  const blocked = await post('/api/shift/close', { cashCounted: state.cash.system }, { staff: M })
  assert.equal(blocked.status, 409)

  await post('/api/settings', { settings: { shift: { debtBlocksClose: false } } }, { staff: M })
  const ok = await post('/api/shift/close', { cashCounted: state.cash.system }, { staff: M })
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.ok(body.z.report.debt >= 490, 'долг не пропал — он в Z-отчёте')
})
