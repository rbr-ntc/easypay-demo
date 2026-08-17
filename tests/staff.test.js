import test from 'node:test'
import assert from 'node:assert/strict'
import { can, homeRoute, ownsTable } from '../shared/roles.js'

process.env.EASYPAY_MANAGER_TOKEN = 'staff-test-master'
const { createServer } = await import('../server/index.mjs')

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

function post(path, body = {}, token) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-staff-token': token } : {}) },
    body: JSON.stringify(body)
  })
}

const get = (path, token) => fetch(`${base}${path}`, token ? { headers: { 'x-staff-token': token } } : undefined)

async function login(pin) {
  const res = await post('/api/staff/login', { pin })
  if (!res.ok) return null
  return res.json()
}

/** Стол с одной отправленной позицией — на нём проверяем права. */
async function tableWithOrder() {
  const table = freshTable()
  const joined = await post(`/api/t/${table}/join`, { name: 'Аня', animal: 'fox', idemKey: `${table}` })
  const { personaId } = await joined.json()
  await post(`/api/t/${table}/lines`, { personaId, dishId: 'tomyam', qty: 1 })
  await post(`/api/t/${table}/send`, { personaId, scope: 'mine' })
  const snap = await (await get(`/api/t/${table}`)).json()
  return { table, personaId, uid: snap.lines[0].uid }
}

// --- Модель прав ---

test('роли различаются правами, а не только названием', () => {
  assert.equal(can('cook', 'kitchen'), true)
  assert.equal(can('cook', 'hall'), false)
  assert.equal(can('cook', 'close'), false)
  assert.equal(can('waiter', 'close'), true)
  assert.equal(can('waiter', 'reset'), false)
  assert.equal(can('waiter', 'log'), false)
  assert.equal(can('manager', 'reset'), true)
  assert.equal(can('manager', 'log'), true)
  assert.equal(can(undefined, 'hall'), false)
})

test('повар начинает смену с кухни, остальные — с зала', () => {
  assert.equal(homeRoute('cook'), '#/kitchen')
  assert.equal(homeRoute('waiter'), '#/hall')
  assert.equal(homeRoute('manager'), '#/hall')
})

test('свои столы есть только у официанта', () => {
  const waiter = { id: 'max', name: 'Максим', role: 'waiter', tables: ['12', '13'] }
  assert.equal(ownsTable(waiter, '12'), true)
  assert.equal(ownsTable(waiter, 5), false)
  assert.equal(ownsTable({ id: 'boss', name: 'И', role: 'manager' }, '5'), true, 'менеджеру принадлежит весь зал')
  assert.equal(ownsTable(null, '5'), false)
})

// --- Вход в смену ---

test('вход по PIN выдаёт сессию с ролью, неверный PIN — нет', () => {
  return (async () => {
    assert.equal((await post('/api/staff/login', { pin: '0000' })).status, 401)
    assert.equal((await post('/api/staff/login', { pin: 'абвг' })).status, 401)

    const waiter = await login('1111')
    assert.equal(waiter.staff.role, 'waiter')
    assert.equal(waiter.staff.name.length > 0, true)
    assert.equal(waiter.token.length > 10, true)
    assert.equal('pin' in waiter.staff, false, 'PIN наружу не уходит')

    const me = await (await get('/api/staff/me', waiter.token)).json()
    assert.equal(me.staff.id, waiter.staff.id)
  })()
})

test('выход из смены гасит сессию', async () => {
  const cook = await login('4444')
  assert.equal((await get('/api/staff/me', cook.token)).status, 200)
  await post('/api/staff/logout', {}, cook.token)
  assert.equal((await get('/api/staff/me', cook.token)).status, 401)
})

// --- Права на экраны ---

test('повар видит кухню, но не зал; официант — оба', async () => {
  const cook = await login('4444')
  const waiter = await login('1111')

  assert.equal((await get('/api/kitchen', cook.token)).status, 200)
  assert.equal((await get('/api/hall', cook.token)).status, 403)
  assert.equal((await get('/api/hall', waiter.token)).status, 200)
  assert.equal((await get('/api/kitchen', waiter.token)).status, 200)
  assert.equal((await get('/api/hall')).status, 401, 'без сессии — вход')
})

