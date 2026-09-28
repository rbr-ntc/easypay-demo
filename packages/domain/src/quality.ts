// Гости и качество: что гости думают о визите и почему. Раньше оценка жила
// строчкой в журнале, а «замечаний 1» в обзоре было числом без содержания.
// Здесь — одна чистая функция: сырые визиты за период → сводка, разрезы по
// официантам, столам и дням, лента замечаний. Одинаково для сервера и тестов.

import { VENUE_TZ } from './shift.ts'

export type Rating = 'good' | 'ok' | 'bad'

export interface QualityRating {
  guestId: string
  guest: string | null
  rating: Rating
  note: string | null
  at: number
  /** Управляющая разобрала замечание: кто, когда и что сделала. */
  resolvedAt: number | null
  resolvedBy: string | null
  resolution: string | null
  /** Прежние оценки гостя до переоценки. */
  history?: { rating: Rating; note: string | null; at: number }[]
}

/** Одна посадка за столом — всё, что нужно для качества, без денег. */
export interface QualityVisit {
  sessionId: string
  tableId: string
  zone: string | null
  openedAt: number
  closedAt: number | null
  guests: number
  waiterId: string | null
  waiter: string | null
  ratings: QualityRating[]
  /** Сколько гость ждал официанта: от вызова до «иду», мс. */
  callWaits: number[]
  /** Сколько блюдо шло: от отправки на кухню до подачи, мс. */
  kitchenWaits: number[]
  tips: number
}

export interface QualityCounts {
  guests: number
  rated: number
  good: number
  ok: number
  bad: number
  /** Доля оценивших среди гостей ЗАКРЫТЫХ посадок, % — сидящие ещё не успели оценить (смена №7, Г4). */
  responseRate: number | null
  /** Индекс качества: доля «понравилось» минус доля замечаний, от −100 до 100. */
  index: number | null
}

export interface QualityRemark {
  sessionId: string
  guestId: string
  tableId: string
  guest: string | null
  waiter: string | null
  at: number
  rating: Rating
  note: string | null
  resolvedAt: number | null
  resolvedBy: string | null
  resolution: string | null
  /** Что гость говорил раньше, до переоценки. */
  history: { rating: Rating; note: string | null; at: number }[]
  /** Сигналы визита рядом с оценкой: почему могли поставить «замечание». */
  kitchenAvgMin: number | null
  callAvgSec: number | null
}

export interface QualityReport {
  totals: QualityCounts & { visits: number; openRemarks: number; kitchenAvgMin: number | null; callAvgSec: number | null; tips: number }
  byWaiter: (QualityCounts & { waiterId: string | null; waiter: string; visits: number; tips: number; kitchenAvgMin: number | null; callAvgSec: number | null })[]
  byTable: (QualityCounts & { tableId: string; zone: string | null; visits: number })[]
  byDay: (QualityCounts & { day: string })[]
  remarks: QualityRemark[]
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null)
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)

function counts(visits: QualityVisit[]): QualityCounts {
  const ratings = visits.flatMap(v => v.ratings)
  const guests = visits.reduce((a, v) => a + v.guests, 0)
  const good = ratings.filter(r => r.rating === 'good').length
  const ok = ratings.filter(r => r.rating === 'ok').length
  const bad = ratings.filter(r => r.rating === 'bad').length
  const rated = ratings.length
  const closed = visits.filter(v => v.closedAt !== null)
  const closedGuests = closed.reduce((a, v) => a + v.guests, 0)
  const closedRated = closed.reduce((a, v) => a + v.ratings.length, 0)
  return {
    guests,
    rated,
    good,
    ok,
    bad,
    responseRate: closedGuests > 0 ? Math.min(100, Math.round((closedRated / closedGuests) * 100)) : null,
    index: rated > 0 ? Math.round(((good - bad) / rated) * 100) : null
  }
}

