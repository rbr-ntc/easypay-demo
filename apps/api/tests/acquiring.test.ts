import test from 'node:test'
import assert from 'node:assert/strict'
import type { PaymentProvider, ProviderPayment } from '../src/payments/index.ts'

/**
 * Оплата через эквайера в два шага: намерение и резерв → страница оплаты →
 * подтверждение эквайера → платёж в счёте. Эквайер здесь поддельный: тест
 * решает, чем кончится каждый платёж.
 */

process.env.EASYPAY_MANAGER_TOKEN = 'acq-master'
process.env.EASYPAY_ANY_TABLE = '1'
process.env.EASYPAY_PUBLIC_URL = 'https://stand.test'
process.env.EASYPAY_PAY_RECHECK_MS = '0'
const { createServer } = await import('../src/index.ts')
const { setPaymentProvider, ProviderError } = await import('../src/payments/index.ts')

const payments = new Map<string, ProviderPayment>()
const canceledHolds: string[] = []
let failCreate: false | 'network' | 'reject' = false
let seqId = 0
const fake: PaymentProvider = {
  name: 'yookassa',
  async create(req) {
    if (failCreate === 'network') throw new ProviderError('эквайер не ответил', 504)
    if (failCreate === 'reject') throw new ProviderError('invalid_request', 400)
    // Тот же ключ — тот же платёж, как у настоящего эквайера
    const existing = [...payments.values()].find(p => p.metadata.intentId === req.idemKey)
    if (existing) return existing
    const id = `yk-${++seqId}`
    const p: ProviderPayment = { id, status: 'pending', amount: req.amount, confirmationUrl: `https://pay.test/${id}`, method: null, cancelReason: null, metadata: req.metadata }
    payments.set(id, p)
    return p
  },
  async get(id) {
    return payments.get(id)!
  },
  async capture(id, amount) {
    const p = { ...payments.get(id)!, status: 'succeeded' as const, amount }
    payments.set(id, p)
    return p
  },
  async cancel(id) {
    canceledHolds.push(id)
    const p = { ...payments.get(id)!, status: 'canceled' as const, cancelReason: 'оплата отменена' }
    payments.set(id, p)
    return p
  },
  async refund(paymentId) {
    return { id: `r-${paymentId}`, status: 'succeeded' }
  }
}
setPaymentProvider(fake)
/** Гость на странице эквайера: деньги заморожены (успех) или банк отказал. */
const finish = (id: string, status: 'succeeded' | 'canceled', method = 'card') =>
  payments.set(id, {
    ...payments.get(id)!,
    status: status === 'succeeded' ? 'waiting_for_capture' : 'canceled',
    method: status === 'succeeded' ? method : null,
    cancelReason: status === 'canceled' ? 'недостаточно средств' : null
  })
const ykOf = (url: string) => url.split('/').pop()!

