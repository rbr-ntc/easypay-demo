// Очередь кухни: тикет = одна отправленная позиция, которую ещё не подали.
// Правила срочности и сортировки живут здесь, чтобы сервер и экран кухни
// одинаково понимали, что «горит».

export const KITCHEN_THRESHOLDS = {
  warnMs: 10 * 60_000, // ждёт дольше — жёлтый
  dangerMs: 20 * 60_000 // ждёт дольше — красный, тот же порог, что у алерта зала
}

export const TICKET_STATE = { QUEUED: 'queued', COOKING: 'cooking' }

export function ticketState(ticket) {
  return ticket.startedAt ? TICKET_STATE.COOKING : TICKET_STATE.QUEUED
}

/** Сколько позиция ждёт с момента отправки на кухню. */
export function ticketWait(ticket, now) {
  return ticket.sentAt ? Math.max(0, now - ticket.sentAt) : 0
}

export function ticketUrgency(ticket, now) {
  const wait = ticketWait(ticket, now)
  if (wait >= KITCHEN_THRESHOLDS.dangerMs) return 'danger'
  if (wait >= KITCHEN_THRESHOLDS.warnMs) return 'warn'
  return 'ok'
}

/** Самое старое — первым: кухня работает по очереди, а не по столам. */
export function sortTickets(tickets) {
  return [...tickets].sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0))
}

export function summarizeKitchen(tickets, now) {
  const queued = tickets.filter(t => ticketState(t) === TICKET_STATE.QUEUED)
  const cooking = tickets.filter(t => ticketState(t) === TICKET_STATE.COOKING)
  const waits = tickets.map(t => ticketWait(t, now))
  const tables = new Set(tickets.map(t => t.tableId))
  return {
    queued: queued.length,
    cooking: cooking.length,
    positions: tickets.reduce((s, t) => s + (Number(t.qty) || 0), 0),
    tables: tables.size,
    oldestWaitMs: waits.length ? Math.max(...waits) : null,
    overdue: tickets.filter(t => ticketUrgency(t, now) === 'danger').length
  }
}
