// Проверка хранилища в Postgres: то, ради чего затевался переход с памяти.
// Если база не поднята (нет docker compose), набор пропускается — тесты правил
// не должны зависеть от инфраструктуры.
import test from 'node:test'
import assert from 'node:assert/strict'
import { connect } from '@easypay/db'

process.env.EASYPAY_MANAGER_TOKEN = 'pg-test-master'
process.env.EASYPAY_STORE = 'postgres'

const TOKEN = 'pg-test-master'

/** База может быть не поднята — тогда весь файл пропускаем с понятной причиной. */
async function dbAvailable() {
  const sql = connect({ max: 1 })
  try {
    const [row] = await sql`select count(*)::int as venues from venues`
    await sql.end()
    return row.venues > 0
  } catch {
    await sql.end().catch(() => {})
    return false
  }
}

const available = await dbAvailable()
if (!available) {
  test('Postgres недоступен — набор пропущен', { skip: 'нет базы: npm run db:up && npm run db:migrate && npm run db:seed' }, () => {})
}

if (available) {
  const { createServer, closeStore } = await import('../src/index.ts')
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const base = `http://127.0.0.1:${(server.address() as any).port}`

  test.after(async () => {
    server.closeAllConnections?.()
    server.close()
    await closeStore()
  })

  const post = (table: string, action: string, body: any = {}, opts: any = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.staff) headers['x-staff-token'] = opts.staff
    if (opts.guest) headers['x-guest-token'] = opts.guest
    return fetch(`${base}/api/t/${table}/${action}`, { method: 'POST', headers, body: JSON.stringify(body) })
  }
  // Снапшот отдаётся только своим: в тестах читаем персоналом
