import test from 'node:test'
import assert from 'node:assert/strict'
import { can, homeRoute, ownsTable } from '@easypay/domain/roles'

process.env.EASYPAY_MANAGER_TOKEN = 'staff-test-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const MASTER = 'staff-test-master'
let seq = 0
const freshTable = () => `s${Date.now().toString(36)}${seq++}`

function post(path, body = {}, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}

const get = (path, token) => fetch(`${base}${path}`, token ? { headers: { 'x-staff-token': token } } : undefined)
// Снапшот стола отдаётся только своим: в тестах читаем персоналом
const snapshot = table => get(`/api/t/${table}`, MASTER).then(r => r.json())

async function login(pin) {
  const res = await post('/api/staff/login', { pin })
  return res.ok ? res.json() : null
}

/** Стол с одной отправленной позицией — на нём проверяем права. */
async function tableWithOrder(table = freshTable()) {
  const joined = await (await post(`/api/t/${table}/join`, { name: 'Аня', animal: 'fox', idemKey: table })).json()
  const guest = joined.guestToken
  await post(`/api/t/${table}/lines`, { dishId: 'tomyam' }, { guest })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest })
  const snap = await snapshot(table)
  return { table, guest, uid: snap.lines[0].uid, sessionId: snap.sessionId }
}

// --- Модель прав ---

test('роли различаются правами, а не только названием', () => {
  assert.equal(can('cook', 'kitchen'), true)
  assert.equal(can('cook', 'hall'), false)
  assert.equal(can('cook', 'close'), false)
  assert.equal(can('waiter', 'close'), true)
  assert.equal(can('waiter', 'reset'), false)
  assert.equal(can('manager', 'reset'), true)
  assert.equal(can(undefined, 'hall'), false)
})

test('повар начинает смену с кухни, остальные — с зала', () => {
  assert.equal(homeRoute('cook'), '#/kitchen')
  assert.equal(homeRoute('waiter'), '#/hall')
})

test('свои столы есть только у официанта', () => {
  const waiter = { id: 'max', name: 'Максим', role: 'waiter', tables: ['12', '13'] }
  assert.equal(ownsTable(waiter, '12'), true)
  assert.equal(ownsTable(waiter, 5), false)
  assert.equal(ownsTable({ id: 'boss', name: 'И', role: 'manager' }, '5'), true)
  assert.equal(ownsTable(null, '5'), false)
})

// --- Вход в смену ---

test('вход по PIN выдаёт сессию с ролью, неверный PIN — нет', async () => {
  assert.equal((await post('/api/staff/login', { pin: '0000' })).status, 401)
  assert.equal((await post('/api/staff/login', { pin: 'абвг' })).status, 401)

  const waiter = await login('1111')
  assert.equal(waiter.staff.role, 'waiter')
  assert.equal('pin' in waiter.staff, false)
  const me = await (await get('/api/staff/me', waiter.token)).json()
  assert.equal(me.staff.id, waiter.staff.id)
})

test('выход из смены гасит сессию', async () => {
  const cook = await login('4444')
  assert.equal((await get('/api/staff/me', cook.token)).status, 200)
  await post('/api/staff/logout', {}, { staff: cook.token })
  assert.equal((await get('/api/staff/me', cook.token)).status, 401)
})

test('владелец входит своим PIN и видит всё как менеджер', async () => {
  const owner = await login('7777')
  assert.equal(owner.staff.role, 'manager')
  assert.equal((await get('/api/hall', owner.token)).status, 200)
  assert.equal((await get('/api/kitchen', owner.token)).status, 200)
  assert.equal((await get('/api/log', owner.token)).status, 200)
})

// --- Права на экраны ---

test('повар видит кухню, но не зал; официант — оба', async () => {
  const cook = await login('4444')
  const waiter = await login('1111')

  assert.equal((await get('/api/kitchen', cook.token)).status, 200)
  assert.equal((await get('/api/hall', cook.token)).status, 403)
  assert.equal((await get('/api/hall', waiter.token)).status, 200)
  assert.equal((await get('/api/hall')).status, 401)
})

