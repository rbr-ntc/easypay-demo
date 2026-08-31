import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'

process.env.EASYPAY_MANAGER_TOKEN = 'test-manager-token'
process.env.EASYPAY_ANY_TABLE = '1' // тестам нужны произвольные столы вне плана зала
const { createServer } = await import('../src/index.ts')

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

// Снапшот отдаётся только своим: в тестах читаем персоналом
const snapshot = table =>
  fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': TOKEN } }).then(r => r.json())

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
  const sent = await post(table, 'remove', { uid: again.uid }, { guest: anya.guest })
  assert.equal(sent.status, 409)
  assert.equal((await sent.json()).error, 'already sent to kitchen', 'причина названа, а не «locked or missing»')
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

  const nothingNew = await post(table, 'send', { scope: 'mine' }, { guest: anya.guest })
  assert.equal(nothingNew.status, 200, 'своё уже на кухне — это не ошибка')
  assert.equal((await nothingNew.json()).sent, 0)

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
  // Эспрессо всё ещё на баре: закрыть можно только осознанно
  await staffAt(table, 'close', { force: true })

  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': TOKEN } })).json()
  const overpaid = log.entries.find(e => e.action === 'переплата к возврату' && e.tableId === table)
  assert.equal(!!overpaid, true, 'деньги за отменённое нельзя молча оставить себе')
  assert.equal(overpaid.amount, 180, 'сумма переплаты записана отдельным полем')

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

  // Гости заплатили, но еда ещё на кухне — молча закрывать нельзя
  const refused = await staffAt(table, 'close', {})
  assert.equal(refused.status, 409)
  assert.equal((await refused.json()).error, 'kitchen pending')
  await staffAt(table, 'close', { force: true })

  const kitchen = await (await fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(kitchen.tickets.some(t => t.tableId === table), false, 'из очереди ушло')
  const cancelled = kitchen.cancelled.find(t => t.tableId === table)
  assert.equal(!!cancelled, true, 'но повар видит отмену')
  assert.equal(cancelled.reason, 'стол закрыт, не начинали', 'причина различает снятое с плиты и нетронутое')
  // Денег на кухонном экране быть не должно: он висит у плиты и его видят все
  assert.equal(cancelled.amount, undefined, 'цена не уезжает на экран кухни')
  assert.equal(cancelled.wasCooking, false, 'блюдо не успели взять в работу')
})

test('отмена висит на кухне, пока повар не подтвердит', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'risotto' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  const snap = await snapshot(table)
  const uid = snap.lines[0].uid
  await post(table, 'pay', { scope: 'full', idemKey: 'dm1' }, { guest })
  // Ризотто ещё на кухне — закрываем осознанно
  await staffAt(table, 'close', { force: true })

  const board = () =>
    fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': TOKEN } })
      .then(r => r.json())
      .then(k => k.cancelled.find(t => t.tableId === table))

  assert.equal(!!(await board()), true, 'сразу после закрытия отмена на экране')

  // Раньше карточка снималась таймером — блюдо могло остаться на плите
  const dismissed = await staffAt(table, 'dismiss', { uid })
  assert.equal(dismissed.status, 200)
  assert.equal(await board(), undefined, 'ушла только после подтверждения повара')

  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(
    log.entries.some(e => e.action === 'снял отменённое с плиты' && e.tableId === table),
    true,
    'подтверждение попадает в журнал'
  )
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

  // Стейк на кухню отправили, но не подали — гость его не получил, значит
  // и не должен за него. В журнале это списание с кухни, а не долг гостя.
  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': TOKEN } })).json()
  // Закрытие поверх готовящейся еды — отдельное событие в журнале
  assert.equal(
    log.entries.some(e => e.action === 'закрыл стол, не дождавшись кухни' && e.tableId === table),
    true
  )
  assert.equal(
    log.entries.some(e => e.action === 'списание с кухни' && e.tableId === table && e.amount === 1290),
    true,
    'неподанное списывается отдельной строкой'
  )
})

