import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

process.env.EASYPAY_MANAGER_TOKEN = 'test-manager-token'
process.env.EASYPAY_ANY_TABLE = '1' // тестам нужны произвольные столы вне плана зала
const { createServer } = await import('../src/index.mjs')

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

function post(table, action, body = {}, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}/api/t/${table}/${action}`, { method: 'POST', headers, body: JSON.stringify(body) })
}

const snapshot = table => fetch(`${base}/api/t/${table}`).then(r => r.json())

/** Гость садится за стол и получает личный токен — им он и действует. */
async function joinGuest(table, name = 'Аня', animal = 'fox') {
  const res = await post(table, 'join', { name, animal, idemKey: `${table}-${name}` })
  assert.equal(res.status, 200)
  const body = await res.json()
  return { personaId: body.personaId, guest: body.guestToken }
}

async function staffAt(table, action, body, token = TOKEN) {
  const snap = await snapshot(table)
  return post(table, action, { ...body, sessionId: snap.sessionId }, { staff: token })
}

// --- Гость и его личность ---

test('join открывает сессию, выдаёт личный токен и не светит чужие секреты', async () => {
  const table = freshTable()
  const before = await snapshot(table)
  assert.equal(before.status, 'closed')

  const anya = await joinGuest(table)
  assert.equal(typeof anya.guest, 'string')
  assert.equal(anya.guest.length > 10, true)

  const after = await snapshot(table)
  assert.equal(after.status, 'open')
  assert.equal(after.personas.length, 1)
  assert.equal(after.personas[0].name, 'Аня')
  assert.equal('secret' in after.personas[0], false, 'секрет гостя наружу не уходит')
  assert.equal(JSON.stringify(after).includes(anya.guest), false)
})

test('чужой заказ на свою персону не повесить', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')

  // Дима знает personaId Ани из снапшота, но токен у него свой
  const res = await post(table, 'lines', { personaId: anya.personaId, dishId: 'steak', qty: 1 }, { guest: dima.guest })
  assert.equal(res.status, 403)

  const anonymous = await post(table, 'lines', { dishId: 'steak', qty: 1 })
  assert.equal(anonymous.status, 401, 'без токена гостя заказ не принимается')

  const snap = await snapshot(table)
  assert.equal(snap.lines.length, 0)
})

test('вместимость стола ограничена посадкой из плана зала', async () => {
  const table = '13' // 2 места по hall.json
  await post(table, 'reset', {}, { staff: TOKEN })
  await joinGuest(table, 'Первый', 'fox')
  await joinGuest(table, 'Второй', 'bear')
  const third = await post(table, 'join', { name: 'Третий', animal: 'panda', idemKey: 'x' })
  assert.equal(third.status, 400)
  assert.equal((await third.json()).error, 'table full')
})

test('имя чистится от тегов, зверь — только из списка', async () => {
  const table = freshTable()
  await post(table, 'join', { name: `<b>${'я'.repeat(60)}</b>`, animal: 'bear', idemKey: 'k' })
  const snap = await snapshot(table)
  assert.equal(snap.personas[0].name.includes('<'), false)
  assert.equal(snap.personas[0].name.length <= 30, true)

  const bad = await post(freshTable(), 'join', { name: 'Кто-то', animal: 'дракон', idemKey: 'k2' })
  assert.equal(bad.status, 400)
})

test('повтор join с тем же ключом не создаёт вторую персону', async () => {
  const table = freshTable()
  const first = await post(table, 'join', { name: 'Дима', animal: 'bear', idemKey: 'same-key' })
  const second = await post(table, 'join', { name: 'Дима', animal: 'bear', idemKey: 'same-key' })
  assert.deepEqual((await first.json()).personaId, (await second.json()).personaId)
  assert.equal((await snapshot(table)).personas.length, 1)
})

// --- Заказ ---

test('позиция принимается только валидная, и в ответе есть uid', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)

  assert.equal((await post(table, 'lines', { dishId: 'ghost', qty: 1 }, { guest })).status, 400)
  assert.equal((await post(table, 'lines', { dishId: 'duck', qty: 1 }, { guest })).status, 400, 'стоп-лист')
  assert.equal((await post(table, 'lines', { dishId: 'tomyam', qty: 0 }, { guest })).status, 400)
  assert.equal((await post(table, 'lines', { dishId: 'tomyam', qty: 99 }, { guest })).status, 400)
  assert.equal((await post(table, 'lines', { dishId: 'tomyam', qty: 2.5 }, { guest })).status, 400)

  const ok = await post(table, 'lines', { dishId: 'tomyam', qty: 2 }, { guest })
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(Number.isInteger(body.uid), true, 'клиент получает uid созданной позиции')
  assert.equal(body.line.name, 'Том ям')
  assert.equal(body.line.price, 690, 'цена фиксируется в позиции')
})

test('модификаторы: чужое значение — отказ, а не тихая подмена', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)

  const strange = await post(table, 'lines', { dishId: 'cappuccino', options: { milk: 'Верблюжье' } }, { guest })
  assert.equal(strange.status, 400, 'на аллергиях молчаливая подмена опасна')

  const alien = await post(table, 'lines', { dishId: 'cappuccino', options: { roast: 'Rare' } }, { guest })
  assert.equal(alien.status, 400, 'чужая группа модификаторов')

  const good = await post(table, 'lines', { dishId: 'cappuccino', options: { milk: 'Овсяное' } }, { guest })
  assert.equal(good.status, 200)
  const snap = await snapshot(table)
  assert.equal(snap.lines[0].options.milk, 'Овсяное')

  const byDefault = await post(table, 'lines', { dishId: 'tomyam' }, { guest })
  assert.equal(byDefault.status, 200)
  assert.equal((await snapshot(table)).lines[1].options.spice, 'Средне', 'не выбрали — дефолт меню')
})

test('черновик не долг стола, отправка фиксирует счёт и участников общего', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { dishId: 'tomyam' }, { guest: anya.guest }) // 690
  await post(table, 'lines', { dishId: 'bruschetta', qty: 2, shared: true }, { guest: anya.guest }) // 980

  let snap = await snapshot(table)
  assert.equal(snap.totals.tableTotal, 0, 'ничего не отправлено — счёт пуст')
  assert.equal(snap.totals.draftTotal, 1670)

  await post(table, 'send', { scope: 'mine' }, { guest: anya.guest })
  snap = await snapshot(table)
  assert.equal(snap.totals.tableTotal, 1670)
  assert.equal(snap.lines[1].sharedWith.length, 1, 'общее закреплено за теми, кто был за столом')

  // Дима подсаживается ПОСЛЕ отправки — общее уже поделено без него
  const dima = await joinGuest(table, 'Дима', 'bear')
  snap = await snapshot(table)
  const anyaTotals = snap.totals.byPersona.find(p => p.personaId === anya.personaId)
  const dimaTotals = snap.totals.byPersona.find(p => p.personaId === dima.personaId)
  assert.equal(anyaTotals.total, 1670)
  assert.equal(dimaTotals.total, 0)
})

test('чужую позицию удалить нельзя, отправленную — тоже', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')
  const created = await (await post(table, 'lines', { dishId: 'tomyam' }, { guest: anya.guest })).json()

  assert.equal((await post(table, 'remove', { uid: created.uid }, { guest: dima.guest })).status, 403)
  assert.equal((await post(table, 'remove', { uid: created.uid }, { guest: anya.guest })).status, 200)

  const again = await (await post(table, 'lines', { dishId: 'padthai' }, { guest: anya.guest })).json()
  await post(table, 'send', { scope: 'mine' }, { guest: anya.guest })
  assert.equal((await post(table, 'remove', { uid: again.uid }, { guest: anya.guest })).status, 400)
})

test('send scope=mine отправляет только своё, all — всё', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')
  await post(table, 'lines', { dishId: 'tomyam' }, { guest: anya.guest })
  await post(table, 'lines', { dishId: 'padthai' }, { guest: dima.guest })

  await post(table, 'send', { scope: 'mine' }, { guest: anya.guest })
  let snap = await snapshot(table)
  assert.deepEqual(snap.lines.map(l => l.sent), [true, false])

  assert.equal((await post(table, 'send', { scope: 'mine' }, { guest: anya.guest })).status, 400, 'отправлять нечего')

  await post(table, 'send', { scope: 'all' }, { guest: anya.guest })
  snap = await snapshot(table)
  assert.deepEqual(snap.lines.map(l => l.sent), [true, true])
})

// --- Деньги ---

test('сумму платежа считает сервер, клиентские числа игнорируются', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'tomyam' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const res = await post(table, 'pay', { scope: 'own', amount: 1, idemKey: 'pay-1' }, { guest })
  const body = await res.json()
  assert.equal(body.amount, 690)
  assert.equal(body.remaining, 0)
  assert.equal((await snapshot(table)).payments.length, 1)
})

test('повтор оплаты с тем же ключом не списывает дважды', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'steak' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const first = await (await post(table, 'pay', { scope: 'own', idemKey: 'retry' }, { guest })).json()
  const second = await (await post(table, 'pay', { scope: 'own', idemKey: 'retry' }, { guest })).json()
  assert.equal(first.amount, second.amount)
  assert.equal((await snapshot(table)).payments.length, 1)
})

test('оплата: неизвестный scope и отсутствие ключа — отказ, а не тихое «своё»', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'tomyam' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const weird = await post(table, 'pay', { scope: 'table', idemKey: 'p-weird' }, { guest })
  assert.equal(weird.status, 400)
  assert.equal((await weird.json()).error, 'unknown pay scope')

  const noKey = await post(table, 'pay', { scope: 'own' }, { guest })
  assert.equal(noKey.status, 400, 'без ключа ретрай спишет дважды')
  assert.equal((await noKey.json()).error, 'idemKey required')

  assert.equal((await snapshot(table)).payments.length, 0)
})

test('чаевые ограничены счётом, а не молча обрезаются', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'water' }, { guest }) // 150
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'tip-pay' }, { guest })

  const huge = await post(table, 'tip', { amount: 999999999, idemKey: 't1' }, { guest })
  assert.equal(huge.status, 400)
  assert.equal((await huge.json()).error, 'tip too large')

  assert.equal((await post(table, 'tip', { amount: -5, idemKey: 't2' }, { guest })).status, 400)

  const ok = await post(table, 'tip', { amount: 300, idemKey: 't3' }, { guest })
  assert.equal(ok.status, 200)
  const snap = await snapshot(table)
  assert.equal(snap.tips.length, 1)
  assert.equal(snap.totals.tableTotal, 150, 'чаевые в счёт стола не входят')

  // потолок общий на стол, иначе обходится циклом мелких переводов
  const second = await post(table, 'tip', { amount: 4800, idemKey: 't4' }, { guest })
  assert.equal(second.status, 400)
  assert.equal((await second.json()).error, 'tip too large')
})

test('закрытие с отменой неподанного показывает переплату, а не прячет её', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'tomyam' }, { guest }) // 690
  await post(table, 'lines', { dishId: 'espresso' }, { guest }) // 180
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'over-1' }, { guest }) // 870

  // подали только суп, эспрессо остаётся на баре
  const snap = await snapshot(table)
  const soup = snap.lines.find(l => l.dishId === 'tomyam')
  await staffAt(table, 'start', { uid: soup.uid })
  await staffAt(table, 'serve', { uid: soup.uid })
  await staffAt(table, 'close', {})

  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': TOKEN } })).json()
  const overpaid = log.entries.find(e => e.action === 'переплата к возврату' && e.tableId === table)
  assert.equal(!!overpaid, true, 'деньги за отменённое нельзя молча оставить себе')
  assert.equal(overpaid.detail.startsWith('180'), true)

  const hall = await (await fetch(`${base}/api/hall`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(hall.summary.overpaid >= 180, true, 'переплата видна в итогах смены')
})

// --- Кухня ---

test('позиция идёт очередь → в работу → подано, без пропусков и повторов', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'tomyam' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  const snap = await snapshot(table)
  const uid = snap.lines[0].uid

  const early = await staffAt(table, 'serve', { uid })
  assert.equal(early.status, 409, 'подать, не взяв в работу, нельзя — иначе времени готовки нет')

  assert.equal((await staffAt(table, 'start', { uid })).status, 200)
  assert.equal((await staffAt(table, 'start', { uid })).status, 200, 'повтор «в работу» безопасен')
  const startedAt = (await snapshot(table)).lines[0].startedAt

  assert.equal((await staffAt(table, 'serve', { uid })).status, 200)
  const servedAt = (await snapshot(table)).lines[0].servedAt

  const twice = await staffAt(table, 'serve', { uid })
  assert.equal(twice.status, 409, 'повторная подача запрещена')
  const after = await snapshot(table)
  assert.equal(after.lines[0].servedAt, servedAt, 'время подачи не переписывается')
  assert.equal(after.lines[0].startedAt, startedAt)
})

test('действие кухни привязано к сессии стола', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'tomyam' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  const uid = (await snapshot(table)).lines[0].uid

  assert.equal((await post(table, 'start', { uid }, { staff: TOKEN })).status, 400, 'без sessionId нельзя')
  const stale = await post(table, 'start', { uid, sessionId: 'чужая-сессия' }, { staff: TOKEN })
  assert.equal(stale.status, 409)
})

test('кухня видит очередь всего зала и знает названия, цех и аллергены', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'caesar' }, { guest })
  await post(table, 'lines', { dishId: 'cappuccino', options: { milk: 'Овсяное' } }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const kitchen = await (await fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': TOKEN } })).json()
  const mine = kitchen.tickets.filter(t => t.tableId === table)
  assert.equal(mine.length, 2)
  const caesar = mine.find(t => t.dishId === 'caesar')
  assert.equal(caesar.name, 'Цезарь с курицей')
  assert.equal(caesar.station, 'kitchen')
  assert.equal(caesar.allergens.includes('рыба'), true)
  assert.equal(mine.find(t => t.dishId === 'cappuccino').station, 'bar', 'напитки — бар')
  assert.equal(typeof caesar.sessionId, 'string')
})

test('закрытие стола отменяет то, что висит на кухне', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'risotto' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'c1' }, { guest })
  await staffAt(table, 'close', {})

  const kitchen = await (await fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(kitchen.tickets.some(t => t.tableId === table), false, 'из очереди ушло')
  const cancelled = kitchen.cancelled.find(t => t.tableId === table)
  assert.equal(!!cancelled, true, 'но повар видит отмену')
  assert.equal(cancelled.reason, 'стол закрыт')
})

// --- Закрытие и смена ---

test('стол с долгом не закрыть случайно — только осознанно', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'steak' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const refused = await staffAt(table, 'close', {})
  assert.equal(refused.status, 409)
  const body = await refused.json()
  assert.equal(body.error, 'unpaid')
  assert.equal(body.remaining, 1290)
  assert.equal((await snapshot(table)).status, 'open', 'стол остался открыт — гость может доплатить')

  const forced = await staffAt(table, 'close', { force: true })
  assert.equal(forced.status, 200)
  assert.equal((await snapshot(table)).status, 'closed')

  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(log.entries.some(e => e.action === 'закрыл стол с долгом' && e.tableId === table), true)
})

test('закрытый стол не принимает заказы, а новый join открывает новую сессию', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { dishId: 'tomyam' }, { guest: anya.guest })
  await post(table, 'send', { scope: 'mine' }, { guest: anya.guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'p' }, { guest: anya.guest })
  const opened = await snapshot(table)
  assert.equal((await staffAt(table, 'close', {})).status, 200)

  assert.equal((await post(table, 'lines', { dishId: 'padthai' }, { guest: anya.guest })).status, 409)

  const lena = await joinGuest(table, 'Лена', 'panda')
  const reopened = await snapshot(table)
  assert.equal(reopened.status, 'open')
  assert.notEqual(reopened.sessionId, opened.sessionId)
  assert.equal(reopened.lines.length, 0)
  assert.equal(reopened.personas.length, 1)
  assert.equal(reopened.personas[0].id, lena.personaId)
})

test('вызовы официанта копятся очередью и снимаются по одному', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')

  assert.equal((await staffAt(table, 'ack', {})).status, 400, 'снимать нечего')

  await post(table, 'call', { reason: 'help' }, { guest: anya.guest })
  await post(table, 'call', { reason: 'bill' }, { guest: dima.guest })
  let snap = await snapshot(table)
  assert.equal(snap.calls.length, 2, 'второй гость не затирает первого')
  assert.equal(snap.calls[0].name, 'Аня')

  await staffAt(table, 'ack', { callId: snap.calls[0].id })
  snap = await snapshot(table)
  assert.equal(snap.calls.length, 1)
  assert.equal(snap.calls[0].reason, 'bill')
})

test('зал отдаётся только персоналу и содержит план столов с ответственным официантом', async () => {
  assert.equal((await fetch(`${base}/api/hall`)).status, 401)

  const hall = await (await fetch(`${base}/api/hall`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(hall.tables.length >= 12, true)
  const t12 = hall.tables.find(t => t.id === '12')
  assert.equal(t12.zoneName, 'Терраса')
  assert.equal(t12.waiterName, 'Максим', 'в зале видно, чей это стол')
  assert.equal(typeof hall.summary.closedRevenue, 'number')
  assert.equal(typeof hall.summary.debt, 'number')
})

test('SSE зала принимает токен в query и обновляется при изменении стола', async () => {
  const table = '14'
  await post(table, 'reset', {}, { staff: TOKEN })
  const chunks = []
  const req = http.get(`${base}/api/hall/stream?token=${TOKEN}`, res => {
    res.setEncoding('utf8')
    res.on('data', d => chunks.push(d))
  })
  await new Promise(r => setTimeout(r, 150))
  assert.equal(chunks.length, 1)

  await joinGuest(table, 'Лена', 'panda')
  await new Promise(r => setTimeout(r, 150))
  req.destroy()

  assert.equal(chunks.length >= 2, true)
  const last = JSON.parse(chunks[chunks.length - 1].replace(/^data: /, ''))
  assert.equal(last.tables.find(t => t.id === table).guests, 1)
})

test('кривой id стола, битый JSON и стол вне плана отбиваются', async () => {
  assert.equal((await fetch(`${base}/api/t/..%2Fetc/`)).status, 404)
  const res = await fetch(`${base}/api/t/ok1/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json'
  })
  assert.equal(res.status, 400)
})

test('SSE стола отдаёт снапшот сразу после подключения', async () => {
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
