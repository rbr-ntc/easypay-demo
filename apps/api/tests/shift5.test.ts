import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Пачка исправлений по смене агентов №5 (docs/prototype/shift-5-findings.md).
 *
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
  const marina = (await join(table, 'Марина', ['лактоза'])).body.guestToken
  const katya = (await join(table, 'Катя')).body.guestToken

  const blocked = await post(`/api/t/${table}/lines`, { dishId: 'bruschetta', shared: true }, { guest: katya })
  assert.equal(blocked.status, 409)
  const body = await blocked.json()
  assert.deepEqual(body.allergens, ['лактоза'])
  assert.deepEqual(body.people.map((p: any) => p.name), ['Марина'])

  // Своё блюдо Кати — не общее — аллергия соседки его не касается
  assert.equal((await post(`/api/t/${table}/lines`, { dishId: 'bruschetta' }, { guest: katya })).status, 200)

  await post(`/api/t/${table}/lines`, { dishId: 'bruschetta', shared: true, confirmAllergen: true }, { guest: katya })
  // За Марину Катя не решает (смена №7): Марина соглашается сама
  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': marina } }).then(r => r.json())
  const sharedDraft = snap.lines.find((l: any) => l.shared && !l.sent)
  await post(`/api/t/${table}/sharedConsent`, { uid: sharedDraft.uid }, { guest: marina })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: katya })
  const shared = (await kitchen()).tickets.find((t: any) => t.tableId === table && t.shared)
  assert.deepEqual(shared.sharedNames, ['Марина', 'Катя'])
  assert.deepEqual(shared.guestAllergies, [{ name: 'Марина', allergies: ['лактоза'] }])
  assert.deepEqual(shared.allergyHits, ['лактоза'])
})

test('расплатился наличными — его вызов «счёт» снят, соседский остаётся', async () => {
  const table = fresh()
  const nika = (await join(table, 'Ника')).body.guestToken
  const gleb = (await join(table, 'Глеб')).body.guestToken
  for (const g of [nika, gleb]) {
    await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: g })
    await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
    await post(`/api/t/${table}/call`, { reason: 'bill' }, { guest: g })
  }
  await post(`/api/t/${table}/cashIntent`, { scope: 'own' }, { guest: nika })
  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  const nikaId = snap.personas.find((p: any) => p.name === 'Ника').id
  assert.equal(snap.calls.length, 2)
  const cash = await post(`/api/t/${table}/cash`, { personaId: nikaId, scope: 'own', sessionId: snap.sessionId }, { staff: M })
  assert.equal(cash.status, 200)
  const after = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  assert.equal(after.calls.length, 1)
  assert.notEqual(after.calls[0].personaId, nikaId)
})

test('гость, севший по ошибке, выходит; его доля общего уходит остальным', async () => {
  const table = fresh()
  const marina = (await join(table, 'Марина')).body.guestToken
  const ghost = (await join(table, 'Марина4')).body.guestToken
  const katya = (await join(table, 'Катя')).body.guestToken
  await post(`/api/t/${table}/lines`, { dishId: 'espresso', shared: true }, { guest: katya })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: katya })
  const staffSnap = () => fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  let snap = await staffSnap()
  assert.equal(snap.personas.length, 3)
  const shareBefore = snap.totals.byPersona.find((p: any) => p.name === 'Марина' || p.personaId === snap.personas[0].id).total

  assert.equal((await post(`/api/t/${table}/leave`, {}, { guest: ghost })).status, 200)
  snap = await staffSnap()
  assert.equal(snap.personas.length, 2)
  const shareAfter = snap.totals.byPersona.find((p: any) => p.personaId === snap.personas[0].id).total
  assert.ok(shareAfter > shareBefore, 'доля призрака ушла тем, кто ел')
  assert.equal(snap.totals.tableTotal, snap.totals.byPersona.reduce((s: number, p: any) => s + p.total, 0))
  // Вышедший гость больше ничего не может
  assert.notEqual((await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: ghost })).status, 200)

  // Катя заказала — её не убрать ни самой, ни официанту
  const katyaId = snap.personas.find((p: any) => p.name === 'Катя').id
  const selfLeave = await post(`/api/t/${table}/leave`, {}, { guest: katya })
  assert.equal(selfLeave.status, 409)
  assert.equal((await selfLeave.json()).error, 'guest has orders')
  const staffRemove = await post(`/api/t/${table}/removeGuest`, { personaId: katyaId, sessionId: snap.sessionId }, { staff: M })
  assert.equal(staffRemove.status, 409)
  void marina
})