test('закрытый стол не принимает заказы, а новый join открывает новую сессию', async () => {
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  await post(table, 'lines', { dishId: 'tomyam' }, { guest: anya.guest })
  await post(table, 'send', { scope: 'mine' }, { guest: anya.guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'p' }, { guest: anya.guest })
  const opened = await snapshot(table)
  assert.equal((await staffAt(table, 'close', { force: true })).status, 200)

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
  const { guest } = await joinGuest(table, 'Аня', 'fox')
  const chunk = await new Promise((resolve, reject) => {
    // Поток стола отдаётся только своим — секрет гостя идёт параметром
    const req = http.get(`${base}/api/t/${table}/stream?g=${encodeURIComponent(guest)}`, res => {
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

// --- Чек, аллергии, отмена гостем, уборка стола ---

test('оплата отдаёт чек с номером и составом, а не голое «ок»', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'steak' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const res = await post(table, 'pay', { scope: 'own', idemKey: 'rc-1' }, { guest })
  const body = await res.json()

  assert.equal(typeof body.receipt?.no, 'string', 'номер операции есть')
  assert.equal(body.receipt.amount, 1290)
  assert.equal(body.receipt.table, table)
  assert.equal(
    body.receipt.lines.some(l => l.name === 'Стейк рибай'),
    true,
    'в чеке видно, за что списаны деньги'
  )

  // Чек переживает перезагрузку экрана: гость может вернуться к нему позже
  const snap = await snapshot(table)
  assert.equal(snap.payments[0].receiptNo, body.receipt.no)
})

test('блюдо с заявленным аллергеном не заказывается молча', async () => {
  const table = freshTable()
  const joined = await (
    await post(table, 'join', { name: 'Нина', animal: 'owl', allergies: ['лактоза'], idemKey: 'alg-1' })
  ).json()
  const guest = joined.guestToken

  const snap0 = await snapshot(table)
  assert.deepEqual(snap0.personas[0].allergies, ['лактоза'], 'аллергия записана в профиль')

  // Капучино на коровьем молоке — лактоза
  const blocked = await post(table, 'lines', { dishId: 'cappuccino' }, { guest })
  assert.equal(blocked.status, 409)
  const body = await blocked.json()
  assert.equal(body.error, 'allergen warning')
  assert.deepEqual(body.allergens, ['лактоза'])
  assert.equal((await snapshot(table)).lines.length, 0, 'позиция не создалась')

  // Осознанное подтверждение — заказ проходит
  const ok = await post(table, 'lines', { dishId: 'cappuccino', confirmAllergen: true }, { guest })
  assert.equal(ok.status, 200)

  // Овсяное молоко снимает лактозу — предупреждать не о чем
  const oat = await post(table, 'lines', { dishId: 'cappuccino', options: { milk: 'Овсяное' } }, { guest })
  assert.equal(oat.status, 200, 'модификатор снял аллерген — блокировать нечего')
})

test('гость отменяет своё, пока кухня не взялась', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'espresso' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const snap = await snapshot(table)
  const uid = snap.lines[0].uid
  assert.equal(snap.totals.tableTotal, 180)

  const done = await post(table, 'cancelMine', { uid }, { guest })
  assert.equal(done.status, 200)

  const after = await snapshot(table)
  assert.equal(after.lines[0].cancelled, true)
  assert.equal(after.totals.tableTotal, 0, 'отменённое уходит из счёта')

  // Второй заказ, который кухня уже взяла в работу, отменить нельзя
  await post(table, 'lines', { dishId: 'espresso' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  const snap2 = await snapshot(table)
  const uid2 = snap2.lines.find(l => !l.cancelled).uid
  await staffAt(table, 'start', { uid: uid2 })

  const late = await post(table, 'cancelMine', { uid: uid2 }, { guest })
  assert.equal(late.status, 409)
  assert.equal((await late.json()).error, 'already cooking')
})

test('стол свободен, когда его убрали, а не когда прошло время', async () => {
  // Стол из плана зала: карточка должна быть видна и после закрытия
  const table = '4'
  await post(table, 'reset', { force: true }, { staff: TOKEN })
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'fries' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'cl-1' }, { guest })
  await staffAt(table, 'close', { force: true })

  const hall = () =>
    fetch(`${base}/api/hall`, { headers: { 'x-staff-token': TOKEN } })
      .then(r => r.json())
      .then(h => h.tables.find(t => t.id === table))

  assert.equal((await hall()).cleanedAt, null, 'пока не убрали — грязный')

  const done = await staffAt(table, 'clean', {})
  assert.equal(done.status, 200)
  assert.equal(typeof (await hall()).cleanedAt, 'number', 'уборка зафиксирована фактом')
})

test('комментарий к блюду доезжает до кухни, а не теряется молча', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'fries', comment: 'Аллергия на орехи, критично' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const board = await (await fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': TOKEN } })).json()
  const ticket = board.tickets.find(t => t.tableId === table)
  assert.equal(ticket.comment, 'Аллергия на орехи, критично')
})

test('вызов официанта отвечает id и не проглатывает чужую причину', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)

  const bad = await post(table, 'call', { reason: 'У меня аллергия на орехи' }, { guest })
  assert.equal(bad.status, 400, 'неизвестная причина — честная ошибка, а не тихое «ок»')

  const called = await post(table, 'call', { reason: 'help', note: 'аллергия на орехи' }, { guest })
  const body = await called.json()
  assert.equal(typeof body.callId, 'string', 'гость видит, что его услышали')

  const again = await post(table, 'call', { reason: 'help' }, { guest })
  assert.equal((await again.json()).repeated, true)

  const snap = await snapshot(table)
  assert.equal(snap.calls[0].note, 'аллергия на орехи', 'текст доезжает до официанта')
})

test('вызов «принесите счёт» гаснет сам после полной оплаты', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'lemonade' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'call', { reason: 'bill' }, { guest })

  assert.equal((await snapshot(table)).calls.length, 1)
  await post(table, 'pay', { scope: 'full', idemKey: 'bill-1' }, { guest })

  assert.equal((await snapshot(table)).calls.length, 0, 'официант не идёт с папкой к расплатившемуся')
})

