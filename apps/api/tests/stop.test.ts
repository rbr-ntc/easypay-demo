import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Стоп-лист в один тап. Раньше «закончилось» было флагом в menu.json: снять
 * блюдо можно было только правкой файла и деплоем, а гость до этого успевал
 * заказать то, чего на кухне уже нет.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'stop-test-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const MASTER = 'stop-test-master'
let seq = 0
const freshTable = () => `st${Date.now().toString(36)}${seq++}`

function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function guestAt(table: string) {
  const joined = await (await post(`/api/t/${table}/join`, { name: 'Аня', animal: 'fox', idemKey: table })).json()
  return joined.guestToken as string
}

async function login(pin: string) {
  const res = await post('/api/staff/login', { pin })
  return res.ok ? ((await res.json()) as { token: string }).token : null
}

test('повар выключает блюдо — гость его уже не закажет и видит это в снимке', async () => {
  const cook = await login('4444')
  assert.ok(cook, 'повар входит по PIN')

  const off = await post('/api/menu/stop', { dishId: 'borsch', stop: true }, { staff: cook! })
  assert.equal(off.status, 200)

  const table = freshTable()
  const guest = await guestAt(table)
  const order = await post(`/api/t/${table}/lines`, { dishId: 'borsch' }, { guest })
  assert.equal(order.status, 400)
  assert.equal((await order.json()).error, 'dish in stop list')

  const snap = await (await fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': guest } })).json()
  assert.ok(snap.stop.includes('borsch'), 'стоп-лист приходит гостю в снимке стола')

  const on = await post('/api/menu/stop', { dishId: 'borsch', stop: false }, { staff: cook! })
  assert.equal(on.status, 200)
  const again = await post(`/api/t/${table}/lines`, { dishId: 'borsch' }, { guest })
  assert.equal(again.status, 200, 'вернули в меню — заказ снова принимается')
})

test('блюдо, остановленное в меню, можно вернуть из стоп-листа', async () => {
  // В menu.json стейк стоит со stop: true — переопределение сильнее файла
  const on = await post('/api/menu/stop', { dishId: 'steak', stop: false }, { staff: MASTER })
  assert.equal(on.status, 200)
  const table = freshTable()
  const guest = await guestAt(table)
  const order = await post(`/api/t/${table}/lines`, { dishId: 'steak', options: {} }, { guest })
  assert.equal(order.status, 200)
  await post('/api/menu/stop', { dishId: 'steak', stop: true }, { staff: MASTER })
})

test('без смены стоп-лист не трогается, чужое блюдо — 400', async () => {
  const anon = await post('/api/menu/stop', { dishId: 'borsch', stop: true })
  assert.equal(anon.status, 401)

  const unknown = await post('/api/menu/stop', { dishId: 'nope', stop: true }, { staff: MASTER })
  assert.equal(unknown.status, 400)

  const bad = await post('/api/menu/stop', { dishId: 'borsch', stop: 'yes' }, { staff: MASTER })
  assert.equal(bad.status, 400)
})

test('меню отдаёт стоп-лист с учётом переопределений, а журнал помнит, кто выключил', async () => {
  await post('/api/menu/stop', { dishId: 'napoleon', stop: true }, { staff: MASTER })
  const menu = await (await fetch(`${base}/api/menu`)).json()
  assert.equal(menu.dishes.find((d: any) => d.id === 'napoleon').stop, true)

  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': MASTER } })).json()
  assert.ok(
    log.entries.some((e: any) => e.action === 'стоп-лист' && String(e.detail).includes('Наполеон')),
    'выключение блюда — в журнале смены'
  )
  await post('/api/menu/stop', { dishId: 'napoleon', stop: false }, { staff: MASTER })
})
