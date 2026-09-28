// «Гости и качество» — отдельный раздел кабинета: что гости думают о визите,
// по официантам, столам и дням, плюс лента замечаний с отметкой «разобрано».
// Только управляющему: это оценка людей, а не рабочий экран смены.

import { buildQualityReport, startOfDay } from '@easypay/domain/quality'
import { VENUE_TZ } from '@easypay/domain/shift'
import type { Permission } from '@easypay/domain/roles'
import { windowOf } from './shiftApi.ts'
import type { Store } from './store/index.ts'
import type { Actor } from './types.ts'

export interface QualityDeps {
  json: (res: any, code: number, body: unknown) => void
  readBody: (req: any) => Promise<any>
  actorFrom: (req: any, url?: URL | null) => Actor | null
  allowed: (actor: Actor | null, permission: Permission) => boolean
  staffUnauthorized: (req: any) => unknown
  audit: (actor: Actor | null, action: string, tableId: string | null, detail?: string | null, amount?: number | null) => void
  flushAudit: (store: Store) => Promise<void>
}

const DAY = 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Больше посадок за период не берём: отчёт — для глаз, а не выгрузка. */
const VISITS_LIMIT = 3000
export const QUALITY_PERIODS = ['shift', 'prev', 'today', '7d', '30d'] as const
export type QualityPeriod = (typeof QUALITY_PERIODS)[number]

/** Окно периода: смена — от закрытия прошлой до сейчас; дни — по часовому поясу заведения. */
async function periodWindow(store: Store, period: QualityPeriod, now = Date.now()): Promise<{ from: number; to: number }> {
  // Прошлая смена: после закрытия её отзывы не должны пропадать из виду (смена №7)
  if (period === 'prev') {
    const last = (await store.shiftHistory(5)).find(s => s.closedAt !== null) ?? null
    if (!last) return { from: now + 1, to: now + 1 }
    const w = await windowOf(store, last)
    return { from: w.from > 0 ? w.from : last.openedAt, to: last.closedAt ?? now + 1 }
  }
  if (period === 'shift') {
    const shift = (await store.currentShift()) ?? (await store.shiftHistory(1))[0] ?? null
    if (!shift) return { from: startOfDay(now, VENUE_TZ), to: now + 1 }
    const w = await windowOf(store, shift)
    // Первая смена без предыдущей: окно — от её открытия, а не «вся история»
    return { from: w.from > 0 ? w.from : shift.openedAt, to: Number.isFinite(w.to) ? w.to : now + 1 }
  }
  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30
  return { from: startOfDay(now, VENUE_TZ) - (days - 1) * DAY, to: now + 1 }
}

export function createQualityRoutes(deps: QualityDeps) {
  const { json, readBody, actorFrom, allowed, staffUnauthorized } = deps

  return async function qualityRoutes(req: any, res: any, url: URL, store: Store): Promise<boolean> {
    if (url.pathname !== '/api/quality' && url.pathname !== '/api/quality/resolve') return false
    const actor = actorFrom(req, url)
    if (!actor) {
      json(res, 401, staffUnauthorized(req))
      return true
    }
    if (!allowed(actor, 'log')) {
      json(res, 403, { error: 'role not allowed' })
      return true
    }

    if (url.pathname === '/api/quality') {
      if (req.method !== 'GET') {
        json(res, 405, { error: 'method' })
        return true
      }
      const raw = url.searchParams.get('period') ?? 'shift'
      const period = (QUALITY_PERIODS as readonly string[]).includes(raw) ? (raw as QualityPeriod) : null
      if (!period) {
        json(res, 400, { error: 'unknown period', allowed: QUALITY_PERIODS })
        return true
      }
      const window = await periodWindow(store, period)
      const visits = await store.qualityVisits(window.from, window.to, VISITS_LIMIT)
      json(res, 200, { period, from: window.from, to: window.to, truncated: visits.length >= VISITS_LIMIT, report: buildQualityReport(visits, VENUE_TZ) })
      return true
    }

    // Разобрать замечание: что сделали — словами, это прочтёт владелец
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method' })
      return true
    }
    const body = await readBody(req).catch(() => null)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null
    const guestId = typeof body?.guestId === 'string' ? body.guestId : null
    // eslint-disable-next-line no-control-regex
    const text = typeof body?.resolution === 'string' ? body.resolution.replace(/[<>\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : ''
    if (!sessionId || !guestId) {
      json(res, 400, { error: 'sessionId and guestId required' })
      return true
    }
    // В базе это uuid: кривая строка — «не найдено», а не 500 от Postgres
    if (!UUID.test(sessionId) || !UUID.test(guestId)) {
      json(res, 404, { error: 'rating not found' })
      return true
    }
    // «...» и пробелы — не разбор: нужно хотя бы три буквы, это прочтёт владелец
    if ((text.match(/\p{L}/gu) ?? []).length < 3) {
      json(res, 400, { error: 'resolution required', hint: 'напишите, что сделали: «позвонили, извинились»' })
      return true
    }
    const done = await store.resolveRating(sessionId, guestId, actor.id, text)
    if (!done) {
      json(res, 404, { error: 'rating not found' })
      return true
    }
    deps.audit(actor, 'разобрал замечание', done.tableId, `${done.guest ?? 'гость'}: ${text}`)
    await deps.flushAudit(store)
    json(res, 200, { ok: true })
    return true
  }
}