test('неудачный join не открывает стол', async () => {
  const table = freshTable()
  const bad = await post(table, 'join', { name: 'Кто-то', animal: 'дракон', idemKey: 'bad-join' })
  assert.equal(bad.status, 400)

  const snap = await snapshot(table)
  assert.equal(snap.status, 'closed', 'упавшая проверка не оставляет ресторану занятый стол')
  assert.equal(snap.openedAt, null)
})

test('состав стола не виден постороннему', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table, 'Нина', 'owl')
  await post(table, 'lines', { dishId: 'steak' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  // Без токена: стол существует и занят — и всё
  const stub = await fetch(`${base}/api/t/${table}`).then(r => r.json())
  assert.equal(stub.limited, true)
  assert.deepEqual(stub.personas, [])
  assert.deepEqual(stub.lines, [])
  assert.equal(stub.totals.tableTotal, 0)
  assert.equal(stub.occupied, 1, 'занятость видна — она не секрет')

  // Со своим секретом — полная картина
  const mine = await fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': guest } }).then(r => r.json())
  assert.equal(mine.personas[0].name, 'Нина')
  assert.equal(mine.totals.tableTotal, 1290)
})

test('pay понимает словарь send: mine и all — не ошибка', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'greek' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const paid = await post(table, 'pay', { scope: 'mine', idemKey: 'alias-1' }, { guest })
  assert.equal(paid.status, 200, 'соседние ручки не должны требовать разных слов')
  assert.equal((await paid.json()).amount, 590)
})

test('готово и подано — разные события: между плитой и столом есть раздача', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'risotto' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const snap = await snapshot(table)
  const uid = snap.lines[0].uid

  // Повар не может объявить готовым то, что не брал в работу
  const early = await staffAt(table, 'ready', { uid })
  assert.equal(early.status, 409)

  await staffAt(table, 'start', { uid })
  const ready = await staffAt(table, 'ready', { uid })
  assert.equal(ready.status, 200)

  const cooked = await snapshot(table)
  assert.equal(typeof cooked.lines[0].readyAt, 'number', 'блюдо стоит на раздаче')
  assert.equal(cooked.lines[0].served, false, 'но гостю его ещё не отдали')

  // Кухня показывает его отдельной полосой, а стол — счётчиком для официанта
  const board = await (await fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(board.summary.ready >= 1, true)

  await staffAt(table, 'serve', { uid })
  const served = await snapshot(table)
  assert.equal(served.lines[0].served, true)
  assert.equal(served.lines[0].readyAt <= served.lines[0].servedAt, true, 'готово было раньше подачи')
})

test('прямая подача без раздачи всё равно фиксирует время готовности', async () => {
  // Маленькое заведение: повар отдал из рук в руки, отдельной раздачи нет
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'fries' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  const uid = (await snapshot(table)).lines[0].uid

  await staffAt(table, 'start', { uid })
  await staffAt(table, 'serve', { uid })

  const line = (await snapshot(table)).lines[0]
  assert.equal(line.served, true)
  assert.equal(typeof line.readyAt, 'number', 'иначе время на раздаче соврёт')
})

