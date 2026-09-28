import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Пачка исправлений по смене агентов №6 (docs/prototype/shift-6-findings.md):
 * чек, врущий «ранее внесено», «своё» после чужого «поровну», фантомы в
 * журнале, стопка вызовов, корзина с аллергеном, токен в адресе.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'shift6-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`

test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'shift6-master'
let seq = 0
const fresh = () => `s6${Date.now().toString(36)}${seq++}`

function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const snapshot = (table: string, guest: string) => fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': guest } }).then(r => r.json())

async function join(table: string, name: string, allergies?: string[]) {
  const body = await (await post(`/api/t/${table}/join`, { name, animal: 'fox', idemKey: fresh(), ...(allergies ? { allergies } : {}) })).json()
  return body.guestToken as string
}
async function order(table: string, guest: string, dishId: string, extra: object = {}) {
  await post(`/api/t/${table}/lines`, { dishId, ...extra }, { guest })
  return post(`/api/t/${table}/send`, { scope: 'mine' }, { guest })
}

test('первая оплата не пишет в чеке «ранее внесено» (Д1)', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const body = await (await post(`/api/t/${table}/pay`, { scope: 'own', idemKey: fresh() }, { guest: g })).json()
  assert.equal(body.receipt.paidBeforeMine, 0)
  assert.equal(body.receipt.note, null)
})

test('после чужого «поровну» сервер не принимает «своё» (Д2)', async () => {
  const table = fresh()
  const anya = await join(table, 'Аня')
  const dima = await join(table, 'Дима')
  await order(table, anya, 'caesar')
  await order(table, dima, 'espresso')
  assert.equal((await post(`/api/t/${table}/pay`, { scope: 'equal', idemKey: fresh() }, { guest: anya })).status, 200)
  const own = await post(`/api/t/${table}/pay`, { scope: 'own', idemKey: fresh() }, { guest: dima })
  assert.equal(own.status, 409)
  assert.equal((await own.json()).error, 'equal split in progress')
  assert.equal((await post(`/api/t/${table}/pay`, { scope: 'equal', idemKey: fresh() }, { guest: dima })).status, 200)
  assert.equal((await snapshot(table, dima)).totals.remaining, 0, 'поровну закрывает стол без хвостов')
})

test('повтор оплаты после закрытия стола отдаёт чек, а не «стол закрыт» (Д3)', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const key = fresh()
  const first = await (await post(`/api/t/${table}/pay`, { scope: 'own', idemKey: key }, { guest: g })).json()
  assert.equal((await post(`/api/t/${table}/close`, { force: true }, { staff: M })).status, 200)
  const again = await post(`/api/t/${table}/pay`, { scope: 'own', idemKey: key }, { guest: g })
  assert.equal(again.status, 200)
  assert.equal((await again.json()).receipt.no, first.receipt.no)
})

test('чаевые в доли копейки — 400, и в журнале нет фантома (О3)', async () => {
  const table = fresh()
  const g = await join(table, 'Вторая')
  await order(table, g, 'espresso')
  const r = await post(`/api/t/${table}/tip`, { amount: 0.004, idemKey: fresh() }, { guest: g })
  assert.equal(r.status, 400)
  assert.equal((await post(`/api/t/${table}/tip`, { amount: '100', idemKey: fresh() }, { guest: g })).status, 400, 'строка — не число')
  const log = await fetch(`${base}/api/log`, { headers: { 'x-staff-token': M } }).then(x => x.json())
  assert.ok(!log.entries.some((e: any) => e.tableId === table && /чаев/.test(e.action)), 'отказ не оставляет следа в журнале')
})