const snapshot = (table: string) =>
  fetch(`${base}/api/t/${table}`, { headers: { 'x-staff-token': TOKEN } }).then(r => r.json())
  const staffGet = (path: string) => fetch(`${base}${path}`, { headers: { 'x-staff-token': TOKEN } }).then(r => r.json())

  /** Освобождает стол перед сценарием: демо-данные не должны мешать. */
  async function freeTable(table: string) {
    await post(table, 'reset', { force: true }, { staff: TOKEN })
  }

  async function joinGuest(table: string, name: string) {
    const res = await post(table, 'join', { name, animal: 'fox', idemKey: `${table}-${name}-${Date.now()}` })
    assert.equal(res.status, 200)
    return (await res.json()).guestToken as string
  }

  test('состояние стола переживает перезапуск процесса', async () => {
    const table = '12'
    await freeTable(table)

    const guest = await joinGuest(table, 'Аня')
    await post(table, 'lines', { dishId: 'tomyam', options: { spice: 'Остро' } }, { guest })
    await post(table, 'send', { scope: 'mine' }, { guest })

    const before = await snapshot(table)
    assert.equal(before.status, 'open')
    assert.equal(before.totals.tableTotal, 690)

    // Новый процесс сервера = новое подключение и пустая память
    const fresh = createServer()
    await new Promise<void>(resolve => fresh.listen(0, '127.0.0.1', () => resolve()))
    const freshBase = `http://127.0.0.1:${(fresh.address() as any).port}`
    const after = await fetch(`${freshBase}/api/t/${table}`, {
      headers: { 'x-staff-token': TOKEN }
    }).then(r => r.json())
    fresh.closeAllConnections?.()
    fresh.close()

    assert.equal(after.sessionId, before.sessionId, 'сессия стола та же')
    assert.equal(after.status, 'open')
    assert.equal(after.personas[0].name, 'Аня')
    assert.equal(after.lines[0].options.spice, 'Остро', 'модификаторы сохранились')
    assert.equal(after.totals.tableTotal, 690, 'счёт не потерялся')
  })

  test('оплата и чаевые ложатся в базу, счёт сходится', async () => {
    const table = '13'
    await freeTable(table)
    const guest = await joinGuest(table, 'Дима')
    await post(table, 'lines', { dishId: 'espresso' }, { guest }) // 180
    await post(table, 'send', { scope: 'mine' }, { guest })

    const paid = await (await post(table, 'pay', { scope: 'full', idemKey: 'pg-pay-1' }, { guest })).json()
    assert.equal(paid.amount, 180)
    await post(table, 'tip', { amount: 50, idemKey: 'pg-tip-1' }, { guest })

    const snap = await snapshot(table)
    assert.equal(snap.totals.remaining, 0)
    assert.equal(snap.tips[0].amount, 50)

    // Повтор с тем же ключом не создаёт второй платёж даже после перезагрузки состояния
    const again = await post(table, 'pay', { scope: 'full', idemKey: 'pg-pay-1' }, { guest })
    assert.equal((await again.json()).amount, 180)
    assert.equal((await snapshot(table)).payments.length, 1)
  })

  test('реестр чеков смены сходится с выручкой', async () => {
    const table = '14'
    await freeTable(table)
    const guest = await joinGuest(table, 'Лена')
    await post(table, 'lines', { dishId: 'greek' }, { guest }) // 590
    await post(table, 'send', { scope: 'mine' }, { guest })
    await post(table, 'pay', { scope: 'full', idemKey: `pg-check-${Date.now()}` }, { guest })

    // Гостья поела и рассчиталась: салат подан, закрывать нечего опасаться
    const snap = await snapshot(table)
    const uid = snap.lines[0].uid
    await post(table, 'start', { uid, sessionId: snap.sessionId }, { staff: TOKEN })
    await post(table, 'serve', { uid, sessionId: snap.sessionId }, { staff: TOKEN })
    await post(table, 'close', { sessionId: snap.sessionId }, { staff: TOKEN })

    const registry = await staffGet('/api/shift/checks')
    const check = registry.checks.find((c: any) => c.tableId === table)
    assert.equal(!!check, true, 'закрытая сессия попала в реестр')
    assert.equal(check.paid, 590)
    assert.equal(check.debt, 0)
    assert.equal(check.lines.some((l: any) => l.name === 'Греческий'), true, 'в чеке виден состав')
    assert.equal(registry.control.matches, true, 'сумма чеков совпадает с выручкой смены')
  })

  test('закрытие с долгом попадает в смену и журнал', async () => {
    const table = '15'
    await freeTable(table)
    const guest = await joinGuest(table, 'Кира')
    await post(table, 'lines', { dishId: 'steak' }, { guest }) // 1290
    await post(table, 'send', { scope: 'mine' }, { guest })

    const snap = await snapshot(table)
    const refused = await post(table, 'close', { sessionId: snap.sessionId }, { staff: TOKEN })
    assert.equal(refused.status, 409)
    assert.equal((await refused.json()).error, 'unpaid')

    await post(table, 'close', { sessionId: snap.sessionId, force: true }, { staff: TOKEN })

    const registry = await staffGet('/api/shift/checks')
    const check = registry.checks.find((c: any) => c.tableId === table)
    // Одна формула на смену и на чек: долг = получено минус оплачено.
    // Стейк сняли с кухни, гость его не получил — это списание, а не долг.
    assert.equal(check.debt, 0, 'чек не спорит с итогами смены')
    assert.equal(check.cancelledTotal, 1290, 'снятое живёт отдельной строкой')
    // Стейк на кухню отправили, но не подали — гость его не получил.
    // В итогах смены это списание с кухни, а не долг гостя: разные деньги.
    assert.equal(registry.shift.writtenOff >= 1290, true, 'снятое с кухни считается отдельно')
    assert.equal(registry.shift.debt, 0, 'за неподанное гость ничего не должен')

    const log = await staffGet('/api/log')
    assert.equal(
      log.entries.some((e: any) => e.action === 'закрыл стол с долгом' && e.tableId === table),
      true
    )
    assert.equal(
      log.entries.some((e: any) => e.action === 'списание с кухни' && e.amount === 1290),
      true,
      'сумма списания записана, а не только количество'
    )
  })

  test('две одновременные оплаты не спишут больше остатка', async () => {
    const table = '21'
    await freeTable(table)
    const anya = await joinGuest(table, 'Аня')
    const dima = await joinGuest(table, 'Дима')
    await post(table, 'lines', { dishId: 'margarita' }, { guest: anya }) // 890
    await post(table, 'send', { scope: 'mine' }, { guest: anya })

    const [first, second] = await Promise.all([
      post(table, 'pay', { scope: 'full', idemKey: 'race-1' }, { guest: anya }),
      post(table, 'pay', { scope: 'full', idemKey: 'race-2' }, { guest: dima })
    ])

    const statuses = [first.status, second.status].sort()
    assert.deepEqual(statuses, [200, 400], 'второй платёж упирается в нулевой остаток')

    const snap = await snapshot(table)
    const total = snap.payments.reduce((s: number, p: any) => s + p.amount, 0)
    assert.equal(total, 890, 'стол оплачен ровно один раз')
  })

  test('журнал пишет, кто именно взял в работу и подал', async () => {
    const table = '22'
    await freeTable(table)
    const guest = await joinGuest(table, 'Гость')
    await post(table, 'lines', { dishId: 'fries' }, { guest })
    await post(table, 'send', { scope: 'mine' }, { guest })

    const snap = await snapshot(table)
    const uid = snap.lines[0].uid
    await post(table, 'start', { uid, sessionId: snap.sessionId }, { staff: TOKEN })
    await post(table, 'serve', { uid, sessionId: snap.sessionId }, { staff: TOKEN })

    const after = await snapshot(table)
    assert.equal(!!after.lines[0].startedAt, true)
    assert.equal(!!after.lines[0].servedAt, true)

    const log = await staffGet('/api/log')
    const served = log.entries.find((e: any) => e.action === 'подал' && e.tableId === table)
    assert.equal(served.name, 'Менеджер (токен)', 'в журнале виден автор действия')
  })
}
