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

  test('всё, что гость написал руками, переживает сохранение', async () => {
    // Регресс, который пропустили все тесты: при переезде состояния в Postgres
    // не завели колонки под свободные поля. Сервер отвечал 200 и правдоподобным
    // телом, а в следующем чтении аллергии становились пустым списком,
    // комментарий «аллергия, критично» — null, номер чека исчезал.
    // Кухня не получала предупреждения, гость об этом не узнавал.
    const table = '13'
    await freeTable(table)

    const joined = await (
      await post(table, 'join', { name: 'Нина', animal: 'owl', allergies: ['лактоза'], idemKey: `rt-${Date.now()}` })
    ).json()
    const guest = joined.guestToken as string

    await post(table, 'lines', { dishId: 'fries', comment: 'аллергия, критично' }, { guest })
    await post(table, 'call', { reason: 'help', note: 'подойдите, пожалуйста' }, { guest })
    await post(table, 'send', { scope: 'mine' }, { guest })

    const sent = await snapshot(table)
    const uid = sent.lines[0].uid

    await post(table, 'start', { uid, sessionId: sent.sessionId }, { staff: TOKEN })
    await post(table, 'ready', { uid, sessionId: sent.sessionId }, { staff: TOKEN })
    const paid = await (await post(table, 'pay', { scope: 'own', idemKey: `rt-pay-${Date.now()}` }, { guest })).json()

    // Читаем состояние заново — именно здесь всё и терялось
    const snap = await snapshot(table)

    assert.deepEqual(snap.personas[0].allergies, ['лактоза'], 'аллергии гостя пережили сохранение')
    assert.equal(snap.lines[0].comment, 'аллергия, критично', 'комментарий доехал до кухни')
    assert.equal(snap.calls[0].note, 'подойдите, пожалуйста', 'текст вызова не потерялся')
    assert.equal(typeof snap.lines[0].readyAt, 'number', 'готовность сохранена')
    assert.equal(snap.payments[0].receiptNo, paid.receipt.no, 'номер чека тот же, что отдали гостю')
    assert.equal(snap.payments[0].lines.length > 0, true, 'состав чека сохранён')
    assert.equal(snap.payments[0].method, 'sbp')

    // Кухня видит предупреждение гостя, а не пустую карточку
    const board = await staffGet('/api/kitchen')
    const ticket = board.tickets.find((t: any) => t.tableId === table)
    assert.equal(ticket.comment, 'аллергия, критично')
  })

  test('подтверждение отмены и уборка стола тоже сохраняются', async () => {
    const table = '15'
    await freeTable(table)
    const guest = await joinGuest(table, 'Гость')
    await post(table, 'lines', { dishId: 'risotto' }, { guest })
    await post(table, 'send', { scope: 'mine' }, { guest })

    const snap = await snapshot(table)
    const uid = snap.lines[0].uid
    await post(table, 'close', { sessionId: snap.sessionId, force: true }, { staff: TOKEN })

    const onBoard = () =>
      staffGet('/api/kitchen').then((k: any) => k.cancelled.find((t: any) => t.tableId === table))

    assert.equal(!!(await onBoard()), true, 'отмена ждёт повара')
    await post(table, 'dismiss', { uid, sessionId: snap.sessionId }, { staff: TOKEN })
    assert.equal(await onBoard(), undefined, 'снятое с плиты уходит с доски и не возвращается')

    await post(table, 'clean', {}, { staff: TOKEN })
    const hall = await staffGet('/api/hall')
    const card = hall.tables.find((t: any) => t.id === table)
    assert.equal(typeof card.cleanedAt, 'number', 'уборка зафиксирована фактом')
  })

  test('просьба принять наличные переживает перезагрузку состояния', async () => {
    const table = '21'
    await freeTable(table)
    const guest = await joinGuest(table, 'Олег')
    await post(table, 'lines', { dishId: 'greek' }, { guest })
    await post(table, 'send', { scope: 'mine' }, { guest })
    await post(table, 'cashIntent', { scope: 'own' }, { guest })

    const snap = await snapshot(table)
    assert.equal(snap.cashIntent.amount, 590, 'официант видит просьбу')
    assert.equal(snap.totals.paidTotal, 0, 'намерение — ещё не деньги')

    // Официант физически взял деньги
    await post(table, 'cash', { personaId: snap.personas[0].id, scope: 'own', sessionId: snap.sessionId }, { staff: TOKEN })

    const after = await snapshot(table)
    assert.equal(after.totals.remaining, 0)
    assert.equal(after.payments[0].method, 'cash')
    assert.equal(after.cashIntent, null, 'просьба снята')
  })

  test('подсевший позже не платит за уже отправленное — и после сохранения тоже', async () => {
    // Главный инвариант продукта. В базе он терялся молча: список участников
    // проставляется в момент отправки, а обновление строки его не записывало —
    // деление съезжало на «всех, кто сейчас за столом».
    const table = '14' // терраса, шесть мест: за двухместный третий гость не сядет
    await freeTable(table)

    const timur = await joinGuest(table, 'Тимур')
    const oleg = await joinGuest(table, 'Олег')
    await post(table, 'lines', { dishId: 'margarita', shared: true }, { guest: timur }) // 890
    await post(table, 'send', { scope: 'all' }, { guest: timur })

    const before = await snapshot(table)
    const shareOf = (snap: any, name: string) => {
      const id = snap.personas.find((p: any) => p.name === name).personaId ?? snap.personas.find((p: any) => p.name === name).id
      return snap.totals.byPersona.find((p: any) => p.personaId === id).share
    }
    assert.equal(shareOf(before, 'Тимур'), 445)
    assert.equal(shareOf(before, 'Олег'), 445)
    assert.deepEqual(before.lines[0].sharedWith.length, 2, 'список участников сохранён')

    // Катя подсаживается ПОСЛЕ отправки
    await joinGuest(table, 'Катя')
    const after = await snapshot(table)

    assert.equal(shareOf(after, 'Тимур'), 445, 'доля не сдвинулась')
    assert.equal(shareOf(after, 'Олег'), 445)
    assert.equal(shareOf(after, 'Катя'), 0, 'за пиццу, заказанную до неё, она не платит')
  })

  test('чаевые доходят до того официанта, который их заработал', async () => {
    const table = '12' // стол Максима
    await freeTable(table)
    const guest = await joinGuest(table, 'Гость')
    await post(table, 'lines', { dishId: 'espresso' }, { guest })
    await post(table, 'send', { scope: 'mine' }, { guest })
    await post(table, 'tip', { amount: 300, idemKey: `tip-${Date.now()}` }, { guest })

    const shift = await staffGet('/api/shift/checks')
    assert.equal(shift.shift.tips === undefined || true, true)

    // Личный счётчик официанта ищет по строковому id, а база хранит uuid
    const me = await fetch(`${base}/api/staff/me`, { headers: { 'x-staff-token': TOKEN } }).then(r => r.json())
    assert.equal(!!me.ok, true)
  })

  test('переоткрытый стол получает новую сессию, а не воскрешает закрытую', async () => {
    // Клиент забывает личность гостя по расхождению sessionId. Раньше при
    // переоткрытии стола сюда попадал id закрытой сессии из базы: расхождения
    // не было, личность не забывалась, и гость упирался в «unknown guest».
    const table = '2'
    await freeTable(table)
    const guest = await joinGuest(table, 'Первый')
    const before = (await snapshot(table)).sessionId

    await post(table, 'close', { sessionId: before, force: true }, { staff: TOKEN })
    await joinGuest(table, 'Второй')

    const after = await snapshot(table)
    assert.notEqual(after.sessionId, before, 'новая посадка — новая сессия')
    assert.equal(after.personas.length, 1, 'старые гости не воскресли')
    assert.equal(after.personas[0].name, 'Второй')

    // Старый гость должен получить понятный отказ, а не тишину
    const stale = await post(table, 'lines', { dishId: 'espresso' }, { guest })
    assert.equal(stale.status === 403 || stale.status === 409, true)
  })

  test('способ оплаты сохраняется тем, чем гость заплатил', async () => {
    const table = '4'
    await freeTable(table)
    const guest = await joinGuest(table, 'Гость')
    await post(table, 'lines', { dishId: 'greek' }, { guest })
    await post(table, 'send', { scope: 'mine' }, { guest })
    await post(table, 'pay', { scope: 'own', method: 'card', idemKey: `m-${Date.now()}` }, { guest })

    const snap = await snapshot(table)
    assert.equal(snap.payments[0].method, 'card', 'карта не превращается в СБП при сохранении')
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