test('журнал смены — только менеджеру', async () => {
  const waiter = await login('1111')
  const manager = await login('9999')

  assert.equal((await get('/api/log', waiter.token)).status, 403)
  const log = await (await get('/api/log', manager.token)).json()
  assert.equal(Array.isArray(log.entries), true)
  assert.equal(log.entries.some(e => e.action === 'вошёл в смену'), true)
})

// --- Права на действия ---

test('официант работает только со своими столами', async () => {
  const max = await login('1111') // столы 12-15
  const olya = await login('2222') // столы 1-6

  const mine = await tableWithOrder('12')
  assert.equal(
    (await post(`/api/t/12/start`, { uid: mine.uid, sessionId: mine.sessionId }, { staff: max.token })).status,
    200
  )

  const foreign = await post(`/api/t/12/start`, { uid: mine.uid, sessionId: mine.sessionId }, { staff: olya.token })
  assert.equal(foreign.status, 403, 'чужой стол — не твоя ответственность')
  assert.equal((await foreign.json()).error, 'not your table')

  const foreignClose = await post(`/api/t/12/close`, { force: true }, { staff: olya.token })
  assert.equal(foreignClose.status, 403)

  await post(`/api/t/12/close`, { force: true }, { staff: max.token })
})

test('повар ведёт позицию на любом столе, но не закрывает и не сбрасывает', async () => {
  const { table, uid, sessionId } = await tableWithOrder()
  const cook = await login('4444')

  assert.equal((await post(`/api/t/${table}/start`, { uid, sessionId }, { staff: cook.token })).status, 200)
  assert.equal((await post(`/api/t/${table}/serve`, { uid, sessionId }, { staff: cook.token })).status, 200)
  assert.equal((await post(`/api/t/${table}/close`, {}, { staff: cook.token })).status, 403)
  assert.equal((await post(`/api/t/${table}/reset`, {}, { staff: cook.token })).status, 403)
})

test('официант принимает вызов и закрывает свой стол, но не сбрасывает демо', async () => {
  const { table, guest } = await tableWithOrder('15')
  const max = await login('1111')

  await post(`/api/t/${table}/call`, { reason: 'help' }, { guest })
  assert.equal((await post(`/api/t/${table}/ack`, {}, { staff: max.token })).status, 200)
  assert.equal((await post(`/api/t/${table}/reset`, {}, { staff: max.token })).status, 403)
  assert.equal((await post(`/api/t/${table}/close`, { force: true }, { staff: max.token })).status, 200)
})

test('сброс стола с долгом — тоже осознанное действие, а не чёрный ход', async () => {
  const { table } = await tableWithOrder()
  const manager = await login('9999')

  const refused = await post(`/api/t/${table}/reset`, {}, { staff: manager.token })
  assert.equal(refused.status, 409, 'иначе reset обходит защиту close от потери выручки')
  assert.equal((await refused.json()).error, 'unpaid')

  assert.equal((await post(`/api/t/${table}/reset`, { force: true }, { staff: manager.token })).status, 200)

  const other = await tableWithOrder()
  assert.equal((await post(`/api/t/${other.table}/reset`, { force: true }, { staff: MASTER })).status, 200)

  const hall = await (await get('/api/hall', manager.token)).json()
  // Еду не отдали — это не долг гостя, а списание с кухни: разные деньги,
  // и в отчётности смены они больше не свалены в одну кучу
  assert.equal(hall.shift.writtenOff > 0, true, 'снятое с кухни видно отдельной строкой')
  assert.equal(hall.shift.debt, 0, 'за неподанное гость ничего не должен')
})

