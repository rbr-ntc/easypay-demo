import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Конструктор меню. Раньше меню жило в menu.json: новое блюдо или цена —
 * только правкой файла и деплоем. Теперь менеджер правит черновик, а
 * публикация строго проверяет меню и сразу доходит до гостей и кухни.
 *
 * Тесты идут по порядку и делят одно меню — как в жизни.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'menu-test-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'menu-test-master'
let seq = 0
const fresh = () => `mn${Date.now().toString(36)}${seq++}`

function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const get = (path: string, staff = M) => fetch(`${base}${path}`, { headers: { 'x-staff-token': staff } }).then(r => r.json())

async function guestAt(table: string) {
  const joined = await (await post(`/api/t/${table}/join`, { name: 'Аня', animal: 'fox', idemKey: table })).json()
  return joined.guestToken as string
}

test('гость получает опубликованное меню без входа', async () => {
  const live = await (await fetch(`${base}/api/menu/live`)).json()
  assert.equal(live.version, 1, 'пока ничего не публиковали — меню из файла')
  assert.ok(live.categories.length > 3)
  assert.ok(live.categories[0].dishes.some((d: any) => d.id === 'bruschetta'))
  assert.ok(Array.isArray(live.stop))
})

test('черновик и публикация — только менеджеру', async () => {
  const cook = await (await post('/api/staff/login', { pin: '4444' })).json()
  const res = await post('/api/menu/draft', { categories: [] }, { staff: cook.token })
  assert.equal(res.status, 403)
  const anon = await post('/api/menu/publish')
  assert.equal(anon.status, 401)
})

test('без заявленных аллергенов блюдо не публикуется; черновик — сохраняется', async () => {
  const { published } = await get('/api/menu/editor')
  const draft = structuredClone(published.categories)
  draft[0].dishes.push({ id: 'new-toast', name: 'Тост с авокадо', desc: '', price: 420 })
  const saved = await post('/api/menu/draft', { categories: draft }, { staff: M })
  assert.equal(saved.status, 200, 'недописанное блюдо в черновике — можно')

  const bad = await post('/api/menu/publish', {}, { staff: M })
  assert.equal(bad.status, 409)
  const body = await bad.json()
  assert.equal(body.error, 'menu invalid')
  assert.ok(body.details.some((d: string) => d.includes('new-toast')))

  const live = await (await fetch(`${base}/api/menu/live`)).json()
  assert.equal(live.version, 1, 'гость черновик не видит')
})

test('публикация: новая цена и новое блюдо — сразу у гостя; снятое не заказать, но старый счёт его помнит', async () => {
  // Гость успел заказать брускетту до того, как её сняли
  const table = fresh()
  const guest = await guestAt(table)
  assert.equal((await post(`/api/t/${table}/lines`, { dishId: 'bruschetta' }, { guest })).status, 200)

  const { published } = await get('/api/menu/editor')
  const cats = structuredClone(published.categories)
  cats[0].dishes = cats[0].dishes.filter((d: any) => d.id !== 'bruschetta')
  cats[0].dishes.push({ id: 'new-toast', name: 'Тост с авокадо', desc: 'Ржаной хлеб, авокадо', price: 420, allergens: ['глютен'] })
  cats[1].dishes[0].price = 999
  const priced = cats[1].dishes[0].id
  assert.equal((await post('/api/menu/draft', { categories: cats }, { staff: M })).status, 200)

  const ok = await post('/api/menu/publish', {}, { staff: M })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).version, 2)

  const live = await (await fetch(`${base}/api/menu/live`)).json()
  assert.equal(live.version, 2)
  assert.equal(live.categories[1].dishes[0].price, 999)

  const added = await post(`/api/t/${table}/lines`, { dishId: 'new-toast' }, { guest })
  assert.equal(added.status, 200, 'новое блюдо заказывается')
  const gone = await post(`/api/t/${table}/lines`, { dishId: 'bruschetta' }, { guest })
  assert.equal(gone.status, 400, 'снятое — нет')
  const repriced = await post(`/api/t/${table}/lines`, { dishId: priced }, { guest })
  assert.equal(repriced.status, 200)

  const snap = await get(`/api/t/${table}`)
  assert.equal(snap.menuVersion, 2, 'снимок несёт версию — клиент перечитает меню')
  const old = snap.lines.find((l: any) => l.dishId === 'bruschetta')
  assert.ok(old, 'заказанная до публикации позиция осталась')
  assert.equal(old.price, 490, 'цена зафиксирована в строке счёта')
  assert.equal(snap.lines.find((l: any) => l.dishId === priced).price, 999)

  const editor = await get('/api/menu/editor')
  assert.equal(editor.draft, null, 'после публикации черновик пуст')
})

test('фото блюда: хранится на сервере и отдаётся с вечным кэшем', async () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)])
  const res = await fetch(`${base}/api/menu/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'x-staff-token': M },
    body: bytes
  })
  assert.equal(res.status, 200)
  const { url } = await res.json()
  assert.match(url, /^\/api\/menu\/photo\/[0-9a-f-]{36}$/)

  const back = await fetch(`${base}${url}`)
  assert.equal(back.status, 200)
  assert.equal(back.headers.get('content-type'), 'image/jpeg')
  assert.match(back.headers.get('cache-control') ?? '', /immutable/)
  assert.deepEqual(Buffer.from(await back.arrayBuffer()), bytes)

  const wrongType = await fetch(`${base}/api/menu/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/html', 'x-staff-token': M },
    body: '<script>'
  })
  assert.equal(wrongType.status, 415)

  const tooBig = await fetch(`${base}/api/menu/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'x-staff-token': M },
    body: Buffer.alloc(500 * 1024, 1)
  })
  assert.equal(tooBig.status, 413)
})

test('фото из чужого адреса в меню не попадёт', async () => {
  const { published } = await get('/api/menu/editor')
  const cats = structuredClone(published.categories)
  cats[0].dishes[0].photoUrl = 'https://evil.example/x.jpg'
  await post('/api/menu/draft', { categories: cats }, { staff: M })
  const { draft } = await get('/api/menu/editor')
  assert.equal(draft.categories[0].dishes[0].photoUrl, undefined)
  await post('/api/menu/discard', {}, { staff: M })
  assert.equal((await get('/api/menu/editor')).draft, null)
})

test('поля блюда проверяются строго: цех, флаги, надбавки, аллергенные эффекты', async () => {
  const { published } = await get('/api/menu/editor')
  const cats = structuredClone(published.categories)
  const d = cats[0].dishes[0]
  Object.assign(d, {
    station: 'moon',
    stop: 'false',
    options: [{ id: 'size', name: 'Размер', choices: ['S', 'L'], priceDelta: { S: -999999, L: 100, X: 5 }, effects: { L: { adds: ['лактоза', 'кошки'] } } }]
  })
  await post('/api/menu/draft', { categories: cats }, { staff: M })
  const { draft } = await get('/api/menu/editor')
  const saved = draft.categories[0].dishes[0]
  assert.equal(saved.station, undefined, 'незнакомый цех не сохраняется')
  assert.equal(saved.stop, undefined, 'строка "false" — не стоп')
  assert.deepEqual(saved.options[0].priceDelta, { S: -saved.price, L: 100 }, 'цена с надбавкой не уходит ниже нуля')
  assert.deepEqual(saved.options[0].effects, { L: { adds: ['лактоза'] } })
  await post('/api/menu/discard', {}, { staff: M })
})
