export type TableStatus = 'paid' | 'paying' | 'served' | 'cooking' | 'seated' | 'dirty' | 'free'

export type AlertSeverity = 'info' | 'ok' | 'warn' | 'danger'

export interface HallAlert {
  id: string
  label: string
  severity: AlertSeverity
}

/** Компактная карточка стола: всё, из чего считаются статус, таймеры и алерты. */
export interface HallCard {
  id: string
  zoneId: string
  zoneName: string
  seats: number
  status: 'open' | 'closed'
  openedAt: number | null
  closedAt: number | null
  guests: number
  personas: { name: string; animal: string }[]
  tableTotal: number
  paidTotal: number
  remaining: number
  sentCount: number
  kitchenPending: number
  oldestPendingSentAt: number | null
  lastSentAt: number | null
  lastServedAt: number | null
  lastPaidAt: number | null
  tipsTotal: number
  call: { at: number; reason: string; name: string } | null
}

export interface HallShift {
  tables: number
  revenue: number
  guests: number
}

export interface HallSummary {
  tables: number
  occupied: number
  seatsTotal: number
  guests: number
  openBalance: number
  kitchenPending: number
  attention: number
  shiftRevenue: number
  shiftGuests: number
  closedTables: number
  avgCheck: number | null
}

export interface TableDescription {
  status: TableStatus
  since: number | null
  alerts: HallAlert[]
}

export declare const TABLE_STATUS: Record<string, TableStatus>
export declare const STATUS_LABEL: Record<TableStatus, string>
export declare const THRESHOLDS: { noOrderMs: number; kitchenSlowMs: number; awaitingPaymentMs: number; cleanupMs: number }
export declare const CALL_LABEL: Record<string, string>
export declare function tableStatus(card: HallCard, now: number): TableStatus
export declare function statusSince(card: HallCard, status: TableStatus): number | null
export declare function tableAlerts(card: HallCard, now: number): HallAlert[]
export declare function describeTable(card: HallCard, now: number): TableDescription
export declare function summarizeHall(cards: HallCard[], shift: HallShift | null, now: number): HallSummary
