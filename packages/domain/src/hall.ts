// Состояния столов зала и правила «требуют внимания».
// Считается из компактной карточки стола (её отдаёт сервер) — одинаково на сервере
// и на клиенте, поэтому статусы и таймеры на экране зала обновляются каждую секунду
// без лишних запросов.


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

/** Порядок = приоритет отображения в зале (от «нужно действие» к «всё спокойно»). */
export const TABLE_STATUS: Record<string, TableStatus> = {
  PAID: 'paid', // оплачено полностью, можно закрывать
  PAYING: 'paying', // оплатили частично
  SERVED: 'served', // всё подано, ждём деньги
  COOKING: 'cooking', // на кухне
  SEATED: 'seated', // сели, ещё не заказали
  DIRTY: 'dirty', // только что закрыт — убрать
  FREE: 'free'
}

export const STATUS_LABEL: Record<TableStatus, string> = {
  paid: 'Оплачен',
  paying: 'Частичная оплата',
  served: 'Ждёт оплаты',
  cooking: 'На кухне',
  seated: 'Гости сели',
  dirty: 'Убрать стол',
  free: 'Свободен'
}

/** Пороги «внимания» — те же, по которым живут хостес и менеджер смены. */
export const THRESHOLDS = {
  noOrderMs: 7 * 60_000, // сели и не заказали
  kitchenSlowMs: 20 * 60_000, // позиция висит на кухне
  awaitingPaymentMs: 10 * 60_000, // всё подано, денег нет
  cleanupMs: 5 * 60_000 // стол закрыт и ещё не убран
}

const NOTHING: HallAlert[] = []

export function tableStatus(card: HallCard, now: number): TableStatus {
  if (card.status === 'closed') {
    // Только что закрытый стол ещё «грязный»: его надо убрать и подготовить
    const justClosed = card.closedAt && now - card.closedAt < THRESHOLDS.cleanupMs
    return justClosed ? TABLE_STATUS.DIRTY : TABLE_STATUS.FREE
  }
  // «Оплачен» = были платежи и остатка нет (одного нулевого остатка мало: пустой стол тоже нулевой)
  if (card.tableTotal > 0 && card.paidTotal > 0 && card.remaining <= 0.01) return TABLE_STATUS.PAID
  if (card.paidTotal > 0) return TABLE_STATUS.PAYING
  if (card.kitchenPending > 0) return TABLE_STATUS.COOKING
  if (card.sentCount > 0) return TABLE_STATUS.SERVED
  return TABLE_STATUS.SEATED
}

/** С какого момента стол находится в текущем состоянии — для таймера на карточке. */
export function statusSince(card: HallCard, status: TableStatus): number | null {
  if (status === TABLE_STATUS.DIRTY || status === TABLE_STATUS.FREE) return card.closedAt
  if (status === TABLE_STATUS.PAID || status === TABLE_STATUS.PAYING) return card.lastPaidAt ?? card.openedAt
  if (status === TABLE_STATUS.COOKING) return card.oldestPendingSentAt ?? card.lastSentAt ?? card.openedAt
  if (status === TABLE_STATUS.SERVED) return card.lastServedAt ?? card.openedAt
  return card.openedAt
}

export const CALL_LABEL: Record<string, string> = {
  help: 'зовёт официанта',
  bill: 'просит счёт',
  water: 'просит воды'
}

export function tableAlerts(card: HallCard, now: number): HallAlert[] {
  const status = tableStatus(card, now)
  const alerts: HallAlert[] = []

  // Вызов гостя — самое срочное, показываем первым
  if (card.call) {
    alerts.push({
      id: 'call-waiter',
      label: `${card.call.name} ${CALL_LABEL[card.call.reason] ?? CALL_LABEL.help}`,
      severity: 'danger'
    })
  }

  if (status === TABLE_STATUS.SEATED && card.openedAt && now - card.openedAt > THRESHOLDS.noOrderMs) {
    alerts.push({ id: 'no-order', label: 'Сели и не заказали', severity: 'warn' })
  }
  if (card.oldestPendingSentAt && now - card.oldestPendingSentAt > THRESHOLDS.kitchenSlowMs) {
    alerts.push({ id: 'kitchen-slow', label: 'Кухня задерживает', severity: 'danger' })
  }
  if (
    (status === TABLE_STATUS.SERVED || status === TABLE_STATUS.PAYING) &&
    card.lastServedAt &&
    now - card.lastServedAt > THRESHOLDS.awaitingPaymentMs
  ) {
    alerts.push({ id: 'awaiting-payment', label: 'Ждёт оплаты', severity: 'warn' })
  }
  if (status === TABLE_STATUS.PAID) {
    alerts.push({ id: 'ready-to-close', label: 'Оплачен — закрыть', severity: 'ok' })
  }
  if (status === TABLE_STATUS.DIRTY && card.closedAt && now - card.closedAt < THRESHOLDS.cleanupMs) {
    alerts.push({ id: 'needs-cleanup', label: 'Убрать стол', severity: 'info' })
  }
  return alerts.length ? alerts : NOTHING
}

export function describeTable(card: HallCard, now: number): TableDescription {
  const status = tableStatus(card, now)
  return { status, since: statusSince(card, status), alerts: tableAlerts(card, now) }
}

/** Сводка по залу: занятость, деньги в работе, кухня, что горит. */
export function summarizeHall(cards: HallCard[], shift: HallShift | null, now: number): HallSummary {
  const described = cards.map(card => ({ card, ...describeTable(card, now) }))
  const open = described.filter(d => d.card.status === 'open')
  const guests = open.reduce((s, d) => s + d.card.guests, 0)
  const openBalance = open.reduce((s, d) => s + d.card.remaining, 0)
  const openPaid = open.reduce((s, d) => s + d.card.paidTotal, 0)
  const kitchenPending = cards.reduce((s, c) => s + c.kitchenPending, 0)
  const attention = described.filter(d => d.alerts.some(a => a.severity === 'warn' || a.severity === 'danger'))
  const shiftRevenue = (shift?.revenue ?? 0) + openPaid
  const closedTables = shift?.tables ?? 0
  const avgCheck = closedTables > 0 ? (shift?.revenue ?? 0) / closedTables : null
  const seatsTotal = cards.reduce((s, c) => s + (c.seats ?? 0), 0)

  return {
    tables: cards.length,
    occupied: open.length,
    seatsTotal,
    guests,
    openBalance,
    kitchenPending,
    attention: attention.length,
    shiftRevenue,
    shiftGuests: (shift?.guests ?? 0) + guests,
    closedTables,
    avgCheck
  }
}
