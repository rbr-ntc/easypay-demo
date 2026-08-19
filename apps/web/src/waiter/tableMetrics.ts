import type { Snapshot } from '../api'

export interface TableMetrics {
  tableDur: number | null
  toFirstOrder: number | null
  kitchenAvg: number | null
  kitchenDoneCount: number
  payWait: number | null
  revPerHour: number | null
  perGuest: number | null
}

const REVENUE_MIN_SESSION = 10 * 60_000

/**
 * Операционные метрики стола для экрана ресторана. Всё считается из таймстемпов
 * снапшота: openedAt/closedAt стола и sentAt/servedAt позиций.
 */
export function computeMetrics(
  snap: Snapshot | null,
  money: { tableTotal: number; paidTotal: number; remaining: number },
  now: number
): TableMetrics {
  const lines = snap?.lines ?? []
  const payments = snap?.payments ?? []
  const personas = snap?.personas ?? []
  const openedAt = snap?.openedAt ?? null
  const closed = snap?.status === 'closed'
  const endAt = closed ? snap?.closedAt ?? now : now

  const tableDur = openedAt ? endAt - openedAt : null

  const sentAts = lines.filter(l => l.sentAt).map(l => l.sentAt as number)
  const firstSentAt = sentAts.length ? Math.min(...sentAts) : null
  const toFirstOrder = openedAt && firstSentAt ? firstSentAt - openedAt : null

  const kitchenDone = lines.filter(l => l.sentAt && l.servedAt)
  const kitchenAvg = kitchenDone.length
    ? kitchenDone.reduce((s, l) => s + ((l.servedAt as number) - (l.sentAt as number)), 0) / kitchenDone.length
    : null

  const servedAts = lines.filter(l => l.servedAt).map(l => l.servedAt as number)
  const lastServedAt = servedAts.length ? Math.max(...servedAts) : null
  const lastPayAt = payments.length ? Math.max(...payments.map(p => p.at)) : null
  const fullyPaid = money.tableTotal > 0 && money.remaining < 0.01
  const payWait = fullyPaid && lastServedAt && lastPayAt ? Math.max(0, lastPayAt - lastServedAt) : null

  // Темп выручки осмыслен только на подросшей сессии: иначе экстраполяция даёт дикие ₽/ч
  const revReady = tableDur !== null && (closed || tableDur >= REVENUE_MIN_SESSION)
  const revPerHour = revReady && tableDur ? money.paidTotal / (tableDur / 3_600_000) : null

  const perGuest = personas.length ? money.tableTotal / personas.length : null

  return { tableDur, toFirstOrder, kitchenAvg, kitchenDoneCount: kitchenDone.length, payWait, revPerHour, perGuest }
}