test('наличные: гость просит — официант подтверждает, и только тогда это деньги', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table, 'Пётр', 'bear')
  await post(table, 'lines', { dishId: 'steak' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  // Гость с телефона не может «заплатить наличными» — деньги принимает человек
  const intent = await post(table, 'cashIntent', { scope: 'own' }, { guest })
  assert.equal(intent.status, 200)
  assert.equal((await intent.json()).amount, 1290)

  const waiting = await snapshot(table)
  assert.equal(waiting.cashIntent.amount, 1290, 'официант видит просьбу в зале')
  assert.equal(waiting.totals.remaining, 1290, 'но денег ещё нет: намерение — не платёж')

  // Официант физически взял деньги
  const taken = await staffAt(table, 'cash', { personaId: waiting.personas[0].id, scope: 'own' })
  assert.equal(taken.status, 200)
  assert.equal((await taken.json()).amount, 1290)

  const paid = await snapshot(table)
  assert.equal(paid.totals.remaining, 0)
  assert.equal(paid.payments[0].method, 'cash')
  assert.equal(paid.payments[0].takenByName, 'Менеджер (токен)', 'видно, кто взял деньги')
  assert.equal(paid.cashIntent, null, 'просьба снята')

  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': TOKEN } })).json()
  assert.equal(
    log.entries.some(e => e.action === 'принял наличные' && e.tableId === table && e.amount === 1290),
    true,
    'приём наличных попадает в журнал с суммой и автором'
  )
})

test('наличными нельзя взять больше остатка', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'lemonade' }, { guest }) // 220
  await post(table, 'send', { scope: 'mine' }, { guest })

  // Официант ввёл сумму «с потолка» — сервер клампит остатком
  const taken = await staffAt(table, 'cash', { amount: 5000 })
  assert.equal((await taken.json()).amount, 220)

  const again = await staffAt(table, 'cash', { amount: 100 })
  assert.equal(again.status, 400, 'на оплаченном столе брать больше нечего')
})

test('безналичный платёж помечен способом', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'greek' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  const res = await post(table, 'pay', { scope: 'own', method: 'card', idemKey: 'm-1' }, { guest })
  assert.equal((await res.json()).receipt.method, 'card')
  assert.equal((await snapshot(table)).payments[0].method, 'card')
})

test('чужое слово в аллергиях — ошибка, а не пустой список', async () => {
  const table = freshTable()
  // Гость пишет «молоко» вместо «лактоза»: раньше значение молча выбрасывалось,
  // и человек был уверен, что предупредил, а система считала его здоровым
  const res = await post(table, 'join', {
    name: 'Нина',
    animal: 'owl',
    allergies: ['орехи', 'молоко'],
    idemKey: 'alg-unknown'
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(body.error, 'unknown allergen')
  assert.deepEqual(body.unknown, ['молоко'])
  assert.equal(body.allowed.includes('лактоза'), true, 'подсказываем, что имелось в виду')

  assert.equal((await snapshot(table)).status, 'closed', 'стол не открылся на ошибке')
})

test('показанная сумма и списанная — одно и то же число', async () => {
  // Гостья видела 415,89, платила «своё» и получала списание 379, а следом
  // микроплатежи на 5,25 и 60 копеек. Такое эквайринг либо отклонит, либо съест.
  const table = freshTable()
  const anya = await joinGuest(table, 'Аня', 'fox')
  const dima = await joinGuest(table, 'Дима', 'bear')
  await post(table, 'lines', { dishId: 'steak' }, { guest: anya.guest }) // 1290
  await post(table, 'lines', { dishId: 'greek' }, { guest: dima.guest }) // 590
  await post(table, 'send', { scope: 'all' }, { guest: anya.guest })

  // Аня платит за весь стол — Дима больше ничего не должен
  await post(table, 'pay', { scope: 'full', idemKey: 'show-1' }, { guest: anya.guest })

  const snap = await snapshot(table)
  const dimaLeft = snap.totals.byPersona.find(p => p.personaId === dima.personaId).remaining
  assert.equal(dimaLeft, 0, 'за него уже заплатили')
  assert.equal(snap.totals.remaining, 0)

  const late = await post(table, 'pay', { scope: 'own', idemKey: 'show-2' }, { guest: dima.guest })
  assert.equal(late.status, 400, 'платить нечего — и это видно заранее')
})

test('бутылка вина не может стоить как бокал', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)

  const glass = await (
    await post(table, 'lines', { dishId: 'wine-red', options: { volume: 'Бокал 150 мл' } }, { guest })
  ).json()
  const bottle = await (
    await post(table, 'lines', { dishId: 'wine-red', options: { volume: 'Бутылка 750 мл' } }, { guest })
  ).json()

  assert.equal(glass.line.price, 590)
  assert.equal(bottle.line.price > glass.line.price * 3, true, 'надбавка за объём реальная')

  const snap = await snapshot(table)
  assert.equal(snap.totals.draftTotal, glass.line.price + bottle.line.price)
})

test('вино наливает бар, а не повар', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'wine-red', idemKey: 'bar-1' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const board = await (await fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': TOKEN } })).json()
  const ticket = board.tickets.find(t => t.tableId === table)
  assert.equal(ticket.station, 'bar')
})