test('чаевые адресуются официанту стола и копятся за смену', async () => {
  const table = '2' // стол Оли
  await post(`/api/t/${table}/reset`, {}, { staff: MASTER })
  const joined = await (await post(`/api/t/${table}/join`, { name: 'Гость', animal: 'owl', idemKey: 'tips-role' })).json()
  const guest = joined.guestToken
  await post(`/api/t/${table}/lines`, { dishId: 'lemonade' }, { guest })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest })
  await post(`/api/t/${table}/pay`, { scope: 'full', idemKey: 'tips-pay' }, { guest })
  await post(`/api/t/${table}/tip`, { amount: 100, idemKey: 'tips-tip' }, { guest })

  const snap = await snapshot(table)
  assert.equal(snap.waiter.name, 'Оля')
  assert.equal(snap.tips[0].waiterId, 'olya')

  const olya = await login('2222')
  const me = await (await get('/api/staff/me', olya.token)).json()
  assert.equal(me.shiftTips >= 100, true)

  const max = await login('1111')
  const maxMe = await (await get('/api/staff/me', max.token)).json()
  assert.equal(maxMe.shiftTips, 0, 'чужие чаевые не засчитываются')
})

test('две выручки смены подписаны по-разному и не спорят друг с другом', async () => {
  const manager = await login('9999')
  const hall = await (await get('/api/hall', manager.token)).json()

  // «Закрытые столы» — то, с чем сверяется реестр чеков
  assert.equal(hall.summary.closedRevenue, hall.shift.closedRevenue)
  // «За смену» включает ещё и оплаченное на открытых столах, поэтому не меньше
  assert.equal(hall.shift.revenue >= hall.shift.closedRevenue, true)
  assert.equal(hall.summary.shiftGuests, hall.shift.guests)
  assert.equal(hall.summary.shiftGuests >= 1, true)

  // Средний чек считается только по столам, где были деньги
  if (hall.shift.tablesWithRevenue > 0) {
    assert.equal(
      hall.summary.avgCheck,
      Math.round((hall.shift.closedRevenue / hall.shift.tablesWithRevenue) * 100) / 100
    )
  } else {
    assert.equal(hall.summary.avgCheck, null)
  }
})

test('счётчик гостей за смену не уменьшается после сброса стола', async () => {
  const manager = await login('9999')
  const table = freshTable()
  await post(`/api/t/${table}/join`, { name: 'Кто-то', animal: 'cat', idemKey: 'g1' })
  const before = (await (await get('/api/hall', manager.token)).json()).summary.shiftGuests
  await post(`/api/t/${table}/reset`, {}, { staff: manager.token })
  const after = (await (await get('/api/hall', manager.token)).json()).summary.shiftGuests
  assert.equal(after >= before, true)
})

// Последним: после серии неудач вход временно блокируется
test('подбор PIN упирается в ограничение попыток', async () => {
  let last = 200
  for (let i = 0; i < 8; i++) last = (await post('/api/staff/login', { pin: '0001' })).status
  assert.equal(last, 429)
  assert.equal((await post('/api/staff/login', { pin: '9999' })).status, 429)
})

test('промахи одного планшета не запирают вход всей смене', async () => {
  // В ресторане вся смена за одним роутером: раньше шесть опечаток новичка
  // перекрывали вход всем, включая управляющего.
  const tryLogin = (pin, device) =>
    fetch(`${base}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': device },
      body: JSON.stringify({ pin })
    })

  for (let i = 0; i < 6; i++) {
    const res = await tryLogin('0000', 'planshet-novichka')
    assert.equal(res.status === 401 || res.status === 429, true)
  }

  const locked = await tryLogin('9999', 'planshet-novichka')
  assert.equal(locked.status, 429, 'провинившееся устройство заблокировано')
  const body = await locked.json()
  assert.equal(typeof body.retryAfterSec, 'number', 'человек видит, сколько ждать')

  const other = await tryLogin('9999', 'telefon-upravlyayushchey')
  assert.equal(other.status, 200, 'другое устройство входит как ни в чём не бывало')
})