test('повторные вызовы гостя копятся в одном (В1), ответ — только строкой (В3)', async () => {
  const table = fresh()
  const g = await join(table, 'Ломатель')
  const a = await (await post(`/api/t/${table}/call`, { reason: 'help' }, { guest: g })).json()
  await post(`/api/t/${table}/call`, { reason: 'water', note: 'воды' }, { guest: g })
  await post(`/api/t/${table}/call`, { reason: 'bill' }, { guest: g })
  const snap = await snapshot(table, g)
  assert.equal(snap.calls.length, 1)
  assert.equal(snap.calls[0].repeats, 3)
  assert.equal(snap.calls[0].reason, 'bill', 'счёт важнее «помогите»')
  assert.equal(snap.calls[0].note, 'воды')
  // Ответ не текстом — отказ, и вызов остаётся: иначе ответ пропадал, а вызов сгорал (смена №7)
  assert.equal((await post(`/api/t/${table}/ack`, { callId: a.callId, reply: { x: 1 } }, { staff: M })).status, 400)
  assert.equal((await snapshot(table, g)).calls.length, 1)
})

test('кривой callId не снимает чужой вызов (В4), повторный ack говорит, кто принял (В5)', async () => {
  const table = fresh()
  const g = await join(table, 'Настя')
  const { callId } = await (await post(`/api/t/${table}/call`, { reason: 'help' }, { guest: g })).json()
  assert.equal((await post(`/api/t/${table}/ack`, { callId: 12345 }, { staff: M })).status, 400)
  assert.equal((await snapshot(table, g)).calls.length, 1)
  await post(`/api/t/${table}/ack`, { callId }, { staff: M })
  const again = await post(`/api/t/${table}/ack`, { callId }, { staff: M })
  assert.equal(again.status, 409)
  assert.equal((await again.json()).error, 'already acked')
})

test('корзина с аллергеном, указанным позже, не уходит на кухню молча (А1)', async () => {
  const table = fresh()
  const g = await join(table, 'Марина')
  await post(`/api/t/${table}/lines`, { dishId: 'padthai' }, { guest: g })
  await post(`/api/t/${table}/allergies`, { allergies: ['арахис'] }, { guest: g })
  const send = await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
  assert.equal(send.status, 409)
  const body = await send.json()
  assert.equal(body.error, 'allergen warning')
  assert.deepEqual(body.lines[0].people[0].allergens, ['арахис'])
  assert.equal((await post(`/api/t/${table}/send`, { scope: 'mine', confirmAllergen: true }, { guest: g })).status, 200)
})

test('блюдо, снятое в стоп, пока лежало в корзине, не уходит на кухню (К1)', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await post(`/api/t/${table}/lines`, { dishId: 'napoleon' }, { guest: g })
  await post('/api/menu/stop', { dishId: 'napoleon', stop: true }, { staff: M })
  try {
    const send = await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
    assert.equal(send.status, 409)
    assert.equal((await send.json()).error, 'dish in stop list')
  } finally {
    await post('/api/menu/stop', { dishId: 'napoleon', stop: false }, { staff: M })
  }
})

