// Хранилище в памяти: быстрые тесты и запуск демо без базы.
// Поведение обязано совпадать с Postgres-реализацией — на обеих гоняется один набор тестов.
import { computeTotals, isBillLine, round2 } from '@easypay/domain/money'
import { dishName, priceOf } from '../menu.ts'
import { waiterOfTable } from '../staff.ts'
import type { AuditEntry, MutationResult, Shift, TableSession } from '../types.ts'
import type { ShiftCheck, Store } from './types.ts'

const MAX_TABLES = 500
const AUDIT_MAX = 400
const CLOSED_TTL = 2 * 60 * 60 * 1000

export function emptySession(status: 'open' | 'closed' = 'closed'): TableSession {
  return {
    sessionId: null,
    status,
    openedAt: null,
    closedAt: null,
    personas: [],
    lines: [],
    payments: [],
    tips: [],
    calls: [],
    seq: 1
  }
}

function freshShift(): Shift {
  return {
    tables: 0,
    closedRevenue: 0,
    tablesWithRevenue: 0,
    revenue: 0,
    debt: 0,
    overpaid: 0,
    guests: 0,
    guestsSeen: 0,
    startedAt: Date.now(),
    tipsByStaff: Object.create(null)
  }
}

export function createMemoryStore(): Store {
  const tables = new Map<string, TableSession>()
  /** Сколько чеков держим целиком: их состав нужен только для показа. */
  const CHECKS_KEPT = 200
  const closedChecks: ShiftCheck[] = []
  /** Свод по ВСЕМ чекам смены — живёт отдельно от обрезанного списка. */
  const checkTotals = { count: 0, paid: 0, debt: 0, overpaid: 0, cancelledTotal: 0 }
  const auditLog: AuditEntry[] = []
  const shift = freshShift()
  let guestsSeen = 0

  const sweeper = setInterval(() => {
    const cutoff = Date.now() - CLOSED_TTL
    for (const [id, t] of tables) {
      if (t.status === 'closed' && (t.closedAt ?? 0) < cutoff) tables.delete(id)
    }
  }, 10 * 60 * 1000)
  sweeper.unref()

  function getTable(id: string): TableSession {
    if (!tables.has(id)) {
      if (tables.size >= MAX_TABLES) {
        const victim = [...tables.entries()].find(([, t]) => t.status === 'closed')
        if (victim) tables.delete(victim[0])
      }
      tables.set(id, emptySession())
    }
    return tables.get(id)!
  }

  /** Чек закрытой сессии собираем в момент закрытия — потом состав уже не восстановить. */
  function rememberCheck(tableId: string, session: TableSession) {
    const money = computeTotals(session, priceOf)
    const nameOf = (pid: string) => session.personas.find(p => p.id === pid)?.name ?? null
    const check: ShiftCheck = {
      tableId,
      sessionId: session.sessionId ?? '',
      openedAt: session.openedAt ?? 0,
      closedAt: session.closedAt ?? Date.now(),
      guests: session.personas.length,
      waiter: waiterOfTable(tableId)?.name ?? null,
      lines: session.lines.map(l => ({
        name: dishName(l.dishId),
        qty: l.qty,
        price: l.price,
        amount: round2(l.price * l.qty),
        options: l.options ?? {},
        guest: nameOf(l.personaId),
        cancelled: !!l.cancelled,
        cancelReason: l.cancelReason ?? null
      })),
      total: round2(money.tableTotal),
      paid: round2(money.paidTotal),
      // Долг чека = что гость получил и не оплатил. Снятое с кухни живёт
      // отдельной строкой cancelledTotal и в долг не входит: одна формула
      // на смену и на чек, иначе документ спорит сам с собой
      debt: round2(Math.max(0, round2(money.tableTotal) - round2(money.paidTotal))),
      overpaid: round2(session.overpaid ?? 0),
      tips: round2(session.tips.reduce((s, t) => s + t.amount, 0)),
      cancelledTotal: round2(
        session.lines.filter(l => l.cancelled).reduce((s, l) => s + l.price * l.qty, 0)
      )
    }
    closedChecks.unshift(check)

    // Итоги копим счётчиком, а не пересчитываем по массиву: массив обрезан
    // двумя сотнями последних чеков, и свод по нему занижал смену молча
    checkTotals.count += 1
    checkTotals.paid = round2(checkTotals.paid + check.paid)
    checkTotals.debt = round2(checkTotals.debt + Math.max(0, round2(check.total - check.paid)))
    checkTotals.overpaid = round2(checkTotals.overpaid + check.overpaid)
    checkTotals.cancelledTotal = round2(checkTotals.cancelledTotal + check.cancelledTotal)

    if (closedChecks.length > CHECKS_KEPT) closedChecks.pop()
  }

  /** Свести замороженный чек с текущей переплатой сессии после возврата. */
  function settleOverpaid(session: TableSession) {
    const check = closedChecks.find(c => c.sessionId === session.sessionId)
    if (!check) return
    const left = round2(session.overpaid ?? 0)
    if (Math.abs(check.overpaid - left) < 0.005) return
    checkTotals.overpaid = round2(checkTotals.overpaid - (check.overpaid - left))
    check.overpaid = left
  }

  return {
    kind: 'memory',

    async read(tableId) {
      return tables.get(tableId) ?? emptySession()
    },

    async withTable(tableId, apply) {
      const session = getTable(tableId)
      const wasOpen = session.status === 'open'
      const guestsBefore = session.personas.length

      const result = apply(session)

      if (session.personas.length > guestsBefore) guestsSeen += session.personas.length - guestsBefore
      // Сессию закрыли этим действием — фиксируем чек, пока состав ещё на руках
      if (wasOpen && session.status === 'closed') rememberCheck(tableId, session)
      // Переплату вернули: чек и итоги смены заморожены в момент закрытия, и без
      // сведения зал продолжал бы требовать отдать уже отданные деньги
      else if (session.status === 'closed') settleOverpaid(session)
      if (session.resetRequested) {
        // Стол освобождается: отменённые позиции оставляем кухне, остальное забываем
        const cancelled = session.lines.filter(l => l.cancelled)
        const fresh = emptySession()
        fresh.lines = cancelled
        tables.set(tableId, fresh)
      }
      return result
    },

    async activeSessions() {
      return new Map(tables)
    },

    /** Смена выводится из первички: закрытые чеки + деньги на открытых столах. */
    async shift() {
      const openTables = [...tables.values()].filter(t => t.status === 'open')
      const openPaid = openTables.reduce((s, t) => s + t.payments.reduce((x, p) => x + p.amount, 0), 0)
      const tipsByStaff: Record<string, number> = Object.create(null)
      const addTips = (tips: { waiterId: string | null; amount: number }[]) => {
        for (const tip of tips) if (tip.waiterId) tipsByStaff[tip.waiterId] = (tipsByStaff[tip.waiterId] ?? 0) + tip.amount
      }
      for (const t of tables.values()) addTips(t.tips)

      const closed = closedChecks
      return {
        tables: closed.length,
        closedRevenue: round2(closed.reduce((s, c) => s + c.paid, 0)),
        // Только закрытые столы с деньгами: это знаменатель среднего чека,
        // и он обязан считаться по тому же множеству, что и closedRevenue
        tablesWithRevenue: closed.filter(c => c.paid > 0).length,
        openTablesWithRevenue: openTables.filter(t => t.payments.length > 0).length,
        revenue: round2(closed.reduce((s, c) => s + c.paid, 0) + openPaid),
        // Долг за то, что гость получил и не оплатил, посчитанный той же
        // формулой, что и в чеке: иначе витрина расходится с реестром
        debt: round2(closed.reduce((s, c) => s + Math.max(0, round2(c.total - c.paid)), 0)),
        // Снятое с кухни: еду не отдали, ингредиенты потеряли — считается отдельно
        writtenOff: round2(closed.reduce((s, c) => s + c.cancelledTotal, 0)),
        overpaid: round2(closed.reduce((s, c) => s + c.overpaid, 0)),
        guests: guestsSeen,
        guestsSeen,
        startedAt: shift.startedAt,
        tipsByStaff
      }
    },

    async audit(entry) {
      auditLog.push(entry)
      if (auditLog.length > AUDIT_MAX) auditLog.shift()
    },

    async auditEntries(limit) {
      return [...auditLog].reverse().slice(0, limit)
    },

    async shiftChecks(limit) {
      return closedChecks.slice(0, limit)
    },

    async shiftCheckTotals() {
      // Свод по ВСЕМ чекам смены, включая те, чей состав уже вытеснен из памяти
      return { ...checkTotals }
    },


    async close() {
      clearInterval(sweeper)
    }
  }
}

/** Помощник для реализаций: позиции, попавшие в счёт. */
export const billLinesOf = (session: TableSession) => session.lines.filter(isBillLine)
