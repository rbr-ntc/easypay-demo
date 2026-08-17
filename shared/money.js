// Денежная модель EasyPay — ЕДИНСТВЕННАЯ реализация для сервера и клиента.
// Простой ESM без зависимостей: Node исполняет файл напрямую, Vite/TS импортируют как есть
// (типы — в money.d.ts). Раньше эта логика жила двумя копиями — на сервере и в store.tsx.

/** Сценарии оплаты: своё (+доля общего) / поровну на всех / весь остаток стола. */
export const PAY_SCOPES = ['own', 'equal', 'full']

/** Деньги храним и отдаём с точностью до копейки. */
export function round2(n) {
  const x = Number(n)
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0
}

/**
 * Считает всё по столу. Цены приходят снаружи (`priceOf`), потому что сервер берёт их
 * из menu.json на диске, а клиент — из импортированного меню.
 */
export function computeTotals(state, priceOf) {
  const personas = state?.personas ?? []
  const lines = state?.lines ?? []
  const payments = state?.payments ?? []

  const participants = Math.max(1, personas.length)
  const lineTotal = l => (Number(priceOf(l.dishId)) || 0) * (Number(l.qty) || 0)
  const sumOf = arr => arr.reduce((s, l) => s + lineTotal(l), 0)

  const sharedTotal = sumOf(lines.filter(l => l.shared))
  const ownAll = sumOf(lines.filter(l => !l.shared))
  const tableTotal = ownAll + sharedTotal
  // Общие блюда делятся поровну на всех, кто за столом
  const share = sharedTotal / participants
  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const remaining = Math.max(0, tableTotal - paidTotal)

  const ownOf = pid => (pid ? sumOf(lines.filter(l => !l.shared && l.personaId === pid)) : 0)
  const paidOf = pid =>
    pid ? payments.filter(p => p.personaId === pid).reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0
  const totalOf = pid => ownOf(pid) + share
  const remainingOf = pid => Math.max(0, totalOf(pid) - paidOf(pid))

  return {
    participants,
    sharedTotal,
    ownAll,
    tableTotal,
    share,
    paidTotal,
    remaining,
    ownOf,
    paidOf,
    totalOf,
    remainingOf
  }
}

/**
 * Сколько персона платит по выбранному сценарию. Любая сумма ограничена неоплаченным
 * остатком стола — это защита от двойной оплаты, когда двое платят одновременно
 * (docs/architecture/payments-fiscal.md).
 */
export function amountFor(totals, personaId, scope) {
  if (scope === 'full') return round2(totals.remaining)
  if (scope === 'equal') return round2(Math.min(totals.remaining, totals.tableTotal / totals.participants))
  return round2(Math.min(totals.remainingOf(personaId), totals.remaining))
}