test('аллергии меняются после посадки и сразу видны кухне', async () => {
  const table = fresh()
  const vera = (await join(table, 'Вера')).body.guestToken
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: vera })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: vera })
  assert.equal((await post(`/api/t/${table}/allergies`, { allergies: 'орехи' }, { guest: vera })).status, 400)
  assert.equal((await post(`/api/t/${table}/allergies`, { allergies: ['кошки'] }, { guest: vera })).status, 400)
  const ok = await post(`/api/t/${table}/allergies`, { allergies: ['орехи'] }, { guest: vera })
  assert.equal(ok.status, 200)
  const ticket = (await kitchen()).tickets.find((t: any) => t.tableId === table)
  assert.deepEqual(ticket.guestAllergies, [{ name: 'Вера', allergies: ['орехи'] }])
})

test('чеки: доплата и «поровну» с пометкой, наличные с составом, номера уникальны, доли сходятся', async () => {
  const table = fresh()
  const gleb = (await join(table, 'Глеб')).body.guestToken
  const mila = (await join(table, 'Мила')).body.guestToken
  const nika = (await join(table, 'Ника')).body.guestToken
  // Общий лимонад на троих: 220 / 3 — хвост копеек
  await post(`/api/t/${table}/lines`, { dishId: 'lemonade', shared: true }, { guest: gleb })
  for (const g of [gleb, mila, nika]) await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: g })
  for (const g of [gleb, mila, nika]) await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })

  const own = await (await post(`/api/t/${table}/pay`, { scope: 'own', method: 'card', idemKey: fresh() }, { guest: gleb })).json()
  const lineSum = own.receipt.lines.reduce((s: number, l: any) => s + (l.shared ? l.share : l.price * l.qty), 0)
  assert.equal(Math.round(lineSum * 100) / 100, own.amount, 'строки чека складываются ровно в списанное')
  assert.ok(own.receipt.venue?.name)

  const eq = await (await post(`/api/t/${table}/pay`, { scope: 'equal', method: 'sbp', idemKey: fresh() }, { guest: mila })).json()
  assert.match(eq.receipt.note, /поровну/)
  assert.notEqual(eq.receipt.no, own.receipt.no)

  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  const nikaId = snap.personas.find((p: any) => p.name === 'Ника').id
  // После чужого «поровну» — только поровну или весь стол, наличными тоже (правило 6, смена №6)
  await post(`/api/t/${table}/cash`, { personaId: nikaId, scope: 'equal', sessionId: snap.sessionId }, { staff: M })
  const after = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  const cash = after.payments.find((p: any) => p.method === 'cash')
  assert.ok(cash.lines.length > 0, 'у наличных есть состав')

  const tip = await (await post(`/api/t/${table}/tip`, { amount: 100, method: 'card', idemKey: fresh() }, { guest: gleb })).json()
  assert.equal(tip.receipt.method, 'card')
})

test('возврат наличными уменьшает ожидаемую кассу; переплату можно закрыть отметкой', async () => {
  const table = fresh()
  const g = (await join(table, 'Тимур')).body.guestToken
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: g })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
  await post(`/api/t/${table}/pay`, { scope: 'own', method: 'sbp', idemKey: fresh() }, { guest: g })
  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  // Кухня не начинала — принудительное закрытие снимает эспрессо, оплата становится переплатой
  await post(`/api/t/${table}/close`, { force: true, sessionId: snap.sessionId }, { staff: M })

  const before = await fetch(`${base}/api/shift`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  const refunded = await post(`/api/t/${table}/refund`, { method: 'cash', sessionId: snap.sessionId, idemKey: fresh() }, { staff: M })
  assert.equal(refunded.status, 200)
  const amount = (await refunded.json()).amount
  const after = await fetch(`${base}/api/shift`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  assert.equal(after.cash.refunded - before.cash.refunded, amount)
  assert.equal(Math.round((before.cash.system - after.cash.system) * 100) / 100, amount, 'из ящика ушло — система ждёт меньше')

  // Журнал — за смену целиком, с отметкой начала
  const log = await fetch(`${base}/api/log`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  assert.ok(log.entries.length > 0)
  assert.ok(log.entries.every((e: any) => !log.since || e.at >= log.since))
})

test('переплату, которую уже не вернуть из системы, закрывают отметкой «вернули на кассе»', async () => {
  const note = await post('/api/decisions/note', { key: 'refund:abc-123', text: 'Оля, наличными из кассы' }, { staff: M })
  assert.equal(note.status, 200)
  const bad = await post('/api/decisions/note', { key: 'evil:1', text: 'x' }, { staff: M })
  assert.equal(bad.status, 400)
})

test('мелочи смены №5: теги вырезаются целиком, незнакомый способ — ошибка, принятый вызов оставляет след', async () => {
  const table = fresh()
  const g = (await join(table, 'Тимур<script>x</script>')).body
  assert.equal(g.snapshot.personas[0].name, 'Тимурx')
  await post(`/api/t/${table}/lines`, { dishId: 'espresso', comment: '<img src=x onerror=alert(1)> без лука' }, { guest: g.guestToken })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g.guestToken })
  const ticket = (await kitchen()).tickets.find((t: any) => t.tableId === table)
  assert.equal(ticket.comment, 'без лука')

  const bitcoin = await post(`/api/t/${table}/pay`, { scope: 'own', method: 'bitcoin', idemKey: fresh() }, { guest: g.guestToken })
  assert.equal(bitcoin.status, 400)
  assert.equal((await bitcoin.json()).error, 'unknown method')

  const call = await (await post(`/api/t/${table}/call`, { reason: 'help' }, { guest: g.guestToken })).json()
  await post(`/api/t/${table}/ack`, { callId: call.callId }, { staff: M })
  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': g.guestToken } }).then(r => r.json())
  assert.equal(snap.calls.length, 0)
  assert.equal(snap.acked.length, 1)
  assert.ok(snap.acked[0].by)

  assert.equal((await kitchen()).shiftOpen, true, 'кухня знает, что смена идёт')
})