test('токен персонала в адресе не открывает действия (Б6)', async () => {
  const table = fresh()
  await join(table, 'Глеб')
  const r = await fetch(`${base}/api/t/${table}/addSeat?token=${M}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(r.status, 401)
})

test('официант приставляет стул — третий гость садится за двухместный стол (З1)', async () => {
  const table = '13' // по плану зала — 2 места
  await post(`/api/t/${table}/reset`, { force: true }, { staff: M })
  await join(table, 'Аня')
  await join(table, 'Дима')
  const full = await post(`/api/t/${table}/join`, { name: 'Лёша', animal: 'fox', idemKey: fresh() })
  assert.equal(full.status, 400)
  assert.equal((await post(`/api/t/${table}/addSeat`, {}, { staff: M })).status, 200)
  assert.equal((await post(`/api/t/${table}/join`, { name: 'Лёша', animal: 'fox', idemKey: fresh() })).status, 200)
  await post(`/api/t/${table}/reset`, { force: true }, { staff: M })
})

test('строка "false" не делает блюдо общим (Б16)', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await post(`/api/t/${table}/lines`, { dishId: 'espresso', shared: 'false' }, { guest: g })
  assert.equal((await snapshot(table, g)).lines[0].shared, false)
})

test('наличными «своё» после чужого «поровну» тоже нельзя (правило 6)', async () => {
  const table = fresh()
  const anya = await join(table, 'Аня')
  const dima = await join(table, 'Дима')
  await order(table, anya, 'caesar')
  await order(table, dima, 'espresso')
  await post(`/api/t/${table}/pay`, { scope: 'equal', idemKey: fresh() }, { guest: anya })
  assert.equal((await post(`/api/t/${table}/cashIntent`, { scope: 'own' }, { guest: dima })).status, 409)
  const persona = (await snapshot(table, dima)).personas.find((p: any) => p.name === 'Дима').id
  assert.equal((await post(`/api/t/${table}/cash`, { personaId: persona, scope: 'own' }, { staff: M })).status, 409)
})

test('чужой черновик с аллергеном соседа остаётся в корзине, своё уходит', async () => {
  const table = fresh()
  const marina = await join(table, 'Марина', ['орехи'])
  const katya = await join(table, 'Катя')
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: katya })
  await post(`/api/t/${table}/lines`, { dishId: 'medovik', shared: true, confirmAllergen: true }, { guest: katya })
  // Марина указала лактозу уже после того, как Катя положила общий медовик
  await post(`/api/t/${table}/allergies`, { allergies: ['орехи', 'лактоза'] }, { guest: marina })
  const r = await (await post(`/api/t/${table}/send`, { scope: 'mine', confirmAllergen: true }, { guest: katya })).json()
  assert.equal(r.sent, 1, 'эспрессо ушёл')
  assert.deepEqual(r.heldBack.map((h: any) => h.dish), ['Медовик'])
  assert.deepEqual(r.heldBack[0].people, ['Марина'])
})

test('вызов «счёт» с текстом после оплаты остаётся просьбой о помощи', async () => {
  const table = fresh()
  const g = await join(table, 'Марина')
  await order(table, g, 'espresso')
  await post(`/api/t/${table}/call`, { reason: 'help', note: 'аллергия, подойдите' }, { guest: g })
  await post(`/api/t/${table}/call`, { reason: 'bill' }, { guest: g })
  await post(`/api/t/${table}/pay`, { scope: 'own', idemKey: fresh() }, { guest: g })
  const snap = await snapshot(table, g)
  assert.equal(snap.calls.length, 1)
  assert.equal(snap.calls[0].reason, 'help')
})

test('гость снаружи упирается в лимит частоты, персонал — нет (Б7)', async () => {
  const table = fresh()
  const g = await join(table, 'Ломатель')
  const outside = { 'Content-Type': 'application/json', 'x-guest-token': g, 'x-forwarded-for': '203.0.113.7' }
  let limited = 0
  for (let i = 0; i < 65; i++) {
    const r = await fetch(`${base}/api/t/${table}/call`, { method: 'POST', headers: outside, body: '{}' })
    if (r.status === 429) limited++
  }
  assert.ok(limited > 0, 'после 60 запросов в минуту — 429')
  const staff = await fetch(`${base}/api/t/${table}/addSeat`, { method: 'POST', headers: { ...outside, 'x-staff-token': M }, body: '{}' })
  assert.notEqual(staff.status, 429)
})

test('поток кухни закрывается, когда сотрудник вышел (Б3)', async () => {
  const login = await (await post('/api/staff/login', { pin: '4444' })).json()
  const res = await fetch(`${base}/api/kitchen/stream?token=${login.token}`)
  const reader = res.body!.getReader()
  await reader.read() // первый кадр
  await post('/api/staff/logout', {}, { staff: login.token })
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso') // рассылка по кухне
  const done = await Promise.race([
    (async () => {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return true
      }
    })(),
    new Promise<boolean>(r => setTimeout(() => r(false), 3000))
  ])
  assert.equal(done, true)
})
