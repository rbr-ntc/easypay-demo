// Очередь кухни: тикет = одна отправленная позиция, которую ещё не подали.
// Правила срочности и сортировки живут здесь, чтобы сервер и экран кухни
// одинаково понимали, что «горит».


export type TicketStateName = 'queued' | 'cooking' | 'ready'
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
  /** Повар закончил: блюдо на раздаче и ждёт официанта. */
  readyAt?: number | null
  waveAt?: number | null
  cancelledAt?: number
  reason?: string
}

export interface KitchenSummary {
  queued: number
  cooking: number
  /** Готово и стоит на раздаче. */
  ready: number
  positions: number
  tables: number
  oldestWaitMs: number | null
  overdue: number
}

/** Пороги ожидания разные по цехам: капучино через 10 минут — уже провал. */
export const STATION_THRESHOLDS: Record<string, { warnMs: number; dangerMs: number }> = {
  kitchen: { warnMs: 10 * 60_000, dangerMs: 20 * 60_000 },
  bar: { warnMs: 3 * 60_000, dangerMs: 6 * 60_000 }
}

export const KITCHEN_THRESHOLDS = STATION_THRESHOLDS.kitchen

export function thresholdsFor(station: string | undefined) {
  return STATION_THRESHOLDS[station ?? 'kitchen'] ?? STATION_THRESHOLDS.kitchen
}

export const TICKET_STATE: { QUEUED: 'queued'; COOKING: 'cooking'; READY: 'ready' } = {
  QUEUED: 'queued',
  COOKING: 'cooking',
  // Готово и стоит на раздаче: повар своё сделал, ждём официанта
  READY: 'ready'
}

export function ticketState(ticket: KitchenTicket): TicketStateName {
  if (ticket.readyAt) return TICKET_STATE.READY
  return ticket.startedAt ? TICKET_STATE.COOKING : TICKET_STATE.QUEUED
}

/** Сколько тарелка стоит на раздаче: остывает — значит зал не успевает. */
export function passWait(ticket: KitchenTicket, now: number): number {
  return ticket.readyAt ? Math.max(0, now - ticket.readyAt) : 0
}

/** Сколько позиция ждёт с момента отправки на кухню. */
export function ticketWait(ticket: KitchenTicket, now: number): number {
  return ticket.sentAt ? Math.max(0, now - ticket.sentAt) : 0
}

export function ticketUrgency(ticket: KitchenTicket, now: number): TicketUrgency {
  const wait = ticketWait(ticket, now)
  const limits = thresholdsFor(ticket.station)
  if (wait >= limits.dangerMs) return 'danger'
  if (wait >= limits.warnMs) return 'warn'
  return 'ok'
}

/** Самое старое — первым: кухня работает по очереди, а не по столам. */
export function sortTickets(tickets: KitchenTicket[]): KitchenTicket[] {
  return [...tickets].sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0))
}

export function summarizeKitchen(tickets: KitchenTicket[], now: number): KitchenSummary {
  const queued = tickets.filter(t => ticketState(t) === TICKET_STATE.QUEUED)
  const cooking = tickets.filter(t => ticketState(t) === TICKET_STATE.COOKING)
  const ready = tickets.filter(t => ticketState(t) === TICKET_STATE.READY)
  const waits = tickets.map(t => ticketWait(t, now))
  const tables = new Set(tickets.map(t => t.tableId))
  return {
    queued: queued.length,
    cooking: cooking.length,
    // Готово и ждёт официанта: тарелка на раздаче остывает
    ready: ready.length,
    positions: tickets.reduce((s, t) => s + (Number(t.qty) || 0), 0),
    tables: tables.size,
    oldestWaitMs: waits.length ? Math.max(...waits) : null,
    overdue: tickets.filter(t => ticketUrgency(t, now) === 'danger').length
  }
}