test('оплата без указания «за что» отклоняется', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'steak' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const blind = await post(table, 'pay', { idemKey: 'blind-1' }, { guest })
  assert.equal(blind.status, 400, 'неполный запрос не должен списывать весь счёт')
  assert.equal((await blind.json()).error, 'scope required')
  assert.equal((await snapshot(table)).totals.paidTotal, 0)
})

test('повар не читает счета и гостей чужого стола', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table, 'Нина', 'owl')
  await post(table, 'lines', { dishId: 'steak' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const cook = await (
    await fetch(`${base}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': 'kitchen-screen' },
      body: JSON.stringify({ pin: '4444' })
    })
  ).json()

  const asCook = await fetch(`${base}/api/t/${table}`, {
    headers: { 'x-staff-token': cook.token }
  }).then(r => r.json())

  assert.equal(asCook.limited, true, 'повару нужна очередь кухни, а не имена и счета')
  assert.deepEqual(asCook.personas, [])
  assert.equal(asCook.totals.tableTotal, 0)
})

test('закрытый стол не закрывается второй раз молча', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'fries' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'dbl-1' }, { guest })
  assert.equal((await staffAt(table, 'close', { force: true })).status, 200)

  const again = await staffAt(table, 'close', { force: true })
  assert.equal(again.status, 409, 'иначе менеджер уверен, что закрыл он')
  assert.equal((await again.json()).error, 'already closed')
})

test('переплата видна сразу, а не только в закрытом чеке', async () => {
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'greek' }, { guest }) // 590
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'ov-1' }, { guest })

  const uid = (await snapshot(table)).lines[0].uid
  await staffAt(table, 'cancelPlaceholder', {}).catch(() => {})
  // Блюдо отменяет кухня при закрытии, но переплату гость должен видеть сразу
  await post(table, 'cancelMine', { uid }, { guest })

  const snap = await snapshot(table)
  assert.equal(snap.totals.tableTotal, 0)
  assert.equal(snap.totals.overpaid, 590, 'эти деньги надо вернуть, и это видно')
})

test('чаевые можно оставить и после того, как зал закрыл стол', async () => {
  // Тот, кто заплатил за всех, физически ещё сидит за столом. Раньше окно для
  // благодарности схлопывалось в ноль секунд, если менеджер успевал закрыть.
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'greek' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'tc-1' }, { guest })
  await staffAt(table, 'close', { force: true })

  const tip = await post(table, 'tip', { amount: 500, idemKey: 'tc-tip' }, { guest })
  assert.equal(tip.status, 200, 'официанту можно сказать спасибо')
  assert.equal((await tip.json()).amount, 500)

  // А заказывать на закрытом столе по-прежнему нельзя
  const late = await post(table, 'lines', { dishId: 'fries' }, { guest })
  assert.equal(late.status, 409)
})

test('журнал называет гостя, а не просто «Гость»', async () => {
  // При споре «я этот платёж не проводил» разбирать было нечем: гостевые
  // действия ложились в журнал без единого признака автора.
  const table = freshTable()
  const { guest, personaId } = await joinGuest(table, 'Олег', 'bear')
  await post(table, 'lines', { dishId: 'greek' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'own', idemKey: 'ga-1' }, { guest })

  const log = await (await fetch(`${base}/api/log`, { headers: { 'x-staff-token': TOKEN } })).json()
  const payment = log.entries.find(e => e.action === 'оплата' && e.tableId === table)

  assert.equal(payment.guestId, personaId, 'видно, какой именно гость заплатил')
  assert.equal(payment.name, 'Олег', 'и как его зовут')
  assert.equal(payment.amount, 590)
})

test('гостю объясняют, что стол закрыли, а не что его тут нет', async () => {
  // Гость с полной тарелкой получал голое «unknown guest» — техническую фразу
  // вместо человеческого объяснения. Стол умирает двумя способами, и оба
  // должны звучать понятно.
  const table = freshTable()
  const { guest } = await joinGuest(table, 'Глеб', 'bear')
  const opened = await snapshot(table)
  await post(table, 'lines', { dishId: 'fries' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'se-1' }, { guest })
  await staffAt(table, 'close', { force: true })

  // Новая посадка стирает прежнюю личность
  await joinGuest(table, 'Другой', 'fox')

  const stale = await post(table, 'lines', { dishId: 'espresso', sessionId: opened.sessionId }, { guest })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error, 'session ended', 'причина названа человеческим языком')
})

test('семь быстрых нажатий «Добавить» — одна порция, а не семь', async () => {
  // Ключ идемпотентности генерировался на каждый запрос, поэтому для сервера
  // это были семь разных намерений, и он честно выполнял все семь. Количество
  // выбирается плюсиком, а не частотой тапов по кнопке.
  const table = freshTable()
  const { guest } = await joinGuest(table)
  const key = 'один-заказ-стейка'

  // Гость колотит по кнопке: часть нажатий улетает параллельно
  const rapid = await Promise.all(
    Array.from({ length: 7 }, () => post(table, 'lines', { dishId: 'steak', qty: 1, idemKey: key }, { guest }))
  )
  assert.equal(rapid.every(r => r.status === 200), true, 'каждое нажатие отвечает спокойно')

  const snap = await snapshot(table)
  assert.equal(snap.lines.length, 1, 'в корзине одна позиция')
  assert.equal(snap.lines[0].qty, 1)
  assert.equal(snap.totals.draftTotal, 1290, 'и один счёт, а не семь')

  // Осознанный повтор — это новое намерение с новым ключом
  await post(table, 'lines', { dishId: 'steak', qty: 1, idemKey: 'второй-стейк' }, { guest })
  assert.equal((await snapshot(table)).lines.length, 2, 'вторую порцию заказать по-прежнему можно')
})

test('стол после закрытия снова можно убрать, и он не зовёт официанта', async () => {
  // Метка уборки переживала сессию: стол, убранный один раз за смену, после
  // следующего закрытия убрать было нельзя — гостей сажали за неубранный.
  // А вызов «принесите воды» висел в зале на уже свободном столе.
  const table = '4'
  await post(table, 'reset', { force: true }, { staff: TOKEN })

  const first = await joinGuest(table, 'Первый', 'fox')
  await post(table, 'lines', { dishId: 'fries' }, { guest: first.guest })
  await post(table, 'send', { scope: 'mine' }, { guest: first.guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'cl-a' }, { guest: first.guest })
  await staffAt(table, 'close', { force: true })
  assert.equal((await staffAt(table, 'clean', {})).status, 200)

  // Вторая посадка за ту же смену
  const second = await joinGuest(table, 'Второй', 'bear')
  await post(table, 'call', { reason: 'water' }, { guest: second.guest })
  await post(table, 'lines', { dishId: 'espresso' }, { guest: second.guest })
  await post(table, 'send', { scope: 'mine' }, { guest: second.guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'cl-b' }, { guest: second.guest })
  await staffAt(table, 'close', { force: true })

  const closed = await snapshot(table)
  assert.equal(closed.calls.length, 0, 'вызовы не переживают закрытие стола')

  const again = await staffAt(table, 'clean', {})
  assert.equal(again.status, 200)
  assert.equal((await again.json()).alreadyClean, undefined, 'убрать можно снова')

  const hall = await (await fetch(`${base}/api/hall`, { headers: { 'x-staff-token': TOKEN } })).json()
  const card = hall.tables.find(t => t.id === table)
  assert.equal(card.cleanedAt > closed.closedAt, true, 'метка уборки от нового цикла')
})

test('одновременные нажатия с одним ключом дают одну позицию', async () => {
  // Последовательные повторы схлопывались и раньше, а семь ОДНОВРЕМЕННЫХ
  // создавали семь позиций: проверка ключа и запись в кеш происходили в разные
  // моменты, и соседние запросы успевали проскочить между ними. На дохлой
  // мобильной сети ретрай-шторм выставлял гостю счёт за семь одинаковых блюд.
  const table = freshTable()
  const { guest } = await joinGuest(table)

  const rapid = await Promise.all(
    Array.from({ length: 7 }, () =>
      post(table, 'lines', { dishId: 'steak', qty: 1, idemKey: 'одна-порция' }, { guest })
    )
  )
  assert.equal(rapid.every(r => r.status === 200), true, 'каждый ответ спокойный')

  const bodies = await Promise.all(rapid.map(r => r.json()))
  const uids = new Set(bodies.map(b => b.uid))
  assert.equal(uids.size, 1, 'все семь получили один и тот же uid')

  const snap = await snapshot(table)
  assert.equal(snap.lines.length, 1)
  assert.equal(snap.totals.draftTotal, 1290, 'счёт за одну порцию, а не за семь')
})

test('кривой ключ отклоняется, а не выбрасывается молча', async () => {
  // Ключ длиной в тысячу символов раньше просто не считался ключом: запрос
  // проходил, а защита от двойного нажатия исчезала незаметно для клиента.
  const table = freshTable()
  const { guest } = await joinGuest(table)

  const huge = await post(table, 'lines', { dishId: 'fries', idemKey: 'x'.repeat(500) }, { guest })
  assert.equal(huge.status, 400)
  assert.equal((await huge.json()).error, 'bad idemKey')

  // Без ключа заказ проходит: это осознанный отказ от защиты, а не ошибка
  const plain = await post(table, 'lines', { dishId: 'fries' }, { guest })
  assert.equal(plain.status, 200)
})

test('кривой запрос не роняет сервер', async () => {
  // Разбор адреса стоял снаружи try/catch: запрос без заголовка Host убивал
  // процесс целиком. Ресторан переставал работать от одного плохого запроса,
  // а всё, что было в полёте, повисало навсегда — повар жал «Унёс гостю»
  // и кнопка гасла до конца смены.
  const raw = await new Promise((resolve, reject) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => {
      // HTTP/1.0 без Host — так ходят старые прокси и сканеры портов
      socket.write('GET / HTTP/1.0\r\n\r\n')
    })
    let data = ''
    socket.on('data', chunk => (data += chunk))
    socket.on('end', () => resolve(data))
    socket.on('error', reject)
    setTimeout(() => resolve(data), 2000)
  })
  assert.equal(String(raw).length > 0, true, 'сервер ответил, а не умер')

  // И главное: он жив после этого
  const alive = await fetch(`${base}/api/menu`)
  assert.equal(alive.status, 200, 'смена продолжается')
})

// --- Четвёртый круг: что нашли глаза гостя ---

test('способ оплаты сохраняется тот, который выбрал гость', async () => {
  // На экране был выбран T-Pay, а в платеже оседало «СБП»: способ выбирали
  // и не отправляли. Свести кассу по способам вечером было нечем.
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'espresso' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'm-1', method: 'tpay' }, { guest })

  const snap = await snapshot(table)
  assert.equal(snap.payments[0].method, 'tpay')

  // Чужое слово в способе не проходит: платёж не может ссылаться на выдумку
  const other = freshTable()
  const g2 = await joinGuest(other)
  await post(other, 'lines', { dishId: 'espresso' }, { guest: g2.guest })
  await post(other, 'send', { scope: 'mine' }, { guest: g2.guest })
  await post(other, 'pay', { scope: 'full', idemKey: 'm-2', method: 'bitcoin' }, { guest: g2.guest })
  assert.equal((await snapshot(other)).payments[0].method, 'sbp')
})

test('гость может передумать платить наличными', async () => {
  // Просьба была билетом в один конец: официант шёл за деньгами, которых
  // уже не ждут, а снять её мог только персонал.
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'espresso' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'cashIntent', { scope: 'full' }, { guest })
  assert.equal((await snapshot(table)).cashIntent.amount > 0, true)

  assert.equal((await post(table, 'cancelCash', {}, { guest })).status, 200)
  assert.equal((await snapshot(table)).cashIntent, null)

  // Отменять нечего — говорим об этом, а не делаем вид, что сработало
  assert.equal((await post(table, 'cancelCash', {}, { guest })).status, 409)
})

test('просьба о наличных снимается, когда счёт закрыт телефоном', async () => {
  // Гость попросил наличными, потом расплатился по СБП — жёлтая карточка
  // продолжала висеть, и официант шёл к рассчитавшемуся столу за купюрами.
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'espresso' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'cashIntent', { scope: 'full' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'ci-1' }, { guest })

  assert.equal((await snapshot(table)).cashIntent, null, 'долга нет — и просьбы нет')
})

test('чужую просьбу о наличных снять нельзя', async () => {
  const table = freshTable()
  const a = await joinGuest(table, 'Аня', 'fox')
  const b = await joinGuest(table, 'Боря', 'bear')
  await post(table, 'lines', { dishId: 'espresso' }, { guest: a.guest })
  await post(table, 'send', { scope: 'all' }, { guest: a.guest })
  await post(table, 'cashIntent', { scope: 'own' }, { guest: a.guest })

  assert.equal((await post(table, 'cancelCash', {}, { guest: b.guest })).status, 403)
  assert.equal((await snapshot(table)).cashIntent !== null, true)
})

test('в чеке видно, за какой именно вариант блюда списаны деньги', async () => {
  // «Красное сухое — 2 800 ₽» без слова «бутылка» гость перепроверить не может
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'wine-red', options: { volume: 'Бутылка 750 мл' } }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })
  const res = await post(table, 'pay', { scope: 'full', idemKey: 'r-1' }, { guest })
  const { receipt } = await res.json()

  assert.equal(receipt.lines[0].options.volume, 'Бутылка 750 мл')
  assert.equal(receipt.lines[0].price, 2800, 'цена варианта, а не базовая цена бокала')
})

test('чужая просьба о наличных не затирается молча', async () => {
  // Аня просила наличными, Боря просил следом — ячейка была одна на стол.
  // У Ани баннер исчезал, её «передумал» отвечал 403, а официант приходил
  // с одной суммой на двоих.
  const table = freshTable()
  const a = await joinGuest(table, 'Аня', 'fox')
  const b = await joinGuest(table, 'Боря', 'bear')
  await post(table, 'lines', { dishId: 'espresso' }, { guest: a.guest })
  await post(table, 'lines', { dishId: 'espresso' }, { guest: b.guest })
  await post(table, 'send', { scope: 'all' }, { guest: a.guest })

  assert.equal((await post(table, 'cashIntent', { scope: 'own' }, { guest: a.guest })).status, 200)
  const second = await post(table, 'cashIntent', { scope: 'own' }, { guest: b.guest })
  assert.equal(second.status, 409)
  assert.equal((await second.json()).error, 'cash request pending')

  // Просьба Ани на месте, и она всё ещё её хозяйка
  assert.equal((await snapshot(table)).cashIntent.personaId, a.personaId)
  assert.equal((await post(table, 'cancelCash', {}, { guest: a.guest })).status, 200)
})

test('сумма просьбы о наличных живая, а не замороженная', async () => {
  // Гость просил принять 360 ₽, сосед доплачивал, пока официант шёл, — и
  // на экране висела старая сумма, а списывалась актуальная.
  const table = freshTable()
  const a = await joinGuest(table, 'Аня', 'fox')
  const b = await joinGuest(table, 'Боря', 'bear')
  await post(table, 'lines', { dishId: 'espresso' }, { guest: a.guest }) // 180
  await post(table, 'lines', { dishId: 'espresso' }, { guest: b.guest }) // 180
  await post(table, 'send', { scope: 'all' }, { guest: a.guest })

  await post(table, 'cashIntent', { scope: 'full' }, { guest: a.guest })
  assert.equal((await snapshot(table)).cashIntent.amount, 360)

  // Боря платит за себя телефоном — официанту остаётся забрать меньше
  await post(table, 'pay', { scope: 'own', idemKey: 'live-1' }, { guest: b.guest })
  assert.equal((await snapshot(table)).cashIntent.amount, 180, 'просьба пересчиталась')
})

test('ключ идемпотентности проверяется только там, где он нужен', async () => {
  // Проверка стояла на всех действиях подряд, и явный idemKey: null от
  // стороннего клиента ломал закрытие стола и подачу блюда.
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'espresso' }, { guest })
  await post(table, 'send', { scope: 'mine' }, { guest })

  const snap = await snapshot(table)
  const uid = snap.lines[0].uid
  const started = await post(table, 'start', { uid, sessionId: snap.sessionId, idemKey: null }, { staff: TOKEN })
  assert.equal(started.status, 200, 'персоналу ключ не нужен и мешать не должен')

  // А там, где ключ работает, кривой ключ по-прежнему отвергается
  const bad = await post(table, 'lines', { dishId: 'espresso', idemKey: {} }, { guest })
  assert.equal(bad.status, 400)
})

test('переплату можно вернуть, и она уходит из долга заведения', async () => {
  // Домен считал overpaid и показывал её в сводке смены, но отдать деньги
  // было нечем: управляющая видела «вернуть гостям 640 ₽» и не могла закрыть
  // этот долг в системе.
  const table = freshTable()
  const { guest } = await joinGuest(table)
  await post(table, 'lines', { dishId: 'steak' }, { guest }) // 1290
  await post(table, 'send', { scope: 'mine' }, { guest })
  await post(table, 'pay', { scope: 'full', idemKey: 'ref-1' }, { guest })

  // Блюдо снимают уже после оплаты — гость заплатил за то, чего не получил
  const snap = await snapshot(table)
  await staffAt(table, 'close', { force: true })

  const closed = await snapshot(table)
  const over = closed.totals.toRefund ?? 0
  if (over <= 0.01) {
    // Переплаты не возникло — возвращать нечего, и сервер обязан это сказать
    assert.equal((await staffAt(table, 'refund', {})).status, 409)
    return
  }

  const res = await staffAt(table, 'refund', {})
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.amount, over, 'вернули ровно переплату')
  assert.equal(body.left, 0, 'долга заведения не осталось')

  // Повторный возврат по пустой переплате отвергается
  assert.equal((await staffAt(table, 'refund', {})).status, 409)
  void snap
})