const kitchenMin = (visits: QualityVisit[]) => {
  const a = avg(visits.flatMap(v => v.kitchenWaits))
  return a === null ? null : round1(a / 60_000)
}
const callSec = (visits: QualityVisit[]) => {
  const a = avg(visits.flatMap(v => v.callWaits))
  return a === null ? null : Math.round(a / 1000)
}

/** Календарный день заведения: «2026-09-28» по его часовому поясу, а не по UTC. */
export function dayOf(at: number, tz = VENUE_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  return parts
}

/** Полночь заведения для момента `at` — начало «сегодня» в отчёте. */
export function startOfDay(at: number, tz = VENUE_TZ): number {
  const local = new Date(new Date(at).toLocaleString('en-US', { timeZone: tz })).getTime()
  const utc = new Date(new Date(at).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const offset = local - utc
  const DAY = 24 * 60 * 60 * 1000
  return Math.floor((at + offset) / DAY) * DAY - offset
}

function groupBy<K>(visits: QualityVisit[], key: (v: QualityVisit) => K): Map<K, QualityVisit[]> {
  const map = new Map<K, QualityVisit[]>()
  for (const v of visits) map.set(key(v), [...(map.get(key(v)) ?? []), v])
  return map
}

/** В ленте — «плохо» и любая оценка с текстом: «нормально, но долго несли суп». */
const isRemark = (r: QualityRating) => r.rating === 'bad' || !!r.note
/** Разбирать нужно всё, кроме похвалы: «всё супер» не требует звонка гостю. */
export const needsAction = (r: { rating: Rating }) => r.rating !== 'good'

export function buildQualityReport(visits: QualityVisit[], tz = VENUE_TZ): QualityReport {
  const remarks: QualityRemark[] = visits
    .flatMap(v =>
      v.ratings.filter(isRemark).map(r => ({
        sessionId: v.sessionId,
        guestId: r.guestId,
        tableId: v.tableId,
        guest: r.guest,
        waiter: v.waiter,
        at: r.at,
        rating: r.rating,
        note: r.note,
        resolvedAt: r.resolvedAt,
        resolvedBy: r.resolvedBy,
        resolution: r.resolution,
        history: r.history ?? [],
        kitchenAvgMin: kitchenMin([v]),
        callAvgSec: callSec([v])
      }))
    )
    // Неразобранные «плохо» — наверху: с них управляющая начинает утро
    .sort((a, b) => Number(!!a.resolvedAt || !needsAction(a)) - Number(!!b.resolvedAt || !needsAction(b)) || Number(b.rating === 'bad') - Number(a.rating === 'bad') || b.at - a.at)

  const byWaiter = [...groupBy(visits, v => v.waiterId)].map(([waiterId, vs]) => ({
    waiterId,
    waiter: vs[0].waiter ?? 'Без официанта',
    visits: vs.length,
    ...counts(vs),
    tips: Math.round(vs.reduce((a, v) => a + v.tips, 0) * 100) / 100,
    kitchenAvgMin: kitchenMin(vs),
    callAvgSec: callSec(vs)
  }))
  byWaiter.sort((a, b) => b.guests - a.guests)

  const byTable = [...groupBy(visits, v => v.tableId)].map(([tableId, vs]) => ({ tableId, zone: vs[0].zone, visits: vs.length, ...counts(vs) }))
  // Столы с замечаниями — первыми: где-то дует, где-то не видно официанта
  byTable.sort((a, b) => b.bad - a.bad || b.guests - a.guests)

  const byDay = [...groupBy(visits, v => dayOf(v.openedAt, tz))].map(([day, vs]) => ({ day, ...counts(vs) })).sort((a, b) => a.day.localeCompare(b.day))

  return {
    totals: {
      visits: visits.length,
      ...counts(visits),
      openRemarks: remarks.filter(r => needsAction(r) && !r.resolvedAt).length,
      kitchenAvgMin: kitchenMin(visits),
      callAvgSec: callSec(visits),
      tips: Math.round(visits.reduce((a, v) => a + v.tips, 0) * 100) / 100
    },
    byWaiter,
    byTable,
    byDay,
    remarks
  }
}
