// Денежная модель EasyPay — ЕДИНСТВЕННАЯ реализация для сервера и клиента.
//
// Три правила, на которых держится честность счёта:
//  1. СЧЁТ — это отправленное на кухню. Черновик корзины в счёт не входит и долгом
//     стола не считается: гость ничего не должен за то, что ещё не заказал.
//  2. ДОЛЯ ОБЩЕГО ФИКСИРУЕТСЯ В МОМЕНТ ЗАКАЗА. Общее блюдо делится между теми, кто сидел
//     за столом, когда его отправили (список в line.sharedWith). Подсевший позже не платит
//     за съеденное до него, а заплативший раньше не переплачивает задним числом.
//  3. ЦЕНА ФИКСИРУЕТСЯ В ПОЗИЦИИ — правка меню не переписывает открытые счета.

export type PayScope = 'own' | 'equal' | 'full'

export interface MoneyLine {
  dishId: string
  qty: number
  shared: boolean
  personaId: string
  sent?: boolean
  cancelled?: boolean
  price?: number
  /** Кто делит это общее блюдо — список персон на момент отправки. */
  sharedWith?: readonly string[]
}

export interface MoneyPayment {
  /** Наличные официант может принять за стол целиком, без привязки к гостю. */
  personaId: string | null
  amount: number
}

export interface MoneyState {
  personas?: readonly { id: string }[]
  lines?: readonly MoneyLine[]
  payments?: readonly MoneyPayment[]
}

export interface MoneyTotals {
  participants: number
  sharedTotal: number
  ownAll: number
  tableTotal: number
  /** Средняя доля общего по столу; для персоны используйте shareOf. */
  share: number
  paidTotal: number
  remaining: number
  /** Черновик корзины — вне счёта. */
  draftTotal: number
  draftOf(personaId: string | null): number
  shareOf(personaId: string | null): number
  ownOf(personaId: string | null): number
  paidOf(personaId: string | null): number
  totalOf(personaId: string | null): number
  remainingOf(personaId: string | null): number
}

export type PriceOf = (dishId: string) => number

/** Сценарии оплаты: своё (+доля общего) / поровну на всех / весь остаток стола. */
export const PAY_SCOPES: readonly PayScope[] = ['own', 'equal', 'full']

/** Деньги храним и отдаём с точностью до копейки. */
export function round2(n: unknown): number {
  const x = Number(n)
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0
}

/** Позиция попадает в счёт, только когда отправлена на кухню и не отменена. */
export function isBillLine(line: MoneyLine | undefined | null): boolean {
  return !!line?.sent && !line?.cancelled
}

function lineAmount(line: MoneyLine, priceOf: PriceOf): number {
  const unit = Number(line?.price ?? priceOf(line?.dishId)) || 0
  return unit * (Number(line?.qty) || 0)
}

/** Между кем делится общее блюдо: список с позиции, иначе (для старых данных) — все за столом. */
export function sharersOf(line: MoneyLine, personaIds: string[]): string[] {
  const listed = (line?.sharedWith ?? []).filter(id => personaIds.includes(id))
  return listed.length > 0 ? [...listed] : personaIds
}

/**
 * Считает всё по столу. Цены приходят снаружи (`priceOf`), потому что сервер берёт их
 * из меню заведения, а клиент — из импортированного меню.
 */
export function computeTotals(state: MoneyState | null | undefined, priceOf: PriceOf): MoneyTotals {
  const personas = state?.personas ?? []
  const lines = state?.lines ?? []
  const payments = state?.payments ?? []
  const personaIds = personas.map(p => p.id)

  const participants = Math.max(1, personas.length)
  const bill = lines.filter(isBillLine)
  const drafts = lines.filter(l => !l.sent && !l.cancelled)

  const sumOf = (arr: readonly MoneyLine[]) => arr.reduce((s, l) => s + lineAmount(l, priceOf), 0)
  const sharedLines = bill.filter(l => l.shared)
  const sharedTotal = sumOf(sharedLines)
  const ownAll = sumOf(bill.filter(l => !l.shared))
  const tableTotal = ownAll + sharedTotal

  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const remaining = Math.max(0, tableTotal - paidTotal)

  // Доля персоны в общих блюдах — только по тем, где она в списке участников
  const shareOf = (pid: string | null) => {
    if (!pid) return 0
    return sharedLines.reduce((sum, line) => {
      const sharers = sharersOf(line, personaIds)
      if (!sharers.includes(pid)) return sum
      return sum + lineAmount(line, priceOf) / sharers.length
    }, 0)
  }

  // Округляем в источнике, а не на витрине. Иначе у одного и того же гостя
  // «доля» и «остаток» считались по разным правилам и расходились на копейку:
  // share 163,34 при remaining 163,33. Деньги живут в копейках — там и округляем.
  const ownOf = (pid: string | null) => round2(pid ? sumOf(bill.filter(l => !l.shared && l.personaId === pid)) : 0)
  const paidOf = (pid: string | null) =>
    round2(pid ? payments.filter(p => p.personaId === pid).reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0)
  const totalOf = (pid: string | null) => round2(ownOf(pid) + round2(shareOf(pid)))
  // Личный долг до учёта чужих платежей за стол
  const rawRemainingOf = (pid: string | null) => round2(Math.max(0, totalOf(pid) - paidOf(pid)))

  /**
   * С гостя не могут взять больше, чем должен стол: сосед мог заплатить за всех.
   * Число, которое здесь получается, и списывается при оплате — гость видит
   * ровно ту сумму, которая уйдёт с карты.
   */
  const remainingOf = (pid: string | null) => round2(Math.min(rawRemainingOf(pid), remaining))

  const draftTotal = sumOf(drafts)
  const draftOf = (pid: string | null) => (pid ? sumOf(drafts.filter(l => l.personaId === pid)) : 0)

  return {
    participants,
    sharedTotal,
    ownAll,
    tableTotal,
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
 * остатком стола — это защита от двойной оплаты, когда двое платят одновременно.
 */
export function amountFor(totals: MoneyTotals, personaId: string | null, scope: PayScope): number {
  const raw =
    scope === 'full'
      ? totals.remaining
      : scope === 'equal'
        ? Math.min(totals.remaining, totals.tableTotal / totals.participants)
        : Math.min(totals.remainingOf(personaId), totals.remaining)
  return absorbRounding(round2(raw), totals.remaining)
}

/**
 * Хвост от округления долей отдаём тому, кто платит последним.
 * Иначе 490 на троих — это 163.33 × 3 = 489.99, и на столе висит копейка,
 * из-за которой полностью рассчитавшихся гостей нельзя отпустить без force.
 * Порог в рубль безопасен: настоящий долг такой мелочью не бывает, а ошибка
 * округления растёт максимум по половине копейки на участника.
 */
function absorbRounding(amount: number, remaining: number): number {
  if (amount <= 0) return amount
  const rest = round2(remaining - amount)
  return rest > 0 && rest < 1 ? round2(remaining) : amount
}

/**
 * Разложить сумму по долям так, чтобы округлённые части складывались обратно
 * в неё же. Хвост в одну-две копейки отдаём самой большой доле — иначе на
 * витрине счёт 490 распадается на 163,33 × 3 = 489,99, и стол «должен» копейку,
 * которую никому нельзя предъявить.
 */
export function splitRounded(shares: number[], total: number): number[] {
  const rounded = shares.map(round2)
  const drift = round2(total - rounded.reduce((s, x) => s + x, 0))
  if (drift === 0 || rounded.length === 0) return rounded

  let target = 0
  for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[target]) target = i
  rounded[target] = round2(rounded[target] + drift)
  return rounded
}