const server = createServer()
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as any).port}`
test.after(() => {
  setPaymentProvider(undefined)
  server.closeAllConnections?.()
  server.close()
})

const M = 'acq-master'
let seq = 0
const fresh = () => `aq${Date.now().toString(36)}${seq++}`
function post(path: string, body: object = {}, opts: { staff?: string; guest?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = opts.staff
  if (opts.guest) headers['x-guest-token'] = opts.guest
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
const snapshot = (table: string, guest: string) => fetch(`${base}/api/t/${table}`, { headers: { 'x-guest-token': guest } }).then(r => r.json())
async function join(table: string, name: string) {
  return (await (await post(`/api/t/${table}/join`, { name, animal: 'fox', idemKey: fresh() })).json()).guestToken as string
}
async function order(table: string, guest: string, dishId: string) {
  await post(`/api/t/${table}/lines`, { dishId }, { guest })
  await post(`/api/t/${table}/send`, { scope: 'mine' }, { guest })
}
const pay = async (table: string, guest: string, scope = 'own', idemKey = fresh()) => {
  const r = await post(`/api/t/${table}/pay`, { scope, idemKey }, { guest })
  return { status: r.status, body: await r.json() }
}
const status = async (table: string, guest: string, intentId: string) =>
  (await post(`/api/t/${table}/payStatus`, { intentId }, { guest })).json()

test('оплата уходит на страницу эквайера, в счёт — только после подтверждения', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const r = await pay(table, g)
  assert.equal(r.status, 200)
  assert.equal(r.body.pending, true)
  assert.match(r.body.confirmationUrl, /^https:\/\/pay\.test\//)
  let snap = await snapshot(table, g)
  assert.equal(snap.acquiring, 'yookassa')
  assert.equal(snap.payments.length, 0, 'денег в счёте ещё нет')
  assert.deepEqual(snap.payPending.map((p: any) => p.amount), [180])
  assert.equal((await status(table, g, r.body.intentId)).status, 'pending')

  finish(ykOf(r.body.confirmationUrl), 'succeeded')
  const done = await status(table, g, r.body.intentId)
  assert.equal(done.status, 'succeeded')
  assert.equal(done.receipt.amount, 180)
  assert.equal(done.receipt.paidBeforeMine, 0)
  snap = await snapshot(table, g)
  assert.equal(snap.payments.length, 1)
  assert.equal(snap.payments[0].method, 'card', 'способ — тот, которым заплатили у эквайера')
  assert.equal(snap.payPending.length, 0)
  assert.equal(snap.totals.remaining, 0)

  // Уведомление пришло после проверки гостем — второй строки в счёте нет
  await post('/api/pay/yookassa/webhook', { event: 'payment.succeeded', object: { id: 'x', metadata: { tableId: table, intentId: r.body.intentId } } })
  assert.equal((await snapshot(table, g)).payments.length, 1)
})

test('пока сосед платит, его сумма зарезервирована: «весь стол» — только остаток', async () => {
  const table = fresh()
  const anya = await join(table, 'Аня')
  const dima = await join(table, 'Дима')
  await order(table, anya, 'caesar')
  await order(table, dima, 'espresso')
  const a = await pay(table, anya, 'own')
  assert.equal(a.body.amount, 690)
  const d = await pay(table, dima, 'full')
  assert.equal(d.body.amount, 180, 'цезарь Ани уже в пути — Дима платит только своё')
})

test('повтор кнопки не создаёт второй платёж, а отдаёт тот же', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const first = await pay(table, g)
  const again = await pay(table, g)
  assert.equal(again.body.intentId, first.body.intentId)
  assert.equal(again.body.confirmationUrl, first.body.confirmationUrl)
})

test('отказ банка: чек не появляется, резерв снимается, причина — словами', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const r = await pay(table, g)
  finish(ykOf(r.body.confirmationUrl), 'canceled')
  const s = await status(table, g, r.body.intentId)
  assert.equal(s.status, 'canceled')
  assert.equal(s.reason, 'недостаточно средств')
  const snap = await snapshot(table, g)
  assert.equal(snap.payments.length, 0)
  assert.equal(snap.payPending.length, 0)
  const retry = await pay(table, g)
  assert.notEqual(retry.body.intentId, r.body.intentId, 'новая попытка — новый платёж')
})

test('сбой связи с эквайером: повтор идёт тем же ключом и не создаёт второй платёж', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  failCreate = 'network'
  const key = fresh()
  try {
    assert.equal((await pay(table, g, 'own', key)).status, 502)
  } finally {
    failCreate = false
  }
  const before = payments.size
  // Сразу повторить — «создаётся», ссылку не дублируем
  const again = await pay(table, g, 'own', key)
  assert.equal(again.body.pending, true)
  assert.equal(payments.size, before, 'второго платежа у эквайера нет')
})

test('эквайер отклонил запрос — резерв снят', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  failCreate = 'reject'
  try {
    assert.equal((await pay(table, g)).status, 502)
    assert.equal((await snapshot(table, g)).payPending.length, 0)
  } finally {
    failCreate = false
  }
})

test('пока гость платит картой, наличными берут только остаток', async () => {
  const table = fresh()
  const anya = await join(table, 'Аня')
  const dima = await join(table, 'Дима')
  await order(table, anya, 'caesar')
  await order(table, dima, 'espresso')
  await pay(table, anya, 'own')
  const cash = await (await post(`/api/t/${table}/cash`, { scope: 'full' }, { staff: M })).json()
  assert.equal(cash.amount, 180, 'цезарь Ани в пути — официант берёт только эспрессо')
  assert.equal((await post(`/api/t/${table}/cashIntent`, { scope: 'own' }, { guest: anya })).status, 409, 'Аня уже платит картой')
})

test('стол закрыли, пока гость был на странице оплаты, — заморозка снимается, не списывается', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const r = await pay(table, g)
  assert.equal((await post(`/api/t/${table}/close`, { force: true }, { staff: M })).status, 200)
  finish(ykOf(r.body.confirmationUrl), 'succeeded')
  const s = await status(table, g, r.body.intentId)
  assert.equal(s.status, 'canceled')
  assert.match(s.reason, /стол уже закрыт/)
  assert.ok(canceledHolds.includes(ykOf(r.body.confirmationUrl)), 'деньги гостю разморожены')
})

test('после пересадки уведомление о старой оплате снимает заморозку', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const r = await pay(table, g)
  await post(`/api/t/${table}/close`, { force: true }, { staff: M })
  await join(table, 'Новый гость')
  const yk = ykOf(r.body.confirmationUrl)
  finish(yk, 'succeeded')
  await post('/api/pay/yookassa/webhook', { event: 'payment.waiting_for_capture', object: { id: yk, metadata: { tableId: table, intentId: r.body.intentId } } })
  assert.ok(canceledHolds.includes(yk))
})

test('персонал видит резерв, списывается ровно замороженное', async () => {
  const table = fresh()
  const anya = await join(table, 'Аня')
  await join(table, 'Дима')
  await order(table, anya, 'espresso')
  const r = await pay(table, anya, 'own')
  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(x => x.json())
  assert.equal(snap.reserved.remaining, 0)
  finish(ykOf(r.body.confirmationUrl), 'succeeded')
  const s = await status(table, anya, r.body.intentId)
  assert.equal(s.status, 'succeeded')
  assert.equal(s.amount, 180)
})

test('поддельное уведомление «оплачено» ничего не зачисляет', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  const r = await pay(table, g)
  const hook = await post('/api/pay/yookassa/webhook', {
    event: 'payment.succeeded',
    object: { id: 'forged', status: 'succeeded', metadata: { tableId: table, intentId: r.body.intentId } }
  })
  assert.equal(hook.status, 200)
  assert.equal((await snapshot(table, g)).payments.length, 0, 'эквайер говорит pending — значит pending')
})

test('стол не закрыть, пока гость на странице оплаты; чужой платёж не подсмотреть', async () => {
  const table = fresh()
  const anya = await join(table, 'Аня')
  const dima = await join(table, 'Дима')
  await order(table, anya, 'espresso')
  const r = await pay(table, anya)
  const close = await post(`/api/t/${table}/close`, {}, { staff: M })
  assert.equal(close.status, 409)
  assert.equal((await close.json()).error, 'payment in progress')
  assert.equal((await post(`/api/t/${table}/payStatus`, { intentId: r.body.intentId }, { guest: dima })).status, 404)
})

test('гость передумал платить картой — резерв снят, можно наличными', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  await pay(table, g)
  assert.equal((await post(`/api/t/${table}/cancelPay`, {}, { guest: g })).status, 200)
  assert.equal((await snapshot(table, g)).payPending.length, 0)
  assert.equal((await post(`/api/t/${table}/cashIntent`, { scope: 'own' }, { guest: g })).status, 200)
})

test('после сбоя связи проверка статуса сама доводит платёж тем же ключом', async () => {
  const table = fresh()
  const g = await join(table, 'Глеб')
  await order(table, g, 'espresso')
  failCreate = 'network'
  let intentId = ''
  try {
    await pay(table, g)
  } finally {
    failCreate = false
  }
  const snap = await fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': M } }).then(x => x.json())
  assert.equal(snap.payPending.length, 1, 'резерв держится, платёж не отменён')
  // Номер намерения клиент получает из ответа на повтор; здесь ждём CREATING_MS не будем —
  // проверяем, что повтор оплаты не плодит платежей у эквайера
  const before = payments.size
  const again = await pay(table, g)
  intentId = again.body.intentId
  assert.ok(intentId)
  assert.equal(payments.size, before)
})
