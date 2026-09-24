// Отчёт смены: X — пока смена идёт, Z — замороженный при закрытии.
//
// Одна функция на оба случая и на обе витрины (обзор и карточку смены):
// раньше цифры смены считались в трёх местах по-разному, и сводка спорила с
// реестром чеков. Функция чистая — на входе чеки смены, на выходе цифры.

import { round2 } from './money.ts'

export type PayMethodKey = 'sbp' | 'card' | 'cash'

/** Чек стола в смене. Открытый стол — тот же чек с `closedAt: null`. */
export interface ReportCheck {
  sessionId: string
  tableId: string
  openedAt: number
  closedAt: number | null
  guests: number
  waiter: string | null
  /** Счёт: отправленное и не снятое. */
  total: number
  paid: number
  /** Получено и не оплачено — только у закрытого стола. */
  debt: number
  /** Переплата, которую ещё не вернули. */
  overpaid: number
  /** Сколько уже вернули гостям. */
  refunded: number
  /** Снято с кухни — еду не отдали. */
  cancelledTotal: number
  payments: { amount: number; method: string; at: number }[]
  tips: { amount: number; waiter: string | null }[]
  lines: { name: string; qty: number; amount: number; cancelled: boolean }[]
}

export interface ShiftReport {
  revenue: number
  /** Выручка за вычетом возвратов — то, что заведение действительно заработало. */
  netRevenue: number
  byMethod: Record<PayMethodKey, number>
  /** Закрытых столов. */
  checks: number
  guests: number
  avgCheck: number
  tips: number
  tipsByWaiter: { name: string; amount: number }[]
  debt: number
  refunds: number
  /** Переплата, которую ещё предстоит вернуть. */
  toRefund: number
  writtenOff: number
  openTables: number
  openRemaining: number
  byHour: { hour: number; amount: number }[]
  waiters: { name: string; revenue: number; tables: number; tips: number }[]
  top: { name: string; qty: number }[]
  low: { name: string; qty: number }[]
}

const methodOf = (m: string): PayMethodKey => (m === 'cash' ? 'cash' : m === 'card' ? 'card' : 'sbp')

export function buildShiftReport(checks: ReportCheck[]): ShiftReport {
  const closed = checks.filter(c => c.closedAt !== null)
  const open = checks.filter(c => c.closedAt === null)

  const byMethod: Record<PayMethodKey, number> = { sbp: 0, card: 0, cash: 0 }
  const hours = new Map<number, number>()
  for (const c of checks) {
    for (const p of c.payments) {
      byMethod[methodOf(p.method)] = round2(byMethod[methodOf(p.method)] + p.amount)
      const hour = new Date(p.at).getHours()
      hours.set(hour, round2((hours.get(hour) ?? 0) + p.amount))
    }
  }
  const revenue = round2(byMethod.sbp + byMethod.card + byMethod.cash)
  const refunds = round2(checks.reduce((a, c) => a + c.refunded, 0))

  // Часы — сплошным рядом от первого до последнего: пустой час на графике
  // тоже информация («в 16 никого»), а не повод его выкинуть
  const hourKeys = [...hours.keys()].sort((a, b) => a - b)
  const byHour =
    hourKeys.length === 0
      ? []
      : Array.from({ length: hourKeys.at(-1)! - hourKeys[0] + 1 }, (_, i) => {
          const hour = hourKeys[0] + i
          return { hour, amount: hours.get(hour) ?? 0 }
        })

  const withMoney = checks.filter(c => c.payments.length > 0)

  const tipsMap = new Map<string, number>()
  for (const c of checks)
    for (const t of c.tips) {
      const name = t.waiter ?? 'без официанта'
      tipsMap.set(name, round2((tipsMap.get(name) ?? 0) + t.amount))
    }

  const waiterMap = new Map<string, { revenue: number; tables: number; tips: number }>()
  for (const c of checks) {
    const name = c.waiter ?? 'не закреплён'
    const w = waiterMap.get(name) ?? { revenue: 0, tables: 0, tips: 0 }
    waiterMap.set(name, {
      revenue: round2(w.revenue + c.payments.reduce((a, p) => a + p.amount, 0)),
      tables: w.tables + 1,
      tips: round2(w.tips + c.tips.reduce((a, t) => a + t.amount, 0))
    })
  }

  const dishes = new Map<string, number>()
  for (const c of checks) for (const l of c.lines) if (!l.cancelled) dishes.set(l.name, (dishes.get(l.name) ?? 0) + l.qty)
  const sold = [...dishes.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty)

  return {
    revenue,
    netRevenue: round2(revenue - refunds),
    byMethod,
    checks: closed.length,
    guests: checks.reduce((a, c) => a + c.guests, 0),
    avgCheck: withMoney.length ? round2(revenue / withMoney.length) : 0,
    tips: round2([...tipsMap.values()].reduce((a, x) => a + x, 0)),
    tipsByWaiter: [...tipsMap.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    debt: round2(closed.reduce((a, c) => a + c.debt, 0)),
    refunds,
    toRefund: round2(closed.reduce((a, c) => a + c.overpaid, 0)),
    writtenOff: round2(checks.reduce((a, c) => a + c.cancelledTotal, 0)),
    openTables: open.length,
    openRemaining: round2(open.reduce((a, c) => a + Math.max(0, c.total - c.paid), 0)),
    byHour,
    waiters: [...waiterMap.entries()]
      .map(([name, w]) => ({ name, ...w }))
      .sort((a, b) => b.revenue - a.revenue),
    top: sold.slice(0, 5),
    // Аутсайдеры — хуже всего продающиеся, по возрастанию
    low: [...sold].sort((a, b) => a.qty - b.qty).slice(0, 4)
  }
}
