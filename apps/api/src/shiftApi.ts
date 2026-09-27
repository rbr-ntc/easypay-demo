// Смена как событие, реестр чеков и «требует решения».
//
// Раньше смену нельзя было закрыть: на стенде жила одна вечная смена, реестр
// копил всё с первого дня, а долг за закрытым столом был тупиком — числом в
// сверке без действия. Здесь: X-отчёт идущей смены, закрытие с Z-отчётом и
// сверкой наличных, история смен, очередь решений по долгам.

import { computeTotals, round2 } from '@easypay/domain/money'
import { buildShiftReport, type ReportCheck, type ShiftReport } from '@easypay/domain/shift'
import { currentMenu, dishName, priceOf } from './menu.ts'
import { staffName, waiterOfTable } from './staff.ts'
import { currentSettings } from './settings.ts'
import type { Store } from './store/index.ts'
import type { Settlement, ShiftCheck, ShiftInfo } from './store/types.ts'
import type { Actor, TableSession } from './types.ts'
import type { Permission } from '@easypay/domain/roles'

export interface ShiftDeps {
  json: (res: any, code: number, body: unknown) => void
  readBody: (req: any) => Promise<any>
  actorFrom: (req: any, url?: URL | null) => Actor | null
  allowed: (actor: Actor | null, permission: Permission) => boolean
  staffUnauthorized: (req: any) => unknown
  audit: (actor: Actor | null, action: string, tableId: string | null, detail?: string | null, amount?: number | null) => void
  flushAudit: (store: Store) => Promise<void>
  /** Смена открылась или закрылась — зал и гости должны узнать сразу. */
  broadcastEverywhere: (store: Store) => Promise<void>
}

/** Долго открытый стол попадает в «требует решения» — порог из настроек, в часах. */
const longOpenMs = () => currentSettings().alerts.longTableH * 60 * 60 * 1000
/** Долги старше этого срока из очереди уходят в архив. */
const DEBT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const CHECKS_LIMIT = 300

// ── Чеки для отчёта ─────────────────────────────────────────────────────

/** Окно смены по времени: деньги относятся к смене, в которую пришли. */
export interface ShiftWindow {
  from: number
  to: number
}

/**
 * От закрытия предыдущей смены до своего закрытия — без щелей между сменами.
 * Стол, перенесённый в следующую смену, несёт все свои платежи; считать их
 * по принадлежности стола значило бы посчитать вечерние деньги дважды — в
 * Z-отчёте вчерашней смены и в кассе сегодняшней.
 */
export async function windowOf(store: Store, shift: ShiftInfo): Promise<ShiftWindow> {
  const prev = (await store.shiftHistory(3)).find(s => s.id !== shift.id && s.closedAt !== null && s.closedAt <= shift.openedAt)
  return { from: prev?.closedAt ?? 0, to: shift.closedAt ?? Infinity }
}

/** Названия блюд меню — для аутсайдеров, куда попадают и не проданные ни разу. */
const menuNames = () => currentMenu().categories.flatMap(c => c.dishes.filter(d => !d.hidden).map(d => String(d.name)))

const inWindow = (at: number, w?: ShiftWindow) => !w || (at > w.from && at <= w.to)

export function reportOfCheck(c: ShiftCheck, w?: ShiftWindow): ReportCheck {
  return {
    sessionId: c.sessionId,
    tableId: c.tableId,
    openedAt: c.openedAt,
    closedAt: c.closedAt,
    guests: c.guests,
    waiter: c.waiter,
    total: c.total,
    paid: c.paid,
    debt: c.debt,
    overpaid: c.overpaid,
    refunded: c.refunded ?? 0,
    // «Снято с кухни» — потерянный продукт: отменённое после того, как взяли в
    // работу. Одно правило во всех хранилищах и витринах (зал, отчёт, сверка)
    cancelledTotal: c.cancelledTotal,
    ratings: (c.ratings ?? []).map(r => r.rating),
    payments: (c.payments ?? []).filter(p => inWindow(p.at, w)).map(p => ({ amount: p.amount, method: p.method, at: p.at })),
    tips: (c.tipsList ?? (c.tips > 0 ? [{ amount: c.tips, waiter: c.waiter, at: c.closedAt ?? c.openedAt }] : [])).filter(t => inWindow(t.at, w)),
    lines: c.lines.map(l => ({ name: l.name, qty: l.qty, amount: l.amount, cancelled: l.cancelled }))
  }
}

