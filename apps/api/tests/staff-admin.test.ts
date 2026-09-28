import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Персонал из кабинета. Раньше сотрудники и PIN-коды жили в staff.json:
 * нового официанта нельзя было завести без разработчика, уволенный входил
 * по старому PIN, пока кто-нибудь не поправит файл и не передеплоит.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'staff-admin-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'staff-admin-master'
let device = 0

function post(path: string, body: object = {}, staff?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-device-id': `dev-${device++}` }
  if (staff) headers['x-staff-token'] = staff
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const get = (path: string, staff = M) => fetch(`${base}${path}`, { headers: { 'x-staff-token': staff } })
const login = (pin: string) => post('/api/staff/login', { pin })

test('новый официант получает PIN один раз и входит с закреплёнными столами', async () => {
  const res = await post('/api/staff/save', { name: 'Лиана', role: 'waiter', tables: ['3', '4', 'нет-такого'], phone: '+7 999 000-11-22' }, M)
  assert.equal(res.status, 200)
  const { id, pin } = await res.json()
  assert.match(pin, /^\d{4}$/)

  const list = await (await get('/api/staff/list')).json()
  const liana = list.staff.find((s: any) => s.id === id)
  assert.deepEqual(liana.tables, ['3', '4'], 'чужой стол не закрепляется')
  assert.equal(liana.pin, undefined, 'PIN в списке не показывается')

  const me = await login(pin)
  assert.equal(me.status, 200)
  const body = await me.json()
  assert.equal(body.staff.name, 'Лиана')
  assert.equal(body.staff.role, 'waiter')
})

test('смена PIN: старый больше не пускает, новый — пускает', async () => {
  const { staff } = await (await get('/api/staff/list')).json()
  const max = staff.find((s: any) => s.name === 'Максим')
  const res = await post('/api/staff/pin', { id: max.id }, M)
  const { pin } = await res.json()
  assert.notEqual(pin, '1111')
  assert.equal((await login('1111')).status, 401)
  assert.equal((await login(pin)).status, 200)
})

test('уволенного выкидывает из смены сразу; вернули — с новым PIN', async () => {
  const { staff } = await (await get('/api/staff/list')).json()
  const roma = staff.find((s: any) => s.name === 'Рома')
  const session = await (await login('3333')).json()
  assert.equal((await get('/api/hall', session.token)).status, 200)

  assert.equal((await post('/api/staff/active', { id: roma.id, active: false }, M)).status, 200)
  assert.equal((await get('/api/hall', session.token)).status, 401, 'сессия погашена')
  assert.equal((await login('3333')).status, 401, 'старый PIN не пускает')
  const roster = await (await get('/api/staff/roster')).json()
  assert.equal(roster.staff.some((s: any) => s.id === roma.id), false, 'в зале уволенного нет')

  const back = await (await post('/api/staff/active', { id: roma.id, active: true }, M)).json()
  assert.match(back.pin, /^\d{4}$/)
  assert.equal((await login(back.pin)).status, 200)
})

test('себя не уволить; последнего менеджера — тоже', async () => {
  const irina = await (await login('9999')).json()
  const self = await post('/api/staff/active', { id: 'boss', active: false }, irina.token)
  assert.equal(self.status, 409)
  assert.equal((await self.json()).error, 'cannot fire yourself')

  assert.equal((await post('/api/staff/active', { id: 'owner', active: false }, irina.token)).status, 200)
  const last = await post('/api/staff/active', { id: 'boss', active: false }, M)
  assert.equal(last.status, 409)
  assert.equal((await last.json()).error, 'last manager')
})

test('персонал — только менеджеру', async () => {
  const cook = await (await login('4444')).json()
  assert.equal((await get('/api/staff/list', cook.token)).status, 403)
  assert.equal((await post('/api/staff/save', { name: 'X', role: 'manager' }, cook.token)).status, 403)
})
