import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Аллергия по дороге на кухню — главная находка пятой смены. Сервер знал
 * аллергии гостя, но тикет повара нёс только аллергены блюда: гостье с
 * лактозой жарили рибай на сливочном масле, не зная о ней. Общее блюдо не
 * проверялось на аллергии соседей, а аллергия строкой молча терялась.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'allergy-kitchen-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'allergy-kitchen-master'
let seq = 0
const fresh = () => `ak${Date.now().toString(36)}${seq++}`

function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const kitchen = () => fetch(`${base}/api/kitchen`, { headers: { 'x-staff-token': M } }).then(r => r.json())

async function join(table: string, name: string, allergies?: unknown) {
  const res = await post(`/api/t/${table}/join`, { name, animal: 'fox', idemKey: fresh(), ...(allergies !== undefined ? { allergies } : {}) })
  return { res, body: await res.json() }
}

test('аллергия строкой, а не списком — отказ, а не гость без защиты', async () => {
  const { res, body } = await join(fresh(), 'Марина', 'лактоза')
  assert.equal(res.status, 400)
  assert.equal(body.error, 'allergies must be a list')
})

test('тикет кухни несёт аллергию гостя и отмечает подтверждённый риск', async () => {
  const table = fresh()
  const marina = (await join(table, 'Марина', ['лактоза', 'орехи'])).body.guestToken
  // Эспрессо без аллергенов — аллергия всё равно видна повару
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: marina })
  // Брускетта с лактозой — гость подтвердил риск
  const warned = await post(`/api/t/${table}/lines`, { dishId: 'bruschetta' }, { guest: marina })
  assert.equal(warned.status, 409)
  await post(`/api/t/${table}/lines`, { dishId: 'bruschetta', confirmAllergen: true, comment: 'отдельной посудой' }, { guest: marina })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: marina })

  const k = await kitchen()
  const mine = k.tickets.filter((t: any) => t.tableId === table)
  const espresso = mine.find((t: any) => t.dishId === 'espresso')
  assert.deepEqual(espresso.guestAllergies, [{ name: 'Марина', allergies: ['лактоза', 'орехи'] }])
  assert.deepEqual(espresso.allergyHits, [])
  const bruschetta = mine.find((t: any) => t.dishId === 'bruschetta')
  assert.deepEqual(bruschetta.allergyHits, ['лактоза'], 'повар видит осознанный риск')
  assert.equal(bruschetta.comment, 'отдельной посудой')
})

test('общее блюдо проверяется на аллергии соседей и несёт их на кухню', async () => {
  const table = fresh()
  await join(table, 'Марина', ['лактоза'])
  const katya = (await join(table, 'Катя')).body.guestToken

  const blocked = await post(`/api/t/${table}/lines`, { dishId: 'bruschetta', shared: true }, { guest: katya })
  assert.equal(blocked.status, 409)
  const body = await blocked.json()
  assert.deepEqual(body.allergens, ['лактоза'])
  assert.deepEqual(body.people.map((p: any) => p.name), ['Марина'])

  // Своё блюдо Кати — не общее — аллергия соседки его не касается
  assert.equal((await post(`/api/t/${table}/lines`, { dishId: 'bruschetta' }, { guest: katya })).status, 200)

  await post(`/api/t/${table}/lines`, { dishId: 'bruschetta', shared: true, confirmAllergen: true }, { guest: katya })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: katya })
  const shared = (await kitchen()).tickets.find((t: any) => t.tableId === table && t.shared)
  assert.deepEqual(shared.sharedNames, ['Марина', 'Катя'])
  assert.deepEqual(shared.guestAllergies, [{ name: 'Марина', allergies: ['лактоза'] }])
  assert.deepEqual(shared.allergyHits, ['лактоза'])
})