/** Открытый стол — тот же чек, только без закрытия: для X-отчёта и реестра. */
export function checkOfOpen(tableId: string, t: TableSession): ShiftCheck {
  const money = computeTotals(t, priceOf)
  const nameOf = (pid: string | null) => t.personas.find(p => p.id === pid)?.name ?? null
  const sent = t.lines.filter(l => l.sentAt).map(l => l.sentAt!)
  const served = t.lines.filter(l => l.servedAt).map(l => l.servedAt!)
  return {
    tableId,
    sessionId: t.sessionId ?? '',
    openedAt: t.openedAt ?? Date.now(),
    closedAt: null,
    guests: t.personas.length,
    waiter: waiterOfTable(tableId)?.name ?? null,
    lines: t.lines
      .filter(l => l.sent || l.cancelled)
      .map(l => ({
        name: dishName(l.dishId),
        qty: l.qty,
        price: l.price,
        amount: round2(l.price * l.qty),
        options: l.options ?? {},
        guest: nameOf(l.personaId),
        shared: !!l.shared,
        cancelled: !!l.cancelled,
        cancelReason: l.cancelReason ?? null
      })),
    total: round2(money.tableTotal),
    paid: round2(money.paidTotal),
    debt: 0,
    overpaid: 0,
    tips: round2(t.tips.reduce((a, x) => a + x.amount, 0)),
    cancelledTotal: round2(t.lines.filter(l => l.cancelled && l.startedAt).reduce((a, l) => a + l.price * l.qty, 0)),
    shiftId: t.shiftId ?? null,
    payments: t.payments.map(p => ({
      amount: p.amount,
      method: p.method ?? 'sbp',
      at: p.at,
      guest: nameOf(p.personaId),
      takenBy: p.takenByName ?? staffName(p.takenBy) ?? null
    })),
    tipsList: t.tips.map(x => ({ amount: x.amount, waiter: waiterOfTable(tableId)?.name ?? null, at: x.at })),
    refunded: round2((t.refunds ?? []).reduce((a, r) => a + r.amount, 0)),
    refundsList: (t.refunds ?? []).map(r => ({ amount: r.amount, method: r.method ?? 'sbp', at: r.at })),
    ratings: (t.ratings ?? []).map(r => ({ rating: r.rating, note: r.note, guest: t.personas.find(p => p.id === r.personaId)?.name ?? null })),
    firstSentAt: sent.length ? Math.min(...sent) : null,
    lastServedAt: served.length ? Math.max(...served) : null
  }
}

async function openOfShift(store: Store, shift: ShiftInfo | null): Promise<{ tableId: string; t: TableSession }[]> {
  if (!shift) return []
  const all = await store.activeSessions()
  // В памяти стол помнит смену, в базе — тоже; без смены (старые данные) — относим к текущей
  return [...all.entries()]
    .filter(([, t]) => t.status === 'open' && (t.shiftId == null || t.shiftId === shift.id))
    .map(([tableId, t]) => ({ tableId, t }))
}

const settledFor = (list: Settlement[], sessionId: string) =>
  round2(list.filter(s => s.sessionId === sessionId).reduce((a, s) => a + s.amount, 0))

function shiftPublic(s: ShiftInfo | null) {
  if (!s) return null
  return {
    id: s.id,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    openedBy: staffName(s.openedBy) ?? (s.openedBy ? 'менеджер' : null),
    closedBy: staffName(s.closedBy) ?? (s.closedBy ? 'менеджер' : null)
  }
}

