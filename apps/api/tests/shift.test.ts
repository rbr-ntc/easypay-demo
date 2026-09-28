import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Смена как событие. Раньше смену нельзя было закрыть — на стенде жила одна
 * вечная смена, реестр копил всё с первого дня, а долг за закрытым столом
 * оставался числом без действия.
 *
 * Тесты идут по порядку и делят одну смену: так устроена реальная работа.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'shift-test-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'shift-test-master'
let seq = 0
const fresh = () => `sh${Date.now().toString(36)}${seq++}`

function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const get = (path: string) => fetch(`${base}${path}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
const snap = (table: string) => get(`/api/t/${table}`)

/** Стол с одной отправленной и поданной позицией. */
async function tableWith(dishId: string, opts: { pay?: 'own' | null } = {}) {
  const table = fresh()
  const j = await (await post(`/api/t/${table}/join`, { name: 'Аня', animal: 'fox', idemKey: table })).json()
  const guest = j.guestToken
  assert.ok(guest, 'гость сел')
  await post(`/api/t/${table}/lines`, { dishId }, { guest })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest })
  const s = await snap(table)
  const uid = s.lines[0].uid
  await post(`/api/t/${table}/start`, { uid, sessionId: s.sessionId }, { staff: M })
  await post(`/api/t/${table}/serve`, { uid, sessionId: s.sessionId }, { staff: M })
  if (opts.pay) await post(`/api/t/${table}/pay`, { scope: opts.pay, idemKey: `${table}-pay`, method: 'sbp' }, { guest })
  return { table, guest, sessionId: s.sessionId as string }
}

test('X-отчёт: выручка по способам, открытые столы — в блокерах закрытия', async () => {
  // Гость платит с телефона — СБП; наличные идут только через официанта
  const paid = await tableWith('espresso', { pay: 'own' }) // 180 ₽
  await post(`/api/t/${paid.table}/close`, { sessionId: paid.sessionId }, { staff: M })

  const state = await get('/api/shift')
  assert.ok(state.shift, 'смена открыта с запуска')
  assert.ok(state.report.byMethod.sbp >= 180)
  assert.ok(state.report.revenue >= 180)
  assert.equal(typeof state.cash.system, 'number')
})

test('нерешённый долг не даёт закрыть смену; взыскание снимает блок', async () => {
  const debtor = await tableWith('borsch') // 490 ₽, не платили
  const closed = await post(`/api/t/${debtor.table}/close`, { force: true, sessionId: debtor.sessionId }, { staff: M })
  assert.equal(closed.status, 200)

  const q = await get('/api/decisions')
  const item = q.open.find((i: any) => i.sessionId === debtor.sessionId)
  assert.ok(item, 'долг — в очереди «требует решения»')
  assert.equal(item.amount, 490)

  const state = await get('/api/shift')
  const blocked = await post('/api/shift/close', { cashCounted: state.cash.system }, { staff: M })
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error, 'debts unresolved')

  const noMethod = await post('/api/decisions/settle', { sessionId: debtor.sessionId, kind: 'collected' }, { staff: M })
  assert.equal(noMethod.status, 400, 'взыскание — только с указанием способа')

  const ok = await post('/api/decisions/settle', { sessionId: debtor.sessionId, kind: 'collected', method: 'transfer', amount: 1 }, { staff: M })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).settlement.amount, 490, 'сумму решает сервер, а не запрос')

  const again = await post('/api/decisions/settle', { sessionId: debtor.sessionId, kind: 'written_off' }, { staff: M })
  assert.equal(again.status, 409, 'второй раз один долг не решается')

  const after = await get('/api/decisions')
  assert.equal(after.open.some((i: any) => i.sessionId === debtor.sessionId), false)
  assert.ok(after.done.some((d: any) => String(d.text).includes('Взыскано')))
})

test('расхождение кассы — только с комментарием', async () => {
  const state = await get('/api/shift')
  const noNote = await post('/api/shift/close', { cashCounted: state.cash.system + 300 }, { staff: M })
  assert.equal(noNote.status, 409)
  assert.equal((await noNote.json()).error, 'note required')

  const noCount = await post('/api/shift/close', {}, { staff: M })
  assert.equal(noCount.status, 400, 'без пересчёта кассы смену не закрыть')
})

test('закрытие: Z-отчёт заморожен, открытый стол перенесён, новые столы не открываются', async () => {
  const carried = await tableWith('lemonade') // остаётся открытым — перенос
  const state = await get('/api/shift')
  assert.ok(state.blockers.some((b: any) => b.tableId === carried.table))

  const res = await post('/api/shift/close', { cashCounted: state.cash.system + 300, note: 'лишние триста, разбираемся' }, { staff: M })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.z.cash.diff, 300)
  assert.ok(body.z.carried.some((c: any) => c.tableId === carried.table), 'открытый стол ушёл в перенос')

  // Смена закрыта: новый стол не открыть…
  const blocked = await post(`/api/t/${fresh()}/join`, { name: 'Вера', animal: 'owl', idemKey: fresh() })
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error, 'shift closed')
  // …а перенесённый работает: гостя за столом не выгоняют посреди ужина
  const more = await post(`/api/t/${carried.table}/lines`, { dishId: 'espresso' }, { guest: carried.guest })
  assert.equal(more.status, 200)

  const hist = await get('/api/shifts')
  assert.equal(hist.current, null)
  assert.equal(hist.history[0].summary.diff, 300)
  const card = await get(`/api/shifts/${hist.history[0].id}`)
  assert.equal(card.z.cash.note, 'лишние триста, разбираемся')
})

test('открытие смены: перенесённый стол переходит в неё, заказы снова принимаются', async () => {
  const opened = await post('/api/shift/open', {}, { staff: M })
  assert.equal(opened.status, 200)

  const table = fresh()
  const join = await post(`/api/t/${table}/join`, { name: 'Вера', animal: 'owl', idemKey: table })
  assert.equal(join.status, 200)

  const state = await get('/api/shift')
  assert.ok(state.blockers.length >= 2, 'перенесённый и новый стол — в новой смене')

  const checks = await get('/api/checks')
  assert.ok(checks.checks.some((c: any) => c.closedAt === null), 'реестр показывает и открытые столы')
})

test('кабинет — только менеджеру', async () => {
  const cook = await (await post('/api/staff/login', { pin: '4444' })).json()
  const res = await fetch(`${base}/api/shift`, { headers: { 'x-staff-token': cook.token } })
  assert.equal(res.status, 403)
  const anon = await fetch(`${base}/api/decisions`)
  assert.equal(anon.status, 401)
})

test('перенесённый стол не попадает в выручку двух смен; деньги между сменами — в следующую', async () => {
  // Гость заплатил вечером и остался сидеть — стол переносится
  const late = await tableWith('espresso', { pay: 'own' }) // 180 ₽ по СБП
  let state = await get('/api/shift')
  const closed = await post('/api/shift/close', { cashCounted: state.cash.system }, { staff: M })
  assert.equal(closed.status, 200)
  assert.ok((await closed.json()).z.report.byMethod.sbp >= 180, 'вечерние деньги — в Z-отчёте закрытой смены')

  // Пока смены нет, гость дозаказал и заплатил, стол закрыли
  await post(`/api/t/${late.table}/lines`, { dishId: 'lemonade' }, { guest: late.guest })
  await post(`/api/t/${late.table}/send`, { scope: 'mine' }, { guest: late.guest })
  const snap = await get(`/api/t/${late.table}`)
  const uid = snap.lines.find((l: any) => l.dishId === 'lemonade').uid
  await post(`/api/t/${late.table}/start`, { uid, sessionId: snap.sessionId }, { staff: M })
  await post(`/api/t/${late.table}/serve`, { uid, sessionId: snap.sessionId }, { staff: M })
  const paid = await post(`/api/t/${late.table}/pay`, { scope: 'own', idemKey: `${late.table}-late`, method: 'sbp' }, { guest: late.guest })
  assert.equal(paid.status, 200)
  const lemonade = (await paid.json()).amount ?? snap.lines.find((l: any) => l.dishId === 'lemonade').price
  await post(`/api/t/${late.table}/close`, { sessionId: snap.sessionId }, { staff: M })

  assert.equal((await post('/api/shift/open', {}, { staff: M })).status, 200)
  state = await get('/api/shift')
  const sbp = state.report.byMethod.sbp
  assert.ok(sbp >= lemonade, 'деньги, пришедшие между сменами, не потерялись')
  assert.ok(sbp < lemonade + 180, 'а вчерашние 180 ₽ второй раз не посчитаны')
})

test('двойной тап «Взыскано»: долг записывается один раз', async () => {
  const debtor = await tableWith('borsch')
  await post(`/api/t/${debtor.table}/close`, { force: true, sessionId: debtor.sessionId }, { staff: M })
  const both = await Promise.all([
    post('/api/decisions/settle', { sessionId: debtor.sessionId, kind: 'collected', method: 'cash' }, { staff: M }),
    post('/api/decisions/settle', { sessionId: debtor.sessionId, kind: 'collected', method: 'cash' }, { staff: M })
  ])
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409])
  const q = await get('/api/decisions')
  assert.equal(q.done.filter((d: any) => d.tableId === debtor.table).length, 1)
})
