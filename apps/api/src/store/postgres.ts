// Хранилище в Postgres. Состояние стола переживает рестарт, а деньги считаются
// под блокировкой строки сессии: двое одновременно не спишут один и тот же остаток.
import { connect } from '@easypay/db'
import { computeTotals, round2 } from '@easypay/domain/money'
import { dishName, priceOf } from '../menu.ts'
import { waiterOfTable } from '../staff.ts'
import type { AuditEntry, MutationResult, Shift, TableSession } from '../types.ts'
import type { ShiftCheck, Store } from './types.ts'
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

  async function currentShiftId(tx: any): Promise<string> {
    const [open] = await tx`select id from shifts where venue_id = ${venueId} and closed_at is null limit 1`
    if (open) return open.id
    const [created] = await tx`insert into shifts (venue_id) values (${venueId}) returning id`
    return created.id
  }

  /** Собирает сессию стола в тот же объект, с которым работают доменные правила. */
  async function loadSession(tx: any, number: string, lock = false): Promise<TableSession> {
    const tid = await tableUuid(tx, number)
    if (!tid) return emptySession()

    const rows = lock
      ? await tx`select * from table_sessions where table_id = ${tid} and closed_at is null for update`
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

    const [guests, lines, payments, tips, calls] = await Promise.all([
      tx`select * from guests where table_session_id = ${row.id} order by joined_at`,
      tx`select * from order_lines where table_session_id = ${row.id} order by seq`,
      tx`select * from payments where table_session_id = ${row.id} order by created_at`,
      tx`select * from tips where table_session_id = ${row.id} order by created_at`,
      tx`select * from calls where table_session_id = ${row.id} and ack_at is null order by created_at`
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
      cleanedAt: ms(row.cleaned_at),
      cashIntent: row.cash_intent ?? null,
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
      const [created] = await tx`
        insert into table_sessions (table_id, shift_id, opened_at)
        values (${tid}, ${shiftId}, ${new Date(session.openedAt ?? Date.now())})
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
          (select coalesce(sum(closed_with_debt), 0) from s where closed_at is not null) as gross_debt,
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
        // Долг — только за то, что гость получил: снятое с кухни он не ел
        debt: Math.max(0, round2(Number(row.gross_debt) - Number(row.written_off))),
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

    async shiftChecks(limit) {
      const rows = await sql`
        select ts.*, rt.number as table_number
        from table_sessions ts
        join restaurant_tables rt on rt.id = ts.table_id
        join shifts sh on sh.id = ts.shift_id
        where rt.venue_id = ${venueId} and sh.closed_at is null and ts.closed_at is not null
        order by ts.closed_at desc
        limit ${limit}
      `
      const checks: ShiftCheck[] = []
      for (const row of rows) {
        const [lines, payments, tips, guests] = await Promise.all([
          sql`select l.*, g.name as guest_name from order_lines l
              left join guests g on g.id = l.guest_id
              where l.table_session_id = ${row.id} order by l.seq`,
          sql`select coalesce(sum(amount), 0) as total from payments where table_session_id = ${row.id}`,
          sql`select coalesce(sum(amount), 0) as total from tips where table_session_id = ${row.id}`,
          sql`select count(*) as n from guests where table_session_id = ${row.id}`
        ])
        const billed = lines.filter((l: any) => l.sent_at && !l.cancelled_at)
        const total = billed.reduce((s: number, l: any) => s + Number(l.price) * l.qty, 0)
        checks.push({
          tableId: row.table_number,
          sessionId: row.id,
          openedAt: new Date(row.opened_at).getTime(),
          closedAt: row.closed_at ? new Date(row.closed_at).getTime() : null,
          guests: Number(guests[0].n),
          waiter: waiterOfTable(row.table_number)?.name ?? null,
          lines: lines.map((l: any) => ({
            name: l.name,
            qty: l.qty,
            price: Number(l.price),
            amount: round2(Number(l.price) * l.qty),
            options: l.options ?? {},
            guest: l.guest_name ?? null,
            cancelled: !!l.cancelled_at,
            cancelReason: l.cancel_reason
          })),
          total: round2(total),
          paid: round2(Number(payments[0].total)),
          // Та же формула, что в памяти и в смене: получено минус оплачено
          debt: round2(Math.max(0, Number(row.total ?? 0) - Number(row.paid ?? 0))),
          overpaid: round2(Number(row.overpaid)),
          tips: round2(Number(tips[0].total)),
          cancelledTotal: round2(
            lines
              .filter((l: any) => l.cancelled_at)
              .reduce((s: number, l: any) => s + Number(l.price) * l.qty, 0)
          )
        })
      }
      return checks
    },

    async close() {
      await sql.end()
    }
  }
}