test('журнал смены — только менеджеру', async () => {
  const waiter = await login('1111')
  const manager = await login('9999')

  assert.equal((await get('/api/log', waiter.token)).status, 403)
  const log = await (await get('/api/log', manager.token)).json()
  assert.equal(Array.isArray(log.entries), true)
  assert.equal(
    log.entries.some(e => e.action === 'вошёл в смену'),
    true,
    'вход в смену попадает в журнал'
  )
})

// --- Права на действия ---

test('повар ведёт позицию, но не закрывает стол и не сбрасывает демо', async () => {
  const { table, uid } = await tableWithOrder()
  const cook = await login('4444')

  assert.equal((await post(`/api/t/${table}/start`, { uid }, cook.token)).status, 200)
  assert.equal((await post(`/api/t/${table}/serve`, { uid }, cook.token)).status, 200)
  assert.equal((await post(`/api/t/${table}/close`, {}, cook.token)).status, 403)
  assert.equal((await post(`/api/t/${table}/reset`, {}, cook.token)).status, 403)
})

test('официант закрывает стол и принимает вызов, но не сбрасывает демо', async () => {
  const { table, personaId } = await tableWithOrder()
  const waiter = await login('1111')

  await post(`/api/t/${table}/call`, { personaId, reason: 'help' })
  assert.equal((await post(`/api/t/${table}/ack`, {}, waiter.token)).status, 200)
  assert.equal((await post(`/api/t/${table}/reset`, {}, waiter.token)).status, 403)
  assert.equal((await post(`/api/t/${table}/close`, {}, waiter.token)).status, 200)
})

test('менеджеру можно всё, включая сброс', async () => {
  const { table } = await tableWithOrder()
  const manager = await login('9999')
  assert.equal((await post(`/api/t/${table}/reset`, {}, manager.token)).status, 200)
})

test('мастер-токен работает как менеджер — старые демо-ссылки живы', async () => {
  const { table } = await tableWithOrder()
  const res = await fetch(`${base}/api/t/${table}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-manager-token': MASTER },
    body: '{}'
  })
  assert.equal(res.status, 200)
})

test('чаевые адресуются официанту стола и копятся за смену', async () => {
  const table = '12' // закреплён за Максимом в src/staff.json
  const joined = await post(`/api/t/${table}/join`, { name: 'Гость', animal: 'owl', idemKey: 'tips-role' })
  const { personaId } = await joined.json()
  await post(`/api/t/${table}/lines`, { personaId, dishId: 'lemonade', qty: 1 })
  await post(`/api/t/${table}/pay`, { personaId, scope: 'full', idemKey: 'tips-role-pay' })
  await post(`/api/t/${table}/tip`, { personaId, amount: 100, idemKey: 'tips-role-tip' })

  const snap = await (await get(`/api/t/${table}`)).json()
  assert.equal(snap.waiter.name, 'Максим', 'гость видит своего официанта')
  assert.equal(snap.tips[0].waiterId, 'max')

  const waiter = await login('1111')
  const me = await (await get('/api/staff/me', waiter.token)).json()
  assert.equal(me.shiftTips >= 100, true, 'чаевые попали в смену официанта')

  const other = await login('2222')
  const otherMe = await (await get('/api/staff/me', other.token)).json()
  assert.equal(otherMe.shiftTips, 0, 'чужие чаевые не засчитываются')
})

// Последним: после серии неудач вход временно блокируется
test('подбор PIN упирается в ограничение попыток', async () => {
  let last = 200
  for (let i = 0; i < 8; i++) last = (await post('/api/staff/login', { pin: '0001' })).status
  assert.equal(last, 429)
  assert.equal((await post('/api/staff/login', { pin: '9999' })).status, 429, 'блокировка не разбирает, чей PIN')
})
