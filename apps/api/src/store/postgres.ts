// Хранилище в Postgres. Состояние стола переживает рестарт, а деньги считаются
// под блокировкой строки сессии: двое одновременно не спишут один и тот же остаток.
import { connect } from '@easypay/db'
import crypto from 'node:crypto'
import { computeTotals, round2 } from '@easypay/domain/money'
import { dishName, priceOf } from '../menu.ts'
import { waiterOfTable } from '../staff.ts'
import type { AuditEntry, MutationResult, Shift, TableSession } from '../types.ts'
import type { DecisionNote, Settlement, ShiftCheck, ShiftInfo, Store } from './types.ts'
import { emptySession } from './memory.ts'

/** Сколько ещё показывать закрытый стол витринам зала и кухни. */
const RECENT_CLOSED_MS = 30 * 60 * 1000

export async function createPostgresStore(url?: string): Promise<Store> {
  const sql = connect(url ? { url } : {})

  const [venue] = await sql`select id, name from venues order by created_at limit 1`
  if (!venue) {
    await sql.end()
    throw new Error('в базе нет точки — выполните npm run db:seed')
  }
  const venueId = venue.id as string

  // Персонал пока заводится из файла, а в базе у него свой uuid: связываем по ext_id,
  // иначе журнал и чаевые ссылались бы на строку конфига, а не на сотрудника.
  const staffByExt = new Map<string, string>()
  async function refreshStaff() {
    const rows = await sql`select id, ext_id from staff where ext_id is not null`
    staffByExt.clear()
    for (const r of rows) staffByExt.set(r.ext_id, r.id)
  }
  await refreshStaff()
  const staffUuid = (extId: string | null | undefined) => (extId ? staffByExt.get(extId) ?? null : null)
  /** Обратное соответствие: в базе сотрудник — uuid, в ролях и сессиях — строковый id. */
  const staffExt = (uuid: string | null | undefined) => {
    if (!uuid) return null
    for (const [ext, id] of staffByExt) if (id === uuid) return ext
    return null
  }

  async function tableUuid(tx: any, number: string): Promise<string | null> {
    const [row] = await tx`
      select id from restaurant_tables where venue_id = ${venueId} and number = ${number} limit 1
    `
    return row?.id ?? null
  }

  /**
   * Открытая смена или null. Раньше здесь создавалась безымянная смена — и
   * гость, севший в момент закрытия, молча открывал её без менеджера. Стол без
   * смены подхватит следующая при открытии (как перенесённый).
   */
  async function currentShiftId(tx: any): Promise<string | null> {
    const [open] = await tx`select id from shifts where venue_id = ${venueId} and closed_at is null limit 1`
    return open?.id ?? null
  }

  const msOf = (v: any) => (v ? new Date(v).getTime() : null)

  function shiftOfRow(row: any): ShiftInfo {
    return {
      id: row.id,
      openedAt: msOf(row.opened_at) ?? Date.now(),
      openedBy: staffExt(row.opened_by),
      closedAt: msOf(row.closed_at),
      closedBy: staffExt(row.closed_by),
      report: row.report ?? null
    }
  }

  /** Чек закрытой сессии: состав, платежи по отдельности, чаевые, возвраты. */
  async function checkOfRow(row: any): Promise<ShiftCheck> {
    const [lines, payments, tips, guests, refunds] = await Promise.all([
      sql`select l.*, g.name as guest_name from order_lines l
          left join guests g on g.id = l.guest_id
          where l.table_session_id = ${row.id} order by l.seq`,
      sql`select p.*, g.name as guest_name, s.name as taker_name from payments p
          left join guests g on g.id = p.guest_id
          left join staff s on s.id = p.taken_by
          where p.table_session_id = ${row.id} order by p.created_at`,
      sql`select amount, created_at from tips where table_session_id = ${row.id}`,
      sql`select count(*) as n from guests where table_session_id = ${row.id}`,
      sql`select coalesce(sum(amount), 0) as total from refunds where table_session_id = ${row.id}`
    ])
    const billed = lines.filter((l: any) => l.sent_at && !l.cancelled_at)
    const total = round2(billed.reduce((a: number, l: any) => a + Number(l.price) * l.qty, 0))
    const paid = round2(payments.reduce((a: number, p: any) => a + Number(p.amount), 0))
    const waiter = waiterOfTable(row.table_number)?.name ?? null
    const times = (col: string) => lines.map((l: any) => msOf(l[col])).filter((x: number | null): x is number => x !== null)
    const sent = times('sent_at')
    const served = times('served_at')
    return {
      tableId: row.table_number,
      sessionId: row.id,
      openedAt: msOf(row.opened_at) ?? 0,
      closedAt: msOf(row.closed_at),
      guests: Number(guests[0].n),
      waiter,
      lines: lines
        .filter((l: any) => l.sent_at || l.cancelled_at)
        .map((l: any) => ({
          name: l.name,
          qty: l.qty,
          price: Number(l.price),
          amount: round2(Number(l.price) * l.qty),
          options: l.options ?? {},
          guest: l.guest_name ?? null,
          shared: !!l.shared,
          cancelled: !!l.cancelled_at,
          cancelReason: l.cancel_reason
        })),
      total,
      paid,
      // Долг = получено минус оплачено — те же числа, что строкой выше
      debt: round2(Math.max(0, total - paid)),
      overpaid: round2(Number(row.overpaid)),
      tips: round2(tips.reduce((a: number, t: any) => a + Number(t.amount), 0)),
      cancelledTotal: round2(
        lines.filter((l: any) => l.cancelled_at).reduce((a: number, l: any) => a + Number(l.price) * l.qty, 0)
      ),
      shiftId: row.shift_id ?? null,
      payments: payments.map((p: any) => ({
        amount: Number(p.amount),
        method: p.method ?? 'sbp',
        at: msOf(p.created_at) ?? 0,
        guest: p.guest_name ?? null,
        takenBy: p.taker_name ?? null
      })),
      tipsList: tips.map((t: any) => ({ amount: Number(t.amount), waiter, at: msOf(t.created_at) ?? 0 })),
      refunded: round2(Number(refunds[0].total)),
      firstSentAt: sent.length ? Math.min(...sent) : null,
      lastServedAt: served.length ? Math.max(...served) : null
    }
  }

  /** Собирает сессию стола в тот же объект, с которым работают доменные правила. */
  async function loadSession(tx: any, number: string, lock = false): Promise<TableSession> {
    const tid = await tableUuid(tx, number)
    if (!tid) return emptySession()

    // Блокируем САМ СТОЛ, а не сессию: на свободном столе строки сессии ещё
    // нет, и `for update` по пустой выборке ничего не блокирует — двое гостей
    // с одним QR открывали два стола сразу. Блокировка родителя сериализует
    // их, а частичный уникальный индекс (миграция 0006) делает второй открытый
    // стол невозможным даже мимо этого кода.
    if (lock) await tx`select id from restaurant_tables where id = ${tid} for update`

    const rows = lock
      ? await tx`select * from table_sessions where table_id = ${tid} and closed_at is null limit 1 for update`
      : await tx`select * from table_sessions where table_id = ${tid} and closed_at is null limit 1`
    let row = rows[0]

    if (!row) {
      // Последняя закрытая — нужна витринам, чтобы показать «убрать стол»
      const [last] = await tx`
        select * from table_sessions where table_id = ${tid}
        order by closed_at desc nulls last limit 1
      `
      if (!last || !last.closed_at || Date.now() - new Date(last.closed_at).getTime() > RECENT_CLOSED_MS) {
        const fresh = emptySession()
        fresh.db = { tableUuid: tid, sessionUuid: null }
        return fresh
      }
      row = last
    }

    const [guests, lines, payments, tips, calls, refunds] = await Promise.all([
      tx`select * from guests where table_session_id = ${row.id} order by joined_at`,
      tx`select * from order_lines where table_session_id = ${row.id} order by seq`,
      tx`select * from payments where table_session_id = ${row.id} order by created_at`,
      tx`select * from tips where table_session_id = ${row.id} order by created_at`,
      tx`select * from calls where table_session_id = ${row.id} and ack_at is null order by created_at`,
      tx`select * from refunds where table_session_id = ${row.id} order by created_at`
    ])

    const ms = (v: any) => (v ? new Date(v).getTime() : null)

    const session: TableSession = {
      sessionId: row.id,
      status: row.closed_at ? 'closed' : 'open',
      openedAt: ms(row.opened_at),
      closedAt: ms(row.closed_at),
      personas: guests.map((g: any) => ({
        id: g.id,
        name: g.name,
        animal: g.animal,
        joinedAt: ms(g.joined_at) ?? 0,
        allergies: g.allergies ?? [],
        secretHash: g.secret_hash
      })),
      lines: lines.map((l: any) => ({
        uid: l.seq,
        dishId: l.dish_id,
        qty: l.qty,
        price: Number(l.price),
        options: l.options ?? {},
        comment: l.comment ?? null,
        shared: l.shared,
        sharedWith: l.shared_with ?? [],
        personaId: l.guest_id,
        sent: !!l.sent_at,
        served: !!l.served_at,
        cancelled: !!l.cancelled_at,
        sentAt: ms(l.sent_at),
        startedAt: ms(l.started_at),
        readyAt: ms(l.ready_at),
        readyBy: l.ready_by,
        cancelAck: !!l.cancel_ack,
        servedAt: ms(l.served_at),
        cancelledAt: ms(l.cancelled_at),
        cancelReason: l.cancel_reason,
        startedBy: l.started_by,
        servedBy: l.served_by
      })),
      payments: payments.map((p: any) => ({
        id: p.id,
        personaId: p.guest_id,
        amount: Number(p.amount),
        scope: p.scope,
        method: p.method ?? 'sbp',
        // В базе сотрудник — uuid, в ролях и журнале — строковый id
        takenBy: staffExt(p.taken_by),
        // Номер и состав чека: единственный документ, который гость может предъявить
        receiptNo: p.receipt_no ?? undefined,
        lines: p.receipt_lines ?? [],
        at: ms(p.created_at) ?? 0
      })),
      tips: tips.map((t: any) => ({
        id: t.id,
        personaId: t.guest_id,
        amount: Number(t.amount),
        at: ms(t.created_at) ?? 0,
        waiterId: t.waiter_id
      })),
      calls: calls.map((c: any) => ({
        id: c.id,
        at: ms(c.created_at) ?? 0,
        personaId: c.guest_id,
        reason: c.reason,
        note: c.note ?? null
      })),
      seq: (lines.at(-1)?.seq ?? 0) + 1,
      overpaid: Number(row.overpaid ?? 0),
      // Возвраты обязаны переживать перечитывание: без них сервер забывает,
      // что деньги гостю уже отдали, и предлагает вернуть их снова
      refunds: refunds.map((r: any) => ({
        id: r.id,
        personaId: r.guest_id,
        amount: Number(r.amount),
        method: r.method,
        at: ms(r.created_at) ?? 0,
        byId: staffExt(r.by_staff_id)
      })),
      cleanedAt: ms(row.cleaned_at),
      cashIntent: row.cash_intent ?? null,
      shiftId: row.shift_id ?? null,
      db: { tableUuid: tid, sessionUuid: row.id }
    }
    return session
  }

  /** Сохраняет агрегат целиком: позиций за столом десятки, экономить не на чем. */
  async function persist(tx: any, number: string, session: TableSession) {
    const tid = session.db?.tableUuid ?? (await tableUuid(tx, number))
    if (!tid) return

    let sid = session.db?.sessionUuid ?? null

    if (session.status === 'open' && !sid) {
      const shiftId = await currentShiftId(tx)
      // Идентификатор сессии задаём САМИ, тем самым, который уже ушёл гостю в
      // ответе на join. Раньше его генерировала база, и он не совпадал с тем,
      // что получил первый гость: клиент видел расхождение sessionId, считал
      // стол пересозданным и стирал личность — человек, который сам открыл
      // стол, на первом же обновлении оказывался «не отсюда», а его заказ
      // оставался висеть на осиротевшей персоне.
      const [created] = await tx`
        insert into table_sessions (id, table_id, shift_id, opened_at)
        values (
          ${session.sessionId ?? crypto.randomUUID()}, ${tid}, ${shiftId},
          ${new Date(session.openedAt ?? Date.now())}
        )
        returning id
      `
      sid = created.id
      session.sessionId = sid
      session.db = { tableUuid: tid, sessionUuid: sid }
    }
    if (!sid) return

    for (const p of session.personas) {
      await tx`
        insert into guests (id, table_session_id, name, animal, allergies, secret_hash, joined_at)
        values (
          ${p.id}, ${sid}, ${p.name}, ${p.animal}, ${p.allergies ?? []},
          ${p.secretHash}, ${new Date(p.joinedAt)}
        )
        on conflict (id) do update set
          name = excluded.name,
          animal = excluded.animal,
          allergies = excluded.allergies
      `
    }

    // Удалённые из корзины позиции надо именно удалить: раньше persist только
    // вставлял и обновлял, поэтому убранное блюдо возвращалось при следующем
    // чтении, а сервер честно отвечал «ок» — гость видел ноль реакции.
    const keep = session.lines.map(l => l.uid)
    await tx`
      delete from order_lines
      where table_session_id = ${sid}
        ${keep.length ? tx`and seq <> all(${keep}::int[])` : tx``}
    `

    for (const l of session.lines) {
      await tx`
        insert into order_lines (
          table_session_id, guest_id, seq, dish_id, name, price, qty, options, comment,
          shared, shared_with, sent_at, started_at, started_by, ready_at, ready_by,
          served_at, served_by, cancelled_at, cancelled_by, cancel_reason, cancel_ack
        ) values (
          ${sid}, ${l.personaId}, ${l.uid}, ${l.dishId}, ${dishName(l.dishId)}, ${l.price}, ${l.qty},
          ${tx.json(l.options ?? {})}, ${l.comment ?? null}, ${l.shared}, ${l.sharedWith ?? []},
          ${l.sentAt ? new Date(l.sentAt) : null}, ${l.startedAt ? new Date(l.startedAt) : null},
          ${staffUuid(l.startedBy)}, ${l.readyAt ? new Date(l.readyAt) : null}, ${staffUuid(l.readyBy)},
          ${l.servedAt ? new Date(l.servedAt) : null}, ${staffUuid(l.servedBy)},
          ${l.cancelledAt ? new Date(l.cancelledAt) : null}, ${staffUuid(l.cancelledBy)},
          ${l.cancelReason ?? null}, ${!!l.cancelAck}
        )
        on conflict (table_session_id, seq) do update set
          comment = excluded.comment,
          -- Список участников общего блюда проставляется ПОЗЖЕ, в момент отправки
          -- на кухню. Без него в обновлении доля навсегда оставалась пустой, и
          -- деление съезжало на «всех, кто сейчас за столом»: подсевший позже
          -- начинал платить за уже заказанное. Это главный инвариант продукта.
          shared = excluded.shared,
          shared_with = excluded.shared_with,
          sent_at = excluded.sent_at,
          started_at = excluded.started_at,
          started_by = excluded.started_by,
          ready_at = excluded.ready_at,
          ready_by = excluded.ready_by,
          served_at = excluded.served_at,
          served_by = excluded.served_by,
          cancelled_at = excluded.cancelled_at,
          cancelled_by = excluded.cancelled_by,
          cancel_reason = excluded.cancel_reason,
          cancel_ack = excluded.cancel_ack
      `
    }

    for (const p of session.payments) {
      await tx`
        insert into payments (
          id, table_session_id, guest_id, amount, scope, method, taken_by,
          receipt_no, receipt_lines, created_at
        ) values (
          ${p.id}, ${sid}, ${p.personaId}, ${p.amount}, ${p.scope},
          ${p.method ?? "sbp"}, ${staffUuid(p.takenBy)},
          ${p.receiptNo ?? null}, ${tx.json(p.lines ?? [])}, ${new Date(p.at)}
        )
        on conflict (id) do nothing
      `
    }

    for (const t of session.tips) {
      await tx`
        insert into tips (id, table_session_id, guest_id, waiter_id, amount, created_at)
        values (${t.id}, ${sid}, ${t.personaId}, ${staffUuid(t.waiterId)}, ${t.amount}, ${new Date(t.at)})
        on conflict (id) do nothing
      `
    }

    // Вызовы: снятые помечаем принятыми, новые добавляем
    const openIds = session.calls.map(c => c.id)
    await tx`
      update calls set ack_at = now()
      where table_session_id = ${sid} and ack_at is null
        ${openIds.length ? tx`and id <> all(${openIds}::uuid[])` : tx``}
    `
    for (const c of session.calls) {
      await tx`
        insert into calls (id, table_session_id, guest_id, reason, note, created_at)
        values (${c.id}, ${sid}, ${c.personaId}, ${c.reason}, ${c.note ?? null}, ${new Date(c.at)})
        on conflict (id) do update set note = coalesce(excluded.note, calls.note)
      `
    }

    // Уборка стола и просьба принять наличные — состояние сессии, а не позиций
    await tx`
      update table_sessions set
        cleaned_at = ${session.cleanedAt ? new Date(session.cleanedAt) : null},
        cash_intent = ${session.cashIntent ? tx.json(session.cashIntent) : null}
      where id = ${sid}
    `

    if (session.resetRequested) session.resetRequested = false // стол освобождён закрытием сессии
    if (session.status === 'closed') {
      const money = computeTotals(session, priceOf)
      await tx`
        update table_sessions set
          closed_at = ${new Date(session.closedAt ?? Date.now())},
          closed_with_debt = ${round2(session.closedWithDebt ?? money.remaining)},
          overpaid = ${round2(session.overpaid ?? 0)}
        where id = ${sid} and closed_at is null
      `
    }

    // Переплата живёт у ЗАКРЫТОЙ сессии, поэтому апдейт выше (он под
    // `closed_at is null`) её больше никогда не трогает. Возврат обязан
    // писаться отдельно — иначе он не переживает перечитывание из БД, и одну
    // и ту же переплату можно выдать сколько угодно раз.
    await tx`update table_sessions set overpaid = ${round2(session.overpaid ?? 0)} where id = ${sid}`

    for (const refund of session.refunds ?? []) {
      await tx`
        insert into refunds (id, table_session_id, guest_id, amount, method, reason, status, by_staff_id, created_at)
        values (
          ${refund.id}, ${sid}, ${refund.personaId}, ${refund.amount}, ${refund.method},
          'переплата', 'done', ${staffUuid(refund.byId)}, ${new Date(refund.at)}
        )
        on conflict (id) do nothing
      `
    }
  }

  return {
    kind: 'postgres',

    async read(tableId) {
      return loadSession(sql, tableId)
    },

    async withTable(tableId, apply) {
      return sql.begin(async (tx: any) => {
        const session = await loadSession(tx, tableId, true)
        const result = apply(session)
        await persist(tx, tableId, session)
        return result
      }) as Promise<MutationResult>
    },

    async activeSessions() {
      const rows = await sql`
        select rt.number
        from table_sessions ts
        join restaurant_tables rt on rt.id = ts.table_id
        where rt.venue_id = ${venueId}
          and (ts.closed_at is null or ts.closed_at > now() - interval '30 minutes')
      `
      const map = new Map<string, TableSession>()
      for (const row of rows) map.set(row.number, await loadSession(sql, row.number))
      return map
    },

    /** Смена считается из первички, а не из счётчиков — иначе кассу не свести. */
    async shift() {
      const [row] = await sql`
        with s as (
          select ts.*
          from table_sessions ts
          join restaurant_tables rt on rt.id = ts.table_id
          join shifts sh on sh.id = ts.shift_id
          where rt.venue_id = ${venueId} and sh.closed_at is null
        )
        select
          (select count(*) from s where closed_at is not null)                        as tables,
          -- Долг смены считается ТОЙ ЖЕ формулой, что и долг в чеке: получено
          -- минус оплачено по каждому закрытому столу. Раньше здесь суммировался
          -- closed_with_debt, и витрина расходилась с реестром на 3 320 ₽ —
          -- управляющей было нечем объяснить эту разницу владельцу, а экран
          -- при этом успокаивал словом «сходится».
          (select coalesce(sum(greatest(0, billed.total - billed.paid)), 0) from (
             select s.id,
               coalesce((select sum(ol.price * ol.qty) from order_lines ol
                          where ol.table_session_id = s.id
                            and ol.sent_at is not null and ol.cancelled_at is null), 0) as total,
               coalesce((select sum(p.amount) from payments p
                          where p.table_session_id = s.id), 0) as paid
             from s where s.closed_at is not null
           ) billed)                                                                    as debt,
          (select coalesce(sum(ol.price * ol.qty), 0)
             from order_lines ol join s on s.id = ol.table_session_id
            where s.closed_at is not null and ol.cancelled_at is not null)              as written_off,
          (select coalesce(sum(overpaid), 0) from s where closed_at is not null)      as overpaid,
          (select coalesce(sum(p.amount), 0) from payments p join s on s.id = p.table_session_id) as revenue,
          (select coalesce(sum(p.amount), 0) from payments p join s on s.id = p.table_session_id
            where s.closed_at is not null) as closed_revenue,
          (select count(*) from guests g join s on s.id = g.table_session_id)         as guests_seen,
          (select count(distinct p.table_session_id) from payments p join s on s.id = p.table_session_id
            where s.closed_at is not null)                                              as tables_with_revenue,
          (select count(distinct p.table_session_id) from payments p join s on s.id = p.table_session_id
            where s.closed_at is null)                                                  as open_tables_with_revenue,
          (select coalesce(min(sh.opened_at), now()) from shifts sh where sh.venue_id = ${venueId} and sh.closed_at is null) as started_at
      `
      const tipRows = await sql`
        select t.waiter_id, coalesce(sum(t.amount), 0) as amount
        from tips t
        join table_sessions ts on ts.id = t.table_session_id
        join restaurant_tables rt on rt.id = ts.table_id
        where rt.venue_id = ${venueId} and t.waiter_id is not null
        group by t.waiter_id
      `
      const tipsByStaff: Record<string, number> = Object.create(null)
      // Чаевые копятся под uuid сотрудника, а личный счётчик официанта ищет по
      // строковому id из конфига: без обратного перевода деньги приходили в
      // заведение и не доезжали до человека, который их заработал.
      for (const r of tipRows) {
        const ext = staffExt(r.waiter_id)
        if (ext) tipsByStaff[ext] = Number(r.amount)
      }

      return {
        tables: Number(row.tables),
        closedRevenue: Number(row.closed_revenue),
        tablesWithRevenue: Number(row.tables_with_revenue),
        revenue: Number(row.revenue),
        // Долг — только за то, что гость получил: снятое с кухни он не ел.
        // Вычитание уже сделано по каждому столу отдельно, в запросе.
        debt: round2(Number(row.debt)),
        writtenOff: round2(Number(row.written_off)),
        openTablesWithRevenue: Number(row.open_tables_with_revenue),
        overpaid: Number(row.overpaid),
        guests: Number(row.guests_seen),
        guestsSeen: Number(row.guests_seen),
        startedAt: new Date(row.started_at).getTime(),
        tipsByStaff
      } satisfies Shift
    },

    async audit(entry) {
      await sql`
        insert into audit_log (
          venue_id, at, actor_type, actor_id, guest_id, actor_name, session_id,
          action, table_id, amount, detail
        ) values (
          ${venueId}, ${new Date(entry.at)}, ${entry.role ? 'staff' : 'guest'},
          ${staffUuid(entry.staffId)}, ${entry.guestId ?? null},
          ${entry.name}, ${entry.sessionId ?? null}, ${entry.action},
          ${entry.tableId ? await tableUuid(sql, entry.tableId) : null},
          ${entry.amount ?? null}, ${entry.detail}
        )
      `
    },

    async auditEntries(limit) {
      const rows = await sql`
        select a.*, rt.number as table_number
        from audit_log a
        left join restaurant_tables rt on rt.id = a.table_id
        where a.venue_id = ${venueId}
        order by a.at desc
        limit ${limit}
      `
      return rows.map((r: any) => ({
        at: new Date(r.at).getTime(),
        staffId: r.actor_id,
        // Гость — тоже автор: в споре о деньгах «Гость» без id не ответ
        guestId: r.guest_id ?? null,
        name: r.actor_name ?? 'Гость',
        role: r.actor_type === 'staff' ? 'staff' : null,
        action: r.action,
        tableId: r.table_number,
        detail: r.detail,
        amount: r.amount === null ? null : Number(r.amount),
        sessionId: r.session_id
      })) as AuditEntry[]
    },

    async shiftChecks(limit, shiftId) {
      // Без shiftId — текущая смена; с ним — любая из истории
      const rows = shiftId
        ? await sql`
            select ts.*, rt.number as table_number
            from table_sessions ts
            join restaurant_tables rt on rt.id = ts.table_id
            where rt.venue_id = ${venueId} and ts.shift_id = ${shiftId} and ts.closed_at is not null
            order by ts.closed_at desc
            limit ${limit}
          `
        : await sql`
            select ts.*, rt.number as table_number
            from table_sessions ts
            join restaurant_tables rt on rt.id = ts.table_id
            join shifts sh on sh.id = ts.shift_id
            where rt.venue_id = ${venueId} and sh.closed_at is null and ts.closed_at is not null
            order by ts.closed_at desc
            limit ${limit}
          `
      const checks: ShiftCheck[] = []
      for (const row of rows) checks.push(await checkOfRow(row))
      return checks
    },

    async currentShift() {
      const [row] = await sql`
        select * from shifts where venue_id = ${venueId} and closed_at is null
        order by opened_at desc limit 1
      `
      return row ? shiftOfRow(row) : null
    },

    async openShift(byStaffId) {
      return sql.begin(async tx => {
        const [open] = await tx`select * from shifts where venue_id = ${venueId} and closed_at is null limit 1 for update`
        if (open) return shiftOfRow(open)
        // Вторую открытую смену не даёт индекс (0012): проиграв гонку, берём открытую
        const [row] = await tx`
          insert into shifts (venue_id, opened_by) values (${venueId}, ${staffUuid(byStaffId)})
          on conflict (venue_id) where closed_at is null do nothing
          returning *
        `
        if (!row) {
          const [winner] = await tx`select * from shifts where venue_id = ${venueId} and closed_at is null limit 1`
          return shiftOfRow(winner)
        }
        // Перенесённые столы — открытые на момент закрытия прошлой смены —
        // переходят в новую; туда же — закрывшиеся, пока смены не было, иначе
        // их деньги не попали бы ни в один отчёт
        const [prev] = await tx`
          select id, closed_at from shifts
          where venue_id = ${venueId} and closed_at is not null
          order by closed_at desc limit 1
        `
        await tx`
          update table_sessions ts set shift_id = ${row.id}
          from restaurant_tables rt
          where rt.id = ts.table_id and rt.venue_id = ${venueId}
            and (ts.closed_at is null
              or (ts.shift_id is null and ts.closed_at > coalesce(${prev?.closed_at ?? null}::timestamptz, '-infinity'))
              or (${prev?.id ?? null}::uuid is not null and ts.shift_id = ${prev?.id ?? null}::uuid and ts.closed_at > ${prev?.closed_at ?? null}::timestamptz))
        `
        return shiftOfRow(row)
      }) as Promise<ShiftInfo>
    },

    async closeShift(report, byStaffId) {
      const [row] = await sql`
        update shifts set closed_at = now(), closed_by = ${staffUuid(byStaffId)}, report = ${sql.json(report as any)}
        where venue_id = ${venueId} and closed_at is null
        returning *
      `
      return row ? shiftOfRow(row) : null
    },

    async shiftHistory(limit) {
      const rows = await sql`
        select * from shifts where venue_id = ${venueId} and closed_at is not null
        order by closed_at desc limit ${limit}
      `
      return rows.map(shiftOfRow)
    },

    async checksWithDebt(sinceMs) {
      const rows = await sql`
        select ts.*, rt.number as table_number
        from table_sessions ts
        join restaurant_tables rt on rt.id = ts.table_id
        where rt.venue_id = ${venueId} and ts.closed_at is not null
          and ts.closed_at >= ${new Date(Date.now() - sinceMs)}
          and coalesce((select sum(l.price * l.qty) from order_lines l
                         where l.table_session_id = ts.id and l.sent_at is not null and l.cancelled_at is null), 0)
            > coalesce((select sum(p.amount) from payments p where p.table_session_id = ts.id), 0) + 0.01
        order by ts.closed_at desc
        limit 200
      `
      const checks: ShiftCheck[] = []
      for (const row of rows) checks.push(await checkOfRow(row))
      return checks
    },

    async settlements() {
      const rows = await sql`
        select d.*, rt.number as table_number
        from debt_settlements d
        join table_sessions ts on ts.id = d.table_session_id
        join restaurant_tables rt on rt.id = ts.table_id
        where d.venue_id = ${venueId}
        order by d.created_at
      `
      return rows.map(
        (r: any): Settlement => ({
          id: r.id,
          sessionId: r.table_session_id,
          tableId: r.table_number,
          kind: r.kind,
          amount: Number(r.amount),
          method: r.method ?? null,
          reason: r.reason ?? null,
          byId: staffExt(r.by_staff_id),
          at: new Date(r.created_at).getTime()
        })
      )
    },

    async addSettlement(x) {
      const [r] = await sql`
        insert into debt_settlements (venue_id, table_session_id, kind, amount, method, reason, by_staff_id)
        values (${venueId}, ${x.sessionId}, ${x.kind}, ${x.amount}, ${x.method}, ${x.reason}, ${staffUuid(x.byId)})
        on conflict (table_session_id) do nothing
        returning *
      `
      return r ? { ...x, id: r.id, at: new Date(r.created_at).getTime() } : null
    },

    async decisionNotes() {
      const rows = await sql`select * from decision_notes where venue_id = ${venueId} order by created_at`
      return rows.map(
        (r: any): DecisionNote => ({ key: r.key, text: r.text, byId: staffExt(r.by_staff_id), at: new Date(r.created_at).getTime() })
      )
    },

    async addDecisionNote(n) {
      await sql`
        insert into decision_notes (venue_id, key, text, by_staff_id)
        values (${venueId}, ${n.key}, ${n.text}, ${staffUuid(n.byId)})
        on conflict (venue_id, key) do update set text = excluded.text, by_staff_id = excluded.by_staff_id, created_at = now()
      `
    },

    async shiftCheckTotals() {
      // Те же формулы, что и в чеке, но одним запросом по всем закрытым столам
      // смены: сверка не имеет права зависеть от того, сколько строк влезло на экран.
      const [row] = await sql`
        with closed as (
          select ts.id, ts.overpaid
          from table_sessions ts
          join restaurant_tables rt on rt.id = ts.table_id
          join shifts sh on sh.id = ts.shift_id
          where rt.venue_id = ${venueId} and sh.closed_at is null and ts.closed_at is not null
        ), money as (
          select c.id, c.overpaid,
            coalesce((select sum(l.price * l.qty) from order_lines l
                       where l.table_session_id = c.id
                         and l.sent_at is not null and l.cancelled_at is null), 0) as total,
            coalesce((select sum(p.amount) from payments p
                       where p.table_session_id = c.id), 0)                        as paid,
            coalesce((select sum(l.price * l.qty) from order_lines l
                       where l.table_session_id = c.id and l.cancelled_at is not null), 0) as written_off
          from closed c
        )
        select count(*) as n,
               coalesce(sum(round(paid, 2)), 0)                                     as paid,
               -- Округляем ПО КАЖДОМУ чеку, ровно как в самом чеке: иначе
               -- цена с тремя знаками разведёт debtMatches на копейку
               coalesce(sum(greatest(0, round(total, 2) - round(paid, 2))), 0)       as debt,
               coalesce(sum(overpaid), 0)                    as overpaid,
               coalesce(sum(written_off), 0)                 as written_off
        from money
      `
      return {
        count: Number(row.n),
        paid: round2(Number(row.paid)),
        debt: round2(Number(row.debt)),
        overpaid: round2(Number(row.overpaid)),
        cancelledTotal: round2(Number(row.written_off))
      }
    },

    async stopOverrides() {
      const rows = await sql`select dish_id, stop from menu_stop where venue_id = ${venueId}`
      return Object.fromEntries(rows.map(r => [r.dish_id as string, Boolean(r.stop)]))
    },

    async setStop(dishId, stop, byStaffId) {
      await sql`
        insert into menu_stop (venue_id, dish_id, stop, updated_by)
        values (${venueId}, ${dishId}, ${stop}, ${staffUuid(byStaffId)})
        on conflict (venue_id, dish_id)
        do update set stop = excluded.stop, updated_at = now(), updated_by = excluded.updated_by
      `
    },

    async menuDoc(kind) {
      const [row] = await sql`select doc, updated_at, updated_by from menu_docs where venue_id = ${venueId} and kind = ${kind}`
      return row ? { doc: row.doc, updatedAt: msOf(row.updated_at)!, updatedBy: staffExt(row.updated_by) } : null
    },

    async saveMenuDoc(kind, doc, byStaffId) {
      if (doc === null) {
        await sql`delete from menu_docs where venue_id = ${venueId} and kind = ${kind}`
        return
      }
      await sql`
        insert into menu_docs (venue_id, kind, doc, updated_by)
        values (${venueId}, ${kind}, ${sql.json(doc as any)}, ${staffUuid(byStaffId)})
        on conflict (venue_id, kind)
        do update set doc = excluded.doc, updated_at = now(), updated_by = excluded.updated_by
      `
    },

    async savePhoto(mime, data) {
      const [row] = await sql`insert into menu_photos (venue_id, mime, data) values (${venueId}, ${mime}, ${data}) returning id`
      return row.id as string
    },

    async photo(id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return null
      const [row] = await sql`select mime, data from menu_photos where id = ${id} and venue_id = ${venueId}`
      return row ? { mime: row.mime as string, data: Buffer.from(row.data) } : null
    },

    async settings() {
      const [row] = await sql`select settings from venues where id = ${venueId}`
      const doc = row?.settings as Record<string, unknown> | undefined
      // Пустой {} — значение по умолчанию из первой миграции, а не сохранённые настройки
      if (!doc || !doc.savedAt) return null
      return { doc, savedAt: Number(doc.savedAt) }
    },

    async saveSettings(doc) {
      const savedAt = Date.now()
      const name = String((doc as any)?.venue?.name ?? '').trim()
      await sql`
        update venues set settings = ${sql.json({ ...(doc as object), savedAt } as any)}
          ${name ? sql`, name = ${name}` : sql``}
         where id = ${venueId}
      `
      return savedAt
    },

    async staffList() {
      const rows = await sql`
        select s.ext_id, s.name, s.role, s.pin_hash, s.phone,
               (s.active_to is null or s.active_to > now()) as active,
               coalesce(array_agg(t.number order by t.number) filter (where t.number is not null), '{}') as tables
          from staff s
          left join staff_tables st on st.staff_id = s.id
          left join restaurant_tables t on t.id = st.table_id
         where s.ext_id is not null and (s.venue_id = ${venueId} or s.venue_id is null)
         group by s.id
         order by s.created_at
      `
      if (!rows.length) return null
      return rows.map(r => ({
        id: r.ext_id as string,
        name: r.name as string,
        role: r.role as string,
        pinHash: r.pin_hash as string,
        phone: (r.phone as string | null) ?? null,
        active: Boolean(r.active),
        tables: (r.tables as string[]).map(String)
      }))
    },

    async saveStaff(rec) {
      await sql.begin(async tx => {
        const [found] = await tx`select id from staff where ext_id = ${rec.id} limit 1`
        let id: string
        if (found) {
          id = found.id
          await tx`
            update staff set name = ${rec.name}, role = ${rec.role}, pin_hash = ${rec.pinHash}, phone = ${rec.phone},
                   active_to = ${rec.active ? null : sql`coalesce(active_to, now())`}
             where id = ${id}
          `
        } else {
          const [created] = await tx`
            insert into staff (org_id, venue_id, name, role, pin_hash, ext_id, phone, active_to)
            select org_id, ${venueId}, ${rec.name}, ${rec.role}, ${rec.pinHash}, ${rec.id}, ${rec.phone}, ${rec.active ? null : new Date()}
              from venues where id = ${venueId}
            returning id
          `
          id = created.id
        }
        await tx`delete from staff_tables where staff_id = ${id}`
        if (rec.tables.length) {
          await tx`
            insert into staff_tables (staff_id, table_id)
            select ${id}, t.id from restaurant_tables t where t.venue_id = ${venueId} and t.number in ${sql(rec.tables)}
          `
        }
      })
      await refreshStaff()
    },

    async close() {
      await sql.end()
    }
  }
}
