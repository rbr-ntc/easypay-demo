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

test('модификаторы блюда сохраняются, чужие значения заменяются дефолтом', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')

  await post(table, 'lines', { personaId: anya, dishId: 'steak', qty: 1, options: { roast: 'Rare' } })
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1, options: { spice: 'ядрёно' } })
  await post(table, 'lines', { personaId: anya, dishId: 'springrolls', qty: 1, options: { spice: 'Остро' } })

  const snap = await snapshot(table)
  assert.equal(snap.lines[0].options.roast, 'Rare')
  assert.equal(snap.lines[0].options.side, 'Овощи гриль', 'незаданная группа берёт дефолт из меню')
  assert.deepEqual(snap.lines[1].options, { spice: 'Средне' }, 'неизвестное значение → дефолт из меню')
  assert.deepEqual(snap.lines[2].options, {}, 'у блюда без модификаторов их не появится')
})

test('чаевые уходят официанту и не попадают в счёт стола', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })
  await post(table, 'pay', { personaId: anya, scope: 'full', idemKey: 'tip-pay' })

  const res = await post(table, 'tip', { personaId: anya, amount: 69, idemKey: 'tip-1' })
  assert.equal(res.status, 200)
  await post(table, 'tip', { personaId: anya, amount: 69, idemKey: 'tip-1' })

  const snap = await snapshot(table)
  assert.equal(snap.tips.length, 1, 'повтор с тем же ключом не удваивает чаевые')
  assert.equal(snap.tips[0].amount, 69)
  assert.equal(snap.payments.reduce((s, p) => s + p.amount, 0), 690, 'счёт стола не изменился')

  assert.equal((await post(table, 'tip', { personaId: anya, amount: -5, idemKey: 'tip-2' })).status, 400)
})

test('гость зовёт официанта, вызов снимает только персонал', async () => {
  const table = '13' // стол из плана зала — проверяем и карточку зала
  const anya = await joinGuest(table, 'Аня', 'fox')

  await post(table, 'call', { personaId: anya, reason: 'bill' })
  const called = await snapshot(table)
  assert.equal(called.call.reason, 'bill')
  assert.equal(called.call.personaId, anya)

  const hall = await (await fetch(`${base}/api/hall`, { headers: { 'x-manager-token': TOKEN } })).json()
  const card = hall.tables.find(t => t.id === table)
  assert.equal(card.call.name, 'Аня')

  assert.equal((await post(table, 'ack', {})).status, 401, 'гость не может снять вызов')
  assert.equal((await post(table, 'ack', {}, TOKEN)).status, 200)
  assert.equal((await snapshot(table)).call, null)
})

test('зал отдаётся только персоналу и содержит план столов', async () => {
  assert.equal((await fetch(`${base}/api/hall`)).status, 401)

  const res = await fetch(`${base}/api/hall`, { headers: { 'x-manager-token': TOKEN } })
  assert.equal(res.status, 200)
  const hall = await res.json()
  assert.equal(hall.restaurant.length > 0, true)
  assert.equal(hall.zones.length >= 2, true)
  assert.equal(hall.tables.length >= 12, true)
  const t12 = hall.tables.find(t => t.id === '12')
  assert.equal(t12.zoneName, 'Терраса')
  assert.equal(t12.seats > 0, true)
})

