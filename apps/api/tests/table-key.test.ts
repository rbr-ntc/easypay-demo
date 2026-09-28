import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Секрет стола в QR (смена №6, Б4): по номеру стола в ссылке сесть нельзя —
 * только с подписью из QR на столе. Уже сидящие работают по своему токену.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'qr-master'
process.env.EASYPAY_QR_SECRET = 'test-qr-secret'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`
test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'qr-master'
const join = (table: string, tableKey?: string) =>
  fetch(`${base}/api/t/${table}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Гость', animal: 'fox', idemKey: `k${Math.random()}`, ...(tableKey ? { tableKey } : {}) })
  })

test('без подписи из QR за стол не сесть', async () => {
  const r = await join('6')
  assert.equal(r.status, 403)
  assert.equal((await r.json()).error, 'table key required')
})

test('подписи — только персоналу; с подписью своего стола садишься, чужого — нет', async () => {
  assert.equal((await fetch(`${base}/api/qr`)).status, 401)
  const qr = await (await fetch(`${base}/api/qr`, { headers: { 'x-staff-token': M } })).json()
  assert.equal(qr.required, true)
  assert.equal(qr.keys['6'].length, 12)
  assert.notEqual(qr.keys['6'], qr.keys['5'])
  assert.equal((await join('6', qr.keys['5'])).status, 403, 'подпись соседнего стола не подходит')
  assert.equal((await join('6', qr.keys['6'])).status, 200)
})

test('кривая подпись — 403, а не 500: не-латиница, правильная длина, но не та', async () => {
  assert.equal((await join('6', 'ёёёёёёёёёёёё')).status, 403)
  assert.equal((await join('6', 'AAAAAAAAAAAA')).status, 403)
})

test('повтор чужого idemKey без подписи не получает чужую посадку', async () => {
  const qr = await (await fetch(`${base}/api/qr`, { headers: { 'x-staff-token': M } })).json()
  const idemKey = `same-${Math.random()}`
  const body = (tableKey?: string) => JSON.stringify({ name: 'Гость', animal: 'fox', idemKey, ...(tableKey ? { tableKey } : {}) })
  const ok = await fetch(`${base}/api/t/5/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(qr.keys['5']) })
  assert.equal(ok.status, 200)
  const stolen = await fetch(`${base}/api/t/5/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body() })
  assert.equal(stolen.status, 403)
})

test('подписи получает зал, но не повар; гостю виден только факт «нужна подпись»', async () => {
  assert.equal((await (await fetch(`${base}/api/qr/required`)).json()).required, true)
  const stub = await (await fetch(`${base}/api/t/4`)).json()
  assert.equal(stub.keyRequired, true)
  assert.equal(JSON.stringify(stub).includes((await (await fetch(`${base}/api/qr`, { headers: { 'x-staff-token': M } })).json()).keys['4']), false)
})
