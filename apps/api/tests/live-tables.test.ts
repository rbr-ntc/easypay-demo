import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Дыры с живых столов: официанту нечем было ответить на вызов, повар не
 * отличал второй заказ от двойного нажатия, а оценка визита никуда не уходила.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'live-tables-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'live-tables-master'
let seq = 0
const fresh = () => `lt${Date.now().toString(36)}${seq++}`

function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const snapshot = (table: string, guest: string) => fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': guest } }).then(r => r.json())

async function join(table: string, name: string) {
  const body = await (await post(`/api/t/${table}/join`, { name, animal: 'fox', idemKey: fresh() })).json()
  return body.guestToken as string
}

test('ответ официанта на вызов доходит до гостя', async () => {
  const table = fresh()
  const g = await join(table, 'Настя')
  const { callId } = await (await post(`/api/t/${table}/call`, { reason: 'help' }, { guest: g })).json()
  const r = await post(`/api/t/${table}/ack`, { callId, reply: 'Пицца будет через 3 минуты' }, { staff: M })
  assert.equal(r.status, 200)
  const snap = await snapshot(table, g)
  assert.equal(snap.calls.length, 0)
  assert.equal(snap.acked.at(-1).reply, 'Пицца будет через 3 минуты')
})

test('вызов без ответа — «идёт», reply пустой', async () => {
  const table = fresh()
  const g = await join(table, 'Настя')
  const { callId } = await (await post(`/api/t/${table}/call`, { reason: 'help' }, { guest: g })).json()
  await post(`/api/t/${table}/ack`, { callId }, { staff: M })
  assert.equal((await snapshot(table, g)).acked.at(-1).reply, null)
})

test('повар видит повтор: тот же гость, то же блюдо, второй отправкой', async () => {
  const table = fresh()
  const g = await join(table, 'Макс')
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: g })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
  await new Promise(r => setTimeout(r, 5))
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: g })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })

  const k = await fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  const mine = k.tickets.filter((t: any) => t.tableId === table && t.dishId === 'espresso')
  assert.equal(mine.length, 2)
  assert.deepEqual(mine.map((t: any) => t.repeat).sort(), [false, true])
})

test('оценка визита сохраняется, одна на гостя, чужое значение — 400', async () => {
  const table = fresh()
  const g = await join(table, 'Настя')
  assert.equal((await post(`/api/t/${table}/rate`, { rating: 'great' }, { guest: g })).status, 400)
  assert.equal((await post(`/api/t/${table}/rate`, { rating: 'ok' }, { guest: g })).status, 200)
  assert.equal((await post(`/api/t/${table}/rate`, { rating: 'bad', note: 'долго несли суп' }, { guest: g })).status, 200)
  const snap = await snapshot(table, g)
  assert.equal(snap.rated.length, 1, 'одна оценка на гостя')
  assert.equal(snap.ratings, undefined, 'оценка и замечание — управляющей, не соседям по столу')
})

test('гость оценил и ушёл из-за стола — уход проходит, оценка уходит с ним', async () => {
  const table = fresh()
  await join(table, 'Макс')
  const g = await join(table, 'Настя')
  await post(`/api/t/${table}/rate`, { rating: 'good' }, { guest: g })
  assert.equal((await post(`/api/t/${table}/leave`, {}, { guest: g })).status, 200)
})

test('оценка без токена гостя — отказ', async () => {
  const table = fresh()
  await join(table, 'Настя')
  assert.equal((await post(`/api/t/${table}/rate`, { rating: 'good' })).status, 401)
})
