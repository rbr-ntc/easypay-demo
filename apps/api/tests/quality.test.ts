import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * «Гости и качество»: оценки, замечания, «разобрано», ожидание официанта.
 * Раздел только для управляющего — оценка людей, а не рабочий экран.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'quality-master'
process.env.EASYPAY_ANY_TABLE = '1'
const { createServer } = await import('../src/index.ts')

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`
test.after(() => {
  server.closeAllConnections?.()
  server.close()
})

const M = 'quality-master'
let seq = 0
const fresh = () => `q${Date.now().toString(36)}${seq++}`
function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const quality = (period = 'today', token = M) => fetch(`${base}/api/quality?period=${period}`, { headers: { 'x-staff-token': token } })
async function join(table: string, name: string) {
  return (await (await post(`/api/t/${table}/join`, { name, animal: 'fox', idemKey: fresh() })).json()).guestToken as string
}

test('замечание гостя попадает в ленту, «разобрано» снимает его из открытых', async () => {
  const table = fresh()
  const g = await join(table, 'Марина')
  await join(table, 'Катя')
  await post(`/api/t/${table}/rate`, { rating: 'bad', note: 'суп остыл' }, { guest: g })

  let body = await (await quality()).json()
  const remark = body.report.remarks.find((r: any) => r.tableId === table)
  assert.equal(remark.note, 'суп остыл')
  assert.equal(remark.guest, 'Марина')
  assert.equal(remark.resolvedAt, null)
  const openBefore = body.report.totals.openRemarks

  assert.equal((await post('/api/quality/resolve', { sessionId: remark.sessionId, guestId: remark.guestId, resolution: 'ок' }, { staff: M })).status, 400, 'без слов не разобрать')
  const ok = await post('/api/quality/resolve', { sessionId: remark.sessionId, guestId: remark.guestId, resolution: 'извинились, десерт в подарок' }, { staff: M })
  assert.equal(ok.status, 200)

  body = await (await quality()).json()
  const after = body.report.remarks.find((r: any) => r.tableId === table)
  assert.equal(after.resolution, 'извинились, десерт в подарок')
  assert.ok(after.resolvedAt)
  assert.equal(body.report.totals.openRemarks, openBefore - 1)
})

test('отклик — по закрытым посадкам: пока стол открыт, процента нет; закрыли — 50%', async () => {
  const table = fresh()
  const g = await join(table, 'Аня')
  await join(table, 'Дима')
  await post(`/api/t/${table}/rate`, { rating: 'good' }, { guest: g })
  let body = await (await quality()).json()
  let row = body.report.byTable.find((t: any) => t.tableId === table)
  assert.equal(row.guests, 2)
  assert.equal(row.rated, 1)
  assert.equal(row.responseRate, null, 'сидящие ещё не успели оценить')
  assert.equal(row.index, 100)
  await post(`/api/t/${table}/close`, { force: true }, { staff: M })
  body = await (await quality()).json()
  row = body.report.byTable.find((t: any) => t.tableId === table)
  assert.equal(row.responseRate, 50)
})

test('ожидание официанта: от вызова до «иду»', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  const { callId } = await (await post(`/api/t/${table}/call`, { reason: 'help' }, { guest: g })).json()
  await new Promise(r => setTimeout(r, 30))
  await post(`/api/t/${table}/ack`, { callId }, { staff: M })
  const body = await (await quality()).json()
  assert.ok(body.report.totals.callAvgSec !== null)
})

test('раздел — только управляющему; неизвестный период — 400', async () => {
  const waiter = await (await post('/api/staff/login', { pin: '2222' })).json()
  assert.equal((await quality('today', waiter.token)).status, 403)
  assert.equal((await quality('year')).status, 400)
  assert.equal((await quality('shift')).status, 200)
})

test('гость переоценил после «разобрано» — новая жалоба снова открыта; похвала разбора не требует', async () => {
  const table = fresh()
  const g = await join(table, 'Вера')
  await post(`/api/t/${table}/rate`, { rating: 'bad', note: 'шумно' }, { guest: g })
  let body = await (await quality()).json()
  const first = body.report.remarks.find((r: any) => r.tableId === table)
  await post('/api/quality/resolve', { sessionId: first.sessionId, guestId: first.guestId, resolution: 'пересадили гостя' }, { staff: M })
  await new Promise(r => setTimeout(r, 5))
  await post(`/api/t/${table}/rate`, { rating: 'bad', note: 'всё равно шумно' }, { guest: g })
  body = await (await quality()).json()
  const again = body.report.remarks.find((r: any) => r.tableId === table)
  assert.equal(again.note, 'всё равно шумно')
  assert.equal(again.resolvedAt, null)

  const t2 = fresh()
  const fan = await join(t2, 'Олег')
  const before = body.report.totals.openRemarks
  await post(`/api/t/${t2}/rate`, { rating: 'good', note: 'всё супер' }, { guest: fan })
  body = await (await quality()).json()
  assert.ok(body.report.remarks.some((r: any) => r.note === 'всё супер'), 'похвала видна в ленте')
  assert.equal(body.report.totals.openRemarks, before, 'но в «к разбору» не попадает')
})

test('кривой идентификатор отзыва — 404, а не 500', async () => {
  const r = await post('/api/quality/resolve', { sessionId: 'x', guestId: 'y', resolution: 'проверка' }, { staff: M })
  assert.equal(r.status, 404)
})