const time = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })

// ── Маршруты ────────────────────────────────────────────────────────────

export function createShiftRoutes(deps: ShiftDeps) {
  const { json, readBody, actorFrom, allowed, staffUnauthorized, audit, flushAudit, broadcastEverywhere } = deps

  /** X-отчёт идущей смены и всё, что нужно мастеру закрытия. */
  async function currentState(store: Store) {
    const shift = await store.currentShift()
    const [closed, open, settled] = await Promise.all([
      shift ? store.shiftChecks(CHECKS_LIMIT) : Promise.resolve([] as ShiftCheck[]),
      openOfShift(store, shift),
      store.settlements()
    ])
    const openChecks = open.map(o => checkOfOpen(o.tableId, o.t))
    const win = shift ? await windowOf(store, shift) : undefined
    const report = buildShiftReport([...closed, ...openChecks].map(c => reportOfCheck(c, win)), menuNames())

    // Долги этой смены — каждый должен получить решение до закрытия
    const debts = closed
      .filter(c => c.debt > 0.01)
      .map(c => ({ ...debtItem(c), settled: settledFor(settled, c.sessionId) }))
      .map(d => ({ ...d, left: round2(Math.max(0, d.amount - d.settled)) }))

    // Возвраты наличными в окне смены — деньги ушли из кассы
    const cashRefunds = round2(
      [...closed, ...openChecks]
        .flatMap(c => c.refundsList ?? [])
        .filter(r => r.method === 'cash' && (!win || (r.at > win.from && r.at <= win.to)))
        .reduce((a, r) => a + r.amount, 0)
    )
    // Наличные по системе: оплаты наличными + взысканное наличными в эту смену
    const collectedCash = round2(
      settled
        .filter(s => s.kind === 'collected' && s.method === 'cash' && shift && s.at >= shift.openedAt)
        .reduce((a, s) => a + s.amount, 0)
    )

    return {
      shift: shiftPublic(shift),
      report,
      blockers: open.map(({ tableId, t }) => {
        const money = computeTotals(t, priceOf)
        return {
          tableId,
          sessionId: t.sessionId,
          guests: t.personas.length,
          openedAt: t.openedAt,
          remaining: round2(money.remaining),
          kitchen: t.lines.filter(l => l.sent && !l.served && !l.cancelled).map(l => dishName(l.dishId)),
          cash: t.cashIntent ? round2(t.cashIntent.amount) : 0,
          calls: t.calls.length
        }
      }),
      debts,
      refunds: closed
        .filter(c => c.overpaid > 0.01)
        .map(c => ({ tableId: c.tableId, sessionId: c.sessionId, amount: c.overpaid, closedAt: c.closedAt })),
      // Возврат наличными уменьшает то, что должно лежать в ящике: раньше
      // касса «не сходилась» ровно на сумму отданного гостю
      cash: { system: round2(report.byMethod.cash + collectedCash - cashRefunds), collected: collectedCash, refunded: cashRefunds }
    }
  }

  function debtItem(c: ShiftCheck) {
    return {
      sessionId: c.sessionId,
      tableId: c.tableId,
      amount: c.debt,
      closedAt: c.closedAt,
      waiter: c.waiter,
      guests: c.guests
    }
  }

  /** Очередь «требует решения»: долги, невозвращённые переплаты, долго открытые столы. */
  async function decisions(store: Store) {
    const [debtChecks, settled, notes, shift] = await Promise.all([
      store.checksWithDebt(DEBT_WINDOW_MS),
      store.settlements(),
      store.decisionNotes(),
      store.currentShift()
    ])
    const current = shift ? await store.shiftChecks(CHECKS_LIMIT) : []
    const open = await openOfShift(store, shift)
    const noteOf = (key: string) => notes.find(n => n.key === key)
    const now = Date.now()

    const items: any[] = []
    for (const c of debtChecks) {
      const left = round2(c.debt - settledFor(settled, c.sessionId))
      if (left <= 0.01) continue
      items.push({
        id: `debt:${c.sessionId}`,
        kind: 'debt',
        sessionId: c.sessionId,
        tableId: c.tableId,
        title: `Стол ${c.tableId} закрыт с долгом`,
        meta: [c.waiter, c.closedAt ? `закрыт в ${time(c.closedAt)}` : null, `${c.guests} гост.`].filter(Boolean).join(' · '),
        amount: left,
        at: c.closedAt
      })
    }
    for (const c of current) {
      if (c.overpaid <= 0.01) continue
      // Вернули на кассе (за столом уже новые гости, из системы не вернуть) — отмечено
      if (noteOf(`refund:${c.sessionId}`)) continue
      items.push({
        id: `refund:${c.sessionId}`,
        kind: 'refund',
        sessionId: c.sessionId,
        tableId: c.tableId,
        title: `Стол ${c.tableId} — переплата не возвращена`,
        meta: 'Гость заплатил больше, чем получил: это долг заведения, а не выручка',
        amount: c.overpaid,
        at: c.closedAt
      })
    }
    for (const { tableId, t } of open) {
      if (!t.openedAt || now - t.openedAt < longOpenMs() || !t.sessionId) continue
      const key = `long:${t.sessionId}`
      if (noteOf(key)) continue
      const money = computeTotals(t, priceOf)
      const h = Math.floor((now - t.openedAt) / 3_600_000)
      const m = Math.floor(((now - t.openedAt) % 3_600_000) / 60_000)
      items.push({
        id: key,
        kind: 'long',
        sessionId: t.sessionId,
        tableId,
        title: `Стол ${tableId} открыт ${h} ч ${String(m).padStart(2, '0')} мин`,
        meta: `${t.personas.length} гост. · осталось ${round2(money.remaining)} ₽`,
        amount: round2(money.remaining),
        at: t.openedAt
      })
    }

    const done = [
      ...settled.map(s => ({
        id: `settle:${s.id}`,
        kind: 'debt',
        tableId: s.tableId,
        title: `Стол ${s.tableId} — долг ${s.kind === 'collected' ? 'взыскан' : 'списан'}`,
        text:
          s.kind === 'collected'
            ? `Взыскано ${s.amount} ₽ · ${{ cash: 'наличными', transfer: 'переводом', sbp: 'по СБП' }[s.method ?? 'cash']} · ${staffName(s.byId) ?? 'менеджер'}`
            : `Списано на заведение · ${s.reason ?? 'без причины'} · ${staffName(s.byId) ?? 'менеджер'}`,
        amount: s.amount,
        at: s.at
      })),
      ...notes.map(n => ({
        id: `note:${n.key}`,
        kind: 'long',
        title: n.key.startsWith('long:') ? 'Долго открытый стол' : n.key.startsWith('refund:') ? 'Переплата возвращена на кассе' : 'Решение',
        text: `${n.text} · ${staffName(n.byId) ?? 'менеджер'}`,
        amount: 0,
        at: n.at
      }))
    ].sort((a, b) => b.at - a.at)

    return { open: items.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)), done }
  }

  /** Сводка смены для списка истории — из замороженного Z-отчёта. */
  function summaryOf(report: any) {
    const r = (report?.report ?? report) as ShiftReport | undefined
    return {
      revenue: r?.revenue ?? 0,
      checks: r?.checks ?? 0,
      guests: r?.guests ?? 0,
      avgCheck: r?.avgCheck ?? 0,
      tips: r?.tips ?? 0,
      debt: r?.debt ?? 0,
      diff: report?.cash?.diff ?? 0
    }
  }

  return async function handle(req: any, res: any, url: URL, store: Store): Promise<boolean> {
    const p = url.pathname
    if (!(p === '/api/shift' || p.startsWith('/api/shift/') || p === '/api/shifts' || p.startsWith('/api/shifts/') || p === '/api/checks' || p.startsWith('/api/decisions'))) {
      return false
    }
    // Реестр чеков смены — старая ручка — остаётся в index.ts
    if (p === '/api/shift/checks') return false

    const actor = actorFrom(req, url)
    if (!actor) {
      json(res, 401, staffUnauthorized(req))
      return true
    }
    if (!allowed(actor, 'log')) {
      json(res, 403, { error: 'role not allowed' })
      return true
    }

    if (p === '/api/shift' && req.method === 'GET') {
      json(res, 200, await currentState(store))
      return true
    }

    if (p === '/api/shift/open' && req.method === 'POST') {
      const before = await store.currentShift()
      const shift = await store.openShift(actor.id)
      if (!before) {
        audit(actor, 'смена открыта', null)
        await flushAudit(store)
        await broadcastEverywhere(store)
      }
      json(res, 200, { ok: true, shift: shiftPublic(shift) })
      return true
    }

    if (p === '/api/shift/close' && req.method === 'POST') {
      const body = await readBody(req)
      const state = await currentState(store)
      if (!state.shift) {
        json(res, 409, { error: 'no open shift' })
        return true
      }
      // Нерешённый долг — не повод «закрыть и забыть»: он уйдёт в никуда
      const unresolved = state.debts.filter(d => d.left > 0.01)
      if (unresolved.length && currentSettings().shift.debtBlocksClose) {
        json(res, 409, { error: 'debts unresolved', tables: unresolved.map(d => d.tableId) })
        return true
      }
      const counted = Number(body.cashCounted)
      if (!Number.isFinite(counted) || counted < 0) {
        json(res, 400, { error: 'cash count required' })
        return true
      }
      const diff = round2(counted - state.cash.system)
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : ''
      // Расхождение кассы — только с объяснением: иначе его нечем объяснить владельцу
      if (Math.abs(diff) > 0.01 && note.length < 4 && currentSettings().shift.noteOnDiff) {
        json(res, 409, { error: 'note required', diff })
        return true
      }

      const settled = await store.settlements()
      const shiftSettled = settled.filter(s => s.at >= (state.shift!.openedAt ?? 0))
      const z = {
        report: state.report,
        carried: state.blockers.map(b => ({ tableId: b.tableId, remaining: b.remaining, guests: b.guests })),
        settlements: shiftSettled.map(s => ({ tableId: s.tableId, kind: s.kind, amount: s.amount, method: s.method, reason: s.reason })),
        refundsLeft: state.refunds,
        cash: { system: state.cash.system, counted: round2(counted), diff, note: note || null },
        openedAt: state.shift.openedAt,
        openedBy: state.shift.openedBy,
        closedAt: Date.now(),
        closedBy: actor.name
      }
      const closed = await store.closeShift(z, actor.id)
      audit(actor, 'смена закрыта', null, [`выручка ${state.report.revenue} ₽`, diff ? `расхождение ${diff} ₽: ${note}` : null, z.carried.length ? `перенесено столов: ${z.carried.length}` : null].filter(Boolean).join(' · '), state.report.revenue)
      await flushAudit(store)
      await broadcastEverywhere(store)
      json(res, 200, { ok: true, shift: shiftPublic(closed), z })
      return true
    }

    if (p === '/api/shifts' && req.method === 'GET') {
      const [history, current] = await Promise.all([store.shiftHistory(60), currentState(store)])
      json(res, 200, {
        current: current.shift ? { ...current.shift, summary: summaryOf({ report: current.report }), live: true } : null,
        history: history.map(s => ({ ...shiftPublic(s), summary: summaryOf(s.report), live: false }))
      })
      return true
    }

    if (p.startsWith('/api/shifts/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/shifts/'.length))
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        json(res, 404, { error: 'shift not found' })
        return true
      }
      const current = await store.currentShift()
      if (current && current.id === id) {
        const state = await currentState(store)
        json(res, 200, { shift: state.shift, z: { report: state.report, carried: [], settlements: [], cash: null }, live: true })
        return true
      }
      const found = (await store.shiftHistory(200)).find(s => s.id === id)
      if (!found) {
        json(res, 404, { error: 'shift not found' })
        return true
      }
      json(res, 200, { shift: shiftPublic(found), z: found.report, live: false })
      return true
    }

    if (p === '/api/checks' && req.method === 'GET') {
      const shiftParam = url.searchParams.get('shift')
      // Id смены — uuid; иначе Postgres ответит ошибкой синтаксиса, а человек увидит 500
      if (shiftParam && shiftParam !== 'current' && !/^[0-9a-f-]{36}$/i.test(shiftParam)) {
        json(res, 404, { error: 'shift not found' })
        return true
      }
      const current = await store.currentShift()
      const isCurrent = !shiftParam || shiftParam === 'current' || shiftParam === current?.id
      const closed = await store.shiftChecks(CHECKS_LIMIT, isCurrent ? null : shiftParam)
      const open = isCurrent ? (await openOfShift(store, current)).map(o => checkOfOpen(o.tableId, o.t)) : []
      const settled = await store.settlements()
      const checks = [...open, ...closed].map(c => ({
        ...c,
        settled: settledFor(settled, c.sessionId)
      }))
      json(res, 200, { shiftId: isCurrent ? current?.id ?? null : shiftParam, checks })
      return true
    }

    if (p === '/api/decisions' && req.method === 'GET') {
      json(res, 200, await decisions(store))
      return true
    }

    if (p === '/api/decisions/settle' && req.method === 'POST') {
      const body = await readBody(req)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null
      const kind = body.kind === 'collected' || body.kind === 'written_off' ? body.kind : null
      if (!sessionId || !kind) {
        json(res, 400, { error: 'sessionId and kind required' })
        return true
      }
      const method = kind === 'collected' ? (['cash', 'transfer', 'sbp'].includes(body.method) ? body.method : null) : null
      if (kind === 'collected' && !method) {
        json(res, 400, { error: 'method required' })
        return true
      }
      const reason = kind === 'written_off' ? String(body.reason ?? '').trim().slice(0, 200) || 'гость ушёл' : null
      const check = (await store.checksWithDebt(DEBT_WINDOW_MS * 3)).find(c => c.sessionId === sessionId)
      if (!check) {
        json(res, 404, { error: 'debt not found' })
        return true
      }
      // Сумму решает сервер: остаток долга, а не число из запроса
      const left = round2(check.debt - settledFor(await store.settlements(), sessionId))
      if (left <= 0.01) {
        json(res, 409, { error: 'already settled' })
        return true
      }
      const s = await store.addSettlement({ sessionId, tableId: check.tableId, kind, amount: left, method, reason, byId: actor.id })
      if (!s) {
        json(res, 409, { error: 'already settled' })
        return true
      }
      audit(
        actor,
        kind === 'collected' ? 'долг взыскан' : 'долг списан',
        check.tableId,
        kind === 'collected' ? `способ: ${method}` : `причина: ${reason}`,
        left
      )
      await flushAudit(store)
      json(res, 200, { ok: true, settlement: s })
      return true
    }

    if (p === '/api/decisions/note' && req.method === 'POST') {
      const body = await readBody(req)
      const key = typeof body.key === 'string' && /^(long|refund):[\w-]{1,64}$/.test(body.key) ? body.key : null
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 200) : ''
      if (!key || !text) {
        json(res, 400, { error: 'key and text required' })
        return true
      }
      await store.addDecisionNote({ key, text, byId: actor.id })
      audit(actor, 'решение', null, text)
      await flushAudit(store)
      json(res, 200, { ok: true })
      return true
    }

    json(res, 404, { error: 'not found' })
    return true
  }
}
