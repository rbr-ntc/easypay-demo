import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

process.env.EASYPAY_MANAGER_TOKEN = 'test-manager-token'
const { createServer } = await import('../server/index.mjs')

const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const TOKEN = 'test-manager-token'
let seq = 0
const freshTable = () => `t${Date.now().toString(36)}${seq++}`

function post(table, action, body = {}, token) {
  return fetch(`${base}/api/t/${table}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-manager-token': token } : {}) },
    body: JSON.stringify(body)
  })
}

const snapshot = table => fetch(`${base}/api/t/${table}`).then(r => r.json())

async function joinGuest(table, name = 'Аня', animal = 'fox') {
  const res = await post(table, 'join', { name, animal, idemKey: `${table}-${name}` })
  assert.equal(res.status, 200)
  const { personaId } = await res.json()
  return personaId
}

test('join открывает сессию стола и заводит персону', async () => {
  const table = freshTable()
  const before = await snapshot(table)
  assert.equal(before.status, 'closed')

  const personaId = await joinGuest(table)
  const after = await snapshot(table)
  assert.equal(after.status, 'open')
  assert.equal(after.personas.length, 1)
  assert.equal(after.personas[0].id, personaId)
  assert.equal(after.personas[0].name, 'Аня')
})

test('имя чистится от тегов и режется по длине', async () => {
  const table = freshTable()
  await post(table, 'join', { name: `<b>${'я'.repeat(60)}</b>`, animal: 'bear', idemKey: 'k' })
  const snap = await snapshot(table)
  assert.equal(snap.personas[0].name.includes('<'), false)
  assert.equal(snap.personas[0].name.length <= 30, true)
})

test('повтор join с тем же ключом не создаёт вторую персону', async () => {
  const table = freshTable()
  const first = await post(table, 'join', { name: 'Дима', animal: 'bear', idemKey: 'same-key' })
  const second = await post(table, 'join', { name: 'Дима', animal: 'bear', idemKey: 'same-key' })
  const a = await first.json()
  const b = await second.json()
  assert.equal(a.personaId, b.personaId)
  const snap = await snapshot(table)
  assert.equal(snap.personas.length, 1)
})

test('позицию добавляет только известный гость и только существующее блюдо', async () => {
  const table = freshTable()
  const personaId = await joinGuest(table)

  const stranger = await post(table, 'lines', { personaId: 'no-such-persona', dishId: 'tomyam', qty: 1 })
  assert.equal(stranger.status, 403)

  const badDish = await post(table, 'lines', { personaId, dishId: 'ghost', qty: 1 })
  assert.equal(badDish.status, 400)

  const stopList = await post(table, 'lines', { personaId, dishId: 'duck', qty: 1 })
  assert.equal(stopList.status, 400, 'блюдо в стоп-листе')

  const ok = await post(table, 'lines', { personaId, dishId: 'tomyam', qty: 99 })
  assert.equal(ok.status, 200)
  const snap = await snapshot(table)
  assert.equal(snap.lines.length, 1)
  assert.equal(snap.lines[0].qty, 9, 'количество ограничено девятью')
})

test('чужую позицию удалить нельзя, отправленную — тоже', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })
  const uid = (await snapshot(table)).lines[0].uid

  assert.equal((await post(table, 'remove', { personaId: dima, uid })).status, 403)
  assert.equal((await post(table, 'remove', { personaId: anya, uid })).status, 200)

  await post(table, 'lines', { personaId: anya, dishId: 'padthai', qty: 1 })
  const uid2 = (await snapshot(table)).lines[0].uid
  await post(table, 'send', { personaId: anya, scope: 'mine' })
  assert.equal((await post(table, 'remove', { personaId: anya, uid: uid2 })).status, 400, 'отправленное на кухню заблокировано')
})

test('send scope=mine отправляет только своё, all — всё', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })
  await post(table, 'lines', { personaId: dima, dishId: 'padthai', qty: 1 })

  await post(table, 'send', { personaId: anya, scope: 'mine' })
  let snap = await snapshot(table)
  assert.deepEqual(snap.lines.map(l => l.sent), [true, false])

  await post(table, 'send', { personaId: anya, scope: 'all' })
  snap = await snapshot(table)
  assert.deepEqual(snap.lines.map(l => l.sent), [true, true])
})

test('сумму платежа считает сервер, а не клиент', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 }) // 690

  const res = await post(table, 'pay', { personaId: anya, scope: 'own', amount: 1, idemKey: 'pay-1' })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.amount, 690, 'клиентское amount игнорируется')

  const snap = await snapshot(table)
  assert.equal(snap.payments.length, 1)
  assert.equal(snap.payments[0].amount, 690)
})

test('повтор оплаты с тем же ключом не списывает дважды', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'steak', qty: 1 })

  const first = await (await post(table, 'pay', { personaId: anya, scope: 'own', idemKey: 'retry' })).json()
  const second = await (await post(table, 'pay', { personaId: anya, scope: 'own', idemKey: 'retry' })).json()
  assert.equal(first.amount, second.amount)

  const snap = await snapshot(table)
  assert.equal(snap.payments.length, 1, 'платёж один')
})

test('оплачивать нечего — 400, и стол не уходит в минус', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })

  await post(table, 'pay', { personaId: anya, scope: 'full', idemKey: 'p1' })
  const second = await post(table, 'pay', { personaId: dima, scope: 'full', idemKey: 'p2' })
  assert.equal(second.status, 400)

  const snap = await snapshot(table)
  assert.equal(snap.payments.reduce((s, p) => s + p.amount, 0), 690)
})

test('serve/close/reset требуют токен менеджера', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })
  await post(table, 'send', { personaId: anya, scope: 'mine' })
  const uid = (await snapshot(table)).lines[0].uid

  assert.equal((await post(table, 'serve', { uid })).status, 401)
  assert.equal((await post(table, 'close', {})).status, 401)
  assert.equal((await post(table, 'reset', {})).status, 401)
  assert.equal((await post(table, 'serve', { uid }, 'wrong-token')).status, 401)

  assert.equal((await post(table, 'serve', { uid }, TOKEN)).status, 200)
  assert.equal((await snapshot(table)).lines[0].served, true)
})

test('/api/manager/check подтверждает токен', async () => {
  assert.equal((await fetch(`${base}/api/manager/check`)).status, 401)
  assert.equal((await fetch(`${base}/api/manager/check`, { headers: { 'x-manager-token': 'nope' } })).status, 401)
  assert.equal((await fetch(`${base}/api/manager/check`, { headers: { 'x-manager-token': TOKEN } })).status, 200)
})

test('закрытый стол не принимает заказы, а новый join открывает новую сессию', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })
  const opened = await snapshot(table)

  assert.equal((await post(table, 'close', {}, TOKEN)).status, 200)
  const closed = await snapshot(table)
  assert.equal(closed.status, 'closed')
  assert.equal((await post(table, 'lines', { personaId: anya, dishId: 'padthai', qty: 1 })).status, 409)

  const lena = await joinGuest(table, 'Лена', 'panda')
  const reopened = await snapshot(table)
  assert.equal(reopened.status, 'open')
  assert.notEqual(reopened.sessionId, opened.sessionId, 'сессия новая')
  assert.equal(reopened.lines.length, 0, 'стол чистый')
  assert.equal(reopened.personas.length, 1)
  assert.equal(reopened.personas[0].id, lena)
})

test('reset стирает стол', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })
  assert.equal((await post(table, 'reset', {}, TOKEN)).status, 200)
  const snap = await snapshot(table)
  assert.equal(snap.status, 'closed')
  assert.equal(snap.personas.length, 0)
  assert.equal(snap.lines.length, 0)
})

test('кривой id стола и битый JSON отбиваются', async () => {
  assert.equal((await fetch(`${base}/api/t/..%2Fetc/`)).status, 404)
  const res = await fetch(`${base}/api/t/ok1/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json'
  })
  assert.equal(res.status, 400)
})

test('SSE отдаёт снапшот сразу после подключения', async () => {
  const table = freshTable()
  await joinGuest(table, 'Аня', 'fox')
  const chunk = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/t/${table}/stream`, res => {
      res.setEncoding('utf8')
      res.once('data', data => {
        req.destroy()
        resolve(data)
      })
    })
    req.on('error', reject)
  })
  assert.match(chunk, /^data: /)
  const snap = JSON.parse(chunk.replace(/^data: /, ''))
  assert.equal(snap.personas[0].name, 'Аня')
})
