export type PayScope = 'own' | 'equal' | 'full'

export interface MoneyLine {
  dishId: string
  qty: number
  shared: boolean
  personaId: string
  sent?: boolean
  cancelled?: boolean
  price?: number
  /** Кто делит это общее блюдо — список персон на момент заказа. */
  sharedWith?: readonly string[]
}

export interface MoneyPayment {
  personaId: string
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

export declare const PAY_SCOPES: readonly PayScope[]
export declare function round2(n: number): number
export declare function isBillLine(line: MoneyLine): boolean
export declare function computeTotals(state: MoneyState, priceOf: (dishId: string) => number): MoneyTotals
export declare function amountFor(totals: MoneyTotals, personaId: string | null, scope: PayScope): number