test('гость за столом из плана виден в зале, закрытие уходит в смену', async () => {
  const table = '22' // из hall.json, отдельный от остальных тестов
  const hallOf = async () => {
    const r = await fetch(`${base}/api/hall`, { headers: { 'x-manager-token': TOKEN } })
    const body = await r.json()
    return { card: body.tables.find(t => t.id === table), shift: body.shift, summary: body.summary }
  }

  const before = await hallOf()
  assert.equal(before.card.status, 'closed')
  assert.equal(before.card.guests, 0)

  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 1 })
  await post(table, 'send', { personaId: anya, scope: 'mine' })

  const seated = await hallOf()
  assert.equal(seated.card.status, 'open')
  assert.equal(seated.card.guests, 1)
  assert.equal(seated.card.personas[0].name, 'Аня')
  assert.equal(seated.card.tableTotal, 690)
  assert.equal(seated.card.kitchenPending, 1)
  assert.equal(seated.card.oldestPendingSentAt > 0, true)
  assert.equal(seated.summary.occupied >= 1, true)

  await post(table, 'pay', { personaId: anya, scope: 'full', idemKey: 'hall-pay' })
  await post(table, 'close', {}, TOKEN)

  const closed = await hallOf()
  assert.equal(closed.card.status, 'closed')
  assert.equal(closed.shift.tables >= 1, true)
  assert.equal(closed.shift.revenue >= 690, true)
  assert.equal(closed.shift.guests >= 1, true)
})

test('SSE зала принимает токен в query и шлёт обновление при изменении стола', async () => {
  const table = '21'
  const chunks = []
  const req = http.get(`${base}/api/hall/stream?token=${TOKEN}`, res => {
    res.setEncoding('utf8')
    res.on('data', d => chunks.push(d))
  })
  await new Promise(r => setTimeout(r, 150))
  assert.equal(chunks.length, 1, 'первый снапшот приходит сразу')

  await joinGuest(table, 'Лена', 'panda')
  await new Promise(r => setTimeout(r, 150))
  req.destroy()

  assert.equal(chunks.length >= 2, true, 'мутация стола обновила зал')
  const last = JSON.parse(chunks[chunks.length - 1].replace(/^data: /, ''))
  assert.equal(last.tables.find(t => t.id === table).guests, 1)
})

test('кухня видит отправленные позиции всех столов и ведёт их до подачи', async () => {
  const table = '15'
  const kitchen = async () => {
    const r = await fetch(`${base}/api/kitchen`, { headers: { 'x-manager-token': TOKEN } })
    assert.equal(r.status, 200)
    return r.json()
  }

  assert.equal((await fetch(`${base}/api/kitchen`)).status, 401, 'без токена кухня закрыта')

  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { personaId: anya, dishId: 'tomyam', qty: 2, options: { spice: 'Остро' } })

  const draft = await kitchen()
  assert.equal(draft.tickets.some(t => t.tableId === table), false, 'черновик на кухню не попадает')

  await post(table, 'send', { personaId: anya, scope: 'mine' })
  const queued = await kitchen()
  const mine = queued.tickets.find(t => t.tableId === table)
  assert.equal(mine.dishId, 'tomyam')
  assert.equal(mine.qty, 2)
  assert.equal(mine.options.spice, 'Остро', 'модификаторы видны кухне')
  assert.equal(mine.guest, 'Аня')
  assert.equal(mine.zoneName, 'Терраса')
  assert.equal(mine.startedAt, null)
  assert.equal(queued.summary.queued >= 1, true)

  assert.equal((await post(table, 'start', { uid: mine.uid })).status, 401, 'взять в работу может только персонал')
  assert.equal((await post(table, 'start', { uid: mine.uid }, TOKEN)).status, 200)

  const cooking = await kitchen()
  const started = cooking.tickets.find(t => t.tableId === table)
  assert.equal(started.startedAt > 0, true)
  assert.equal(cooking.summary.cooking >= 1, true)

  await post(table, 'serve', { uid: mine.uid }, TOKEN)
  const after = await kitchen()
  assert.equal(after.tickets.some(t => t.tableId === table), false, 'поданное уходит с кухни')

  const snap = await snapshot(table)
  assert.equal(snap.lines[0].startedAt > 0, true, 'время начала готовки осталось в позиции')
  assert.equal(snap.lines[0].served, true)
})

test('SSE зала без токена не открывается', async () => {
  const res = await fetch(`${base}/api/hall/stream`)
  assert.equal(res.status, 401)
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
