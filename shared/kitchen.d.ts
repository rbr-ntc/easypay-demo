export type TicketStateName = 'queued' | 'cooking'
export type TicketUrgency = 'ok' | 'warn' | 'danger'

export interface KitchenTicket {
  tableId: string
  sessionId: string
  zoneName: string
  waiterName: string | null
  uid: number
  dishId: string
  name: string
  station: 'kitchen' | 'bar'
  allergens: string[]
  qty: number
  options: Record<string, string>
  shared: boolean
  guest: string
  animal: string
  sentAt: number | null
  startedAt: number | null
  waveAt?: number | null
  cancelledAt?: number
  reason?: string
}

export interface KitchenSummary {
  queued: number
  cooking: number
  positions: number
  tables: number
  oldestWaitMs: number | null
  overdue: number
}

export declare const KITCHEN_THRESHOLDS: { warnMs: number; dangerMs: number }
export declare const TICKET_STATE: { QUEUED: 'queued'; COOKING: 'cooking' }
export declare function ticketState(ticket: KitchenTicket): TicketStateName
export declare function ticketWait(ticket: KitchenTicket, now: number): number
export declare function ticketUrgency(ticket: KitchenTicket, now: number): TicketUrgency
export declare function sortTickets(tickets: KitchenTicket[]): KitchenTicket[]
export declare function summarizeKitchen(tickets: KitchenTicket[], now: number): KitchenSummary
