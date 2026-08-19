// Денежная модель EasyPay — ЕДИНСТВЕННАЯ реализация для сервера и клиента.
// Простой ESM без зависимостей: Node исполняет файл напрямую, Vite/TS импортируют как есть
// (типы — в money.d.ts).
//
// Два правила, на которых держится честность счёта:
//  1. СЧЁТ — это отправленное на кухню. Черновик корзины в счёт не входит и не считается
//     долгом стола: гость ничего не должен за то, что ещё не заказал.
//  2. ДОЛЯ ОБЩЕГО ФИКСИРУЕТСЯ В МОМЕНТ ЗАКАЗА. Общее блюдо делится между теми, кто сидел
//     за столом, когда его заказали (список в line.sharedWith). Подсевший позже не платит
//     за съеденное до него, а заплативший раньше не переплачивает задним числом.

/** Сценарии оплаты: своё (+доля общего) / поровну на всех / весь остаток стола. */
export const PAY_SCOPES = ['own', 'equal', 'full']

/** Деньги храним и отдаём с точностью до копейки. */
export function round2(n) {
  const x = Number(n)
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0
}

/** Позиция попадает в счёт, только когда отправлена на кухню и не отменена. */
export function isBillLine(line) {
  return !!line?.sent && !line?.cancelled
}

function lineAmount(line, priceOf) {
  const unit = Number(line?.price ?? priceOf(line?.dishId)) || 0
  return unit * (Number(line?.qty) || 0)
}

/** Между кем делится общее блюдо: список с позиции, иначе (для старых данных) — все за столом. */
function sharersOf(line, personaIds) {
  const listed = (line?.sharedWith ?? []).filter(id => personaIds.includes(id))
  return listed.length > 0 ? listed : personaIds
}

/**
 * Считает всё по столу. Цены приходят снаружи (`priceOf`), потому что сервер берёт их
 * из menu.json на диске, а клиент — из импортированного меню.
 */
export function computeTotals(state, priceOf) {
  const personas = state?.personas ?? []
  const lines = state?.lines ?? []
  const payments = state?.payments ?? []
  const personaIds = personas.map(p => p.id)

  const participants = Math.max(1, personas.length)
  const bill = lines.filter(isBillLine)
  const drafts = lines.filter(l => !l.sent && !l.cancelled)

  const sumOf = arr => arr.reduce((s, l) => s + lineAmount(l, priceOf), 0)
  const sharedLines = bill.filter(l => l.shared)
  const sharedTotal = sumOf(sharedLines)
  const ownAll = sumOf(bill.filter(l => !l.shared))
  const tableTotal = ownAll + sharedTotal

  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const remaining = Math.max(0, tableTotal - paidTotal)

  // Доля персоны в общих блюдах — только по тем, где она в списке участников
  const shareOf = pid => {
    if (!pid) return 0
    return sharedLines.reduce((sum, line) => {
      const sharers = sharersOf(line, personaIds)
      if (!sharers.includes(pid)) return sum
      return sum + lineAmount(line, priceOf) / sharers.length
    }, 0)
  }

  const ownOf = pid => (pid ? sumOf(bill.filter(l => !l.shared && l.personaId === pid)) : 0)
  const paidOf = pid =>
    pid ? payments.filter(p => p.personaId === pid).reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0
  const totalOf = pid => ownOf(pid) + shareOf(pid)
  const remainingOf = pid => Math.max(0, totalOf(pid) - paidOf(pid))

  // Черновик — то, что гость набрал, но ещё не отправил. К счёту отношения не имеет.
  const draftTotal = sumOf(drafts)
  const draftOf = pid => (pid ? sumOf(drafts.filter(l => l.personaId === pid)) : 0)

  return {
    participants,
    sharedTotal,
    ownAll,
    tableTotal,
    // share оставлен для совместимости: средняя доля общего по столу
    share: sharedTotal / participants,
    paidTotal,
    remaining,
    draftTotal,
    draftOf,
    shareOf,
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