test('одинокое «<» не съедает остаток комментария с аллергией', async () => {
  const table = fresh()
  const g = (await join(table, 'Аня')).body.guestToken
  await post(`/api/t/${table}/lines`, { dishId: 'espresso', comment: 'без лука, соли <5 г, орехи нельзя!' }, { guest: g })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
  const ticket = (await kitchen()).tickets.find((t: any) => t.tableId === table)
  assert.equal(ticket.comment, 'без лука, соли 5 г, орехи нельзя!')
})

test('старый ключ оплаты после нового блюда — 409, а не чужой чек без списания', async () => {
  const table = fresh()
  const g = (await join(table, 'Аня')).body.guestToken
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: g })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
  const key = fresh()
  assert.equal((await post(`/api/t/${table}/pay`, { scope: 'own', method: 'sbp', idemKey: key }, { guest: g })).status, 200)
  // Тот же ключ сразу — тот же чек
  const again = await post(`/api/t/${table}/pay`, { scope: 'own', method: 'sbp', idemKey: key }, { guest: g })
  assert.equal(again.status, 200)
  // Десерт — и тот же ключ больше не годится
  await post(`/api/t/${table}/lines`, { dishId: 'espresso' }, { guest: g })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest: g })
  const stale = await post(`/api/t/${table}/pay`, { scope: 'own', method: 'sbp', idemKey: key }, { guest: g })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error, 'stale key')

  const tip = await post(`/api/t/${table}/tip`, { amount: 50, method: 'bitcoin', idemKey: fresh() }, { guest: g })
  assert.equal(tip.status, 400)
})

test('официант добавляет блюдо гостю и на стол — сразу на кухню, с проверкой аллергий', async () => {
  const table = fresh()
  await join(table, 'Марина', ['лактоза'])
  const olya = await (await post('/api/staff/login', { pin: '2222' })).json()
  const staffSnap = () => fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  const s0 = await staffSnap()
  const marinaId = s0.personas[0].id

  // Чужой стол — нельзя; повару — нельзя
  const cook = await (await post('/api/staff/login', { pin: '4444' })).json()
  assert.equal((await post(`/api/t/${table}/addLine`, { dishId: 'espresso', personaId: marinaId }, { staff: cook.token })).status, 403)

  const warned = await post(`/api/t/${table}/addLine`, { dishId: 'bruschetta', personaId: marinaId, idemKey: fresh() }, { staff: M })
  assert.equal(warned.status, 409)
  assert.deepEqual((await warned.json()).people.map((p: any) => p.name), ['Марина'])

  const key = fresh()
  assert.equal((await post(`/api/t/${table}/addLine`, { dishId: 'espresso', personaId: marinaId, idemKey: key }, { staff: M })).status, 200)
  assert.equal((await post(`/api/t/${table}/addLine`, { dishId: 'espresso', personaId: marinaId, idemKey: key }, { staff: M })).status, 200)
  await post(`/api/t/${table}/addLine`, { dishId: 'lemonade', idemKey: fresh() }, { staff: M })
  const s1 = await staffSnap()
  assert.equal(s1.lines.filter((l: any) => l.dishId === 'espresso').length, 1, 'повтор с тем же ключом не задвоил')
  assert.ok(s1.lines.every((l: any) => l.sent), 'сразу на кухню')
  assert.equal(s1.lines.find((l: any) => l.dishId === 'lemonade').shared, true)
  assert.ok(s1.totals.tableTotal > 0, 'и в счёт')
  void olya
})

test('официант принимает заказ за пустым столом — без телефона у гостей', async () => {
  const table = fresh()
  const res = await post(`/api/t/${table}/addLine`, { dishId: 'espresso', idemKey: fresh() }, { staff: M })
  assert.equal(res.status, 200)
  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(r => r.json())
  assert.equal(snap.status, 'open')
  assert.equal(snap.personas.length, 1)
  assert.equal(snap.totals.tableTotal, 180)
})
