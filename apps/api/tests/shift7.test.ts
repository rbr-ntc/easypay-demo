import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Пачка по смене агентов №7 (docs/prototype/shift-7-findings.md): аллергик у
 * общего блюда, «орехи» и арахис, история оценок, отклик по закрытым столам.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'shift7-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`
test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'shift7-master'
let seq = 0
const fresh = () => `s7${Date.now().toString(36)}${seq++}`
function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const snapshot = (table: string, guest: string) => fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': guest } }).then(r => r.json())
async function join(table: string, name: string, allergies?: string[]) {
  return (await (await post(`/api/t/${table}/join`, { name, animal: 'fox', idemKey: fresh(), ...(allergies ? { allergies } : {}) })).json()).guestToken as string
}

test('аллергик видит, что общий десерт ждёт его решения, и может сказать «я это не ем» (А1, А2)', async () => {
  const table = fresh()
  const marina = await join(table, 'Марина')
  const katya = await join(table, 'Катя')
  await join(table, 'Оля')
  await post(`/api/t/${table}/lines`, { dishId: 'cheesecake', shared: true }, { guest: katya })
  await post(`/api/t/${table}/allergies`, { allergies: ['лактоза'] }, { guest: marina })
  let snap = await snapshot(table, marina)
  const line = snap.lines.find((l: any) => l.dishId === 'cheesecake')
  const marinaId = snap.personas.find((p: any) => p.name === 'Марина').id
  assert.deepEqual(line.awaitingConsent, [marinaId])

  assert.equal((await post(`/api/t/${table}/sharedOptOut`, { uid: line.uid }, { guest: marina })).status, 200)
  const sent = await (await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: katya })).json()
  assert.equal(sent.sent, 1, 'без Марины десерт уходит сразу')
  snap = await snapshot(table, katya)
  const after = snap.lines.find((l: any) => l.dishId === 'cheesecake')
  assert.equal(after.sharedWith.length, 2)
  assert.ok(!after.sharedWith.includes(marinaId), 'Марина не делит и не платит')
})

test('согласие аллергика снимает удержание общего блюда; своё общее — не «не ем», а убрать', async () => {
  const table = fresh()
  const marina = await join(table, 'Марина', ['лактоза'])
  const katya = await join(table, 'Катя')
  await post(`/api/t/${table}/lines`, { dishId: 'cheesecake', shared: true, confirmAllergen: true }, { guest: katya })
  // Катя подтвердила аллерген при заказе — но решать за Марину она не может
  const snap = await snapshot(table, marina)
  const line = snap.lines.find((l: any) => l.dishId === 'cheesecake')
  const marinaId = snap.personas.find((p: any) => p.name === 'Марина').id
  assert.deepEqual(line.awaitingConsent, [marinaId])
  const held = await (await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: katya })).json()
  assert.equal(held.sent, 0)
  assert.equal(held.heldBack[0].reason, 'allergy')
  assert.equal((await post(`/api/t/${table}/sharedOptOut`, { uid: line.uid }, { guest: katya })).status, 409)
  assert.equal((await post(`/api/t/${table}/sharedConsent`, { uid: line.uid }, { guest: marina })).status, 200)
  const sent = await (await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: katya })).json()
  assert.equal(sent.sent, 1)
})

test('«орехи» предупреждают и про арахис (А3)', async () => {
  const table = fresh()
  const g = await join(table, 'Марина', ['орехи'])
  const r = await post(`/api/t/${table}/lines`, { dishId: 'padthai' }, { guest: g })
  assert.equal(r.status, 409)
  assert.ok((await r.json()).allergens.includes('арахис'))
})

test('переоценка не стирает прежнее замечание (Г2)', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await post(`/api/t/${table}/rate`, { rating: 'bad', note: 'хлеб так и не принесли' }, { guest: g })
  await post(`/api/t/${table}/rate`, { rating: 'bad', note: 'карта отменилась криво' }, { guest: g })
  const body = await fetch(`${base}/api/quality?period=today`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  const remark = body.report.remarks.find((r: any) => r.tableId === table)
  assert.equal(remark.note, 'карта отменилась криво')
  assert.deepEqual(remark.history.map((h: any) => h.note), ['хлеб так и не принесли'])
})

test('полный стол — 409 с подсказкой, как получить стул (З3)', async () => {
  const table = '13'
  await post(`/api/t/${table}/reset`, { force: true }, { staff: M })
  await join(table, 'Аня')
  await join(table, 'Дима')
  const r = await post(`/api/t/${table}/join`, { name: 'Лёша', animal: 'fox', idemKey: fresh() })
  assert.equal(r.status, 409)
  assert.match((await r.json()).hint, /стул/)
  await post(`/api/t/${table}/reset`, { force: true }, { staff: M })
})
