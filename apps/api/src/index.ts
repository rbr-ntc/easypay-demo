// EasyPay demo backend: in-memory table state + SSE live sync.
// Демо-сервер без БД: перезапуск = чистые столы. Отдаёт и статику dist.
// Зависимостей нет намеренно: на VPS уезжает только dist + server + shared, без node_modules.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { amountFor, computeTotals, PAY_SCOPES, round2 } from '@easypay/domain/money'
import { can, ownsTable } from '@easypay/domain/roles'
import type { Permission } from '@easypay/domain/roles'
import { checkOptions, dishName, getDish, priceOf } from './menu.ts'
import { isKnownTable, seatsOf } from './hallplan.ts'
import { hallPayload, kitchenPayload } from './feeds.ts'
import type { Actor, AuditEntry, Call, Line, MutationResult, Persona, Shift, TableSession } from './types.ts'
import {
  dropSession,
  loginAllowed,
  loginByPin,
  sessionStaff,
  staffRoster,
  sweepSessions,
  waiterOfTable
} from './staff.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Собранный клиент лежит рядом: apps/web/dist
const DIST = path.join(__dirname, '..', '..', 'web', 'dist')
const PORT = process.env.PORT || 8787

// Итоги смены. guestsSeen считаем на входе гостя — счётчик за смену не должен уменьшаться.
const shift: Shift = {
  tables: 0,
  tablesWithRevenue: 0,
  revenue: 0,
  debt: 0,
  overpaid: 0,
  guests: 0,
  guestsSeen: 0,
  startedAt: Date.now(),
  tipsByStaff: Object.create(null)
}

// --- Токен менеджера: сервисный вход, когда PIN-ов ещё нет ---
export const MANAGER_TOKEN = process.env.EASYPAY_MANAGER_TOKEN || crypto.randomBytes(9).toString('base64url')

function tokenMatches(token: unknown): boolean {
  const given = Buffer.from(String(token ?? ''))
  const want = Buffer.from(MANAGER_TOKEN)
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

/**
 * Кто действует: сотрудник со своей сессией (вход по PIN) или мастер-токен менеджера.
 * EventSource не умеет слать заголовки, поэтому для SSE токен принимаем и из query.
 */
function actorFrom(req: any, url?: URL | null): Actor | null {
  const token =
    req.headers['x-staff-token'] ?? req.headers['x-manager-token'] ?? (url ? url.searchParams.get('token') : null)
  if (!token) return null
  if (tokenMatches(token)) return { id: 'token', name: 'Менеджер (токен)', role: 'manager', tables: [] }
  return sessionStaff(token)
}

const allowed = (actor: Actor | null, permission: any) => !!actor && can(actor.role, permission)

// --- Журнал смены ---
const AUDIT_MAX = 400
const auditLog: AuditEntry[] = []

function audit(actor: Actor | null, action: string, tableId: string | null, detail: string | null = null) {
  auditLog.push({
    at: Date.now(),
    staffId: actor?.id ?? null,
    name: actor?.name ?? 'Гость',
    role: actor?.role ?? null,
    action,
    tableId: tableId ?? null,
    detail
  })
  if (auditLog.length > AUDIT_MAX) auditLog.shift()
}

// --- Состояние столов ---
const tables = new Map<string, TableSession>()
const streams = new Map<string, Set<import("node:http").ServerResponse>>()
const hallStreams = new Set<import("node:http").ServerResponse>()
const kitchenStreams = new Set<import("node:http").ServerResponse>()
const idempotency = new Map<string, { at: number; status: number; body: Record<string, unknown> }>()

const MAX_TABLES = 500
const MAX_STREAMS_PER_TABLE = 50
const MAX_STAFF_STREAMS = 20
const MAX_IDEM = 2000
const IDEM_TTL = 10 * 60 * 1000
const MAX_CALLS = 5
const MAX_LINES = 200

function emptySession(status: 'open' | 'closed' = 'closed'): TableSession {
  return {
    sessionId: null,
    status, // 'open' | 'closed'
    openedAt: null,
    closedAt: null,
    personas: [],
    lines: [],
    payments: [],
    tips: [],
    calls: [], // очередь вызовов: второй гость не затирает первого
    seq: 1
  }
}

function getTable(id: string, create = false): TableSession {
  if (!tables.has(id)) {
    if (!create) return emptySession()
    if (tables.size >= MAX_TABLES) {
      const victim = [...tables.entries()].find(([, t]) => t.status === 'closed')
      if (victim) tables.delete(victim[0])
      else throw new Error('table limit')
    }
    tables.set(id, emptySession())
  }
  return tables.get(id)!
}

const sweeper = setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  for (const [id, t] of tables) {
    if (t.status === 'closed' && (t.closedAt ?? 0) < cutoff) {
      tables.delete(id)
      streams.delete(id)
    }
  }
  const idemCutoff = Date.now() - IDEM_TTL
  for (const [key, rec] of idempotency) if (rec.at < idemCutoff) idempotency.delete(key)
  sweepSessions()
}, 10 * 60 * 1000)
sweeper.unref()

function idemRemember(key: string, status: number, body: Record<string, unknown>) {
  if (idempotency.size >= MAX_IDEM) {
    const oldest = idempotency.keys().next().value
    if (oldest) idempotency.delete(oldest)
  }
  idempotency.set(key, { at: Date.now(), status, body })
}

function openSession(id: string): TableSession {
  const fresh = emptySession('open')
  fresh.sessionId = crypto.randomUUID()
  fresh.openedAt = Date.now()
  tables.set(id, fresh)
  return fresh
}

/** Публичная позиция: без внутренних полей, зато с названием блюда. */
function publicLine(line: Line) {
  return {
    uid: line.uid,
    dishId: line.dishId,
    name: dishName(line.dishId),
    qty: line.qty,
    price: line.price,
    options: line.options ?? {},
    shared: !!line.shared,
    sharedWith: line.sharedWith ?? [],
    personaId: line.personaId,
    sent: !!line.sent,
    served: !!line.served,
    cancelled: !!line.cancelled,
    cancelReason: line.cancelReason ?? null,
    sentAt: line.sentAt ?? null,
    startedAt: line.startedAt ?? null,
    servedAt: line.servedAt ?? null
  }
}

/**
 * Снапшот стола. Секреты гостей наружу не уходят, зато уходят ИТОГИ: гость должен
 * видеть ровно те числа, которые спишет сервер, а не считать их сам.
 */
function snapshot(id: string) {
  const t = getTable(id, false)
  const money = computeTotals(t, priceOf)
  const nameOf = pid => t.personas.find(p => p.id === pid)?.name ?? 'Гость'

  return {
    tableId: id,
    sessionId: t.sessionId,
    status: t.status,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    personas: t.personas.map(p => ({ id: p.id, name: p.name, animal: p.animal, joinedAt: p.joinedAt })),
    lines: t.lines.map(publicLine),
    payments: t.payments,
    tips: t.tips,
    calls: t.calls.map(c => ({ id: c.id, at: c.at, personaId: c.personaId, reason: c.reason, name: nameOf(c.personaId) })),
    call: t.calls[0] ? { ...t.calls[0], name: nameOf(t.calls[0].personaId) } : null,
    waiter: waiterOfTable(id),
    seats: seatsOf(id),
    totals: {
      tableTotal: round2(money.tableTotal),
      paidTotal: round2(money.paidTotal),
      remaining: round2(money.remaining),
      sharedTotal: round2(money.sharedTotal),
      draftTotal: round2(money.draftTotal),
      byPersona: t.personas.map(p => ({
        personaId: p.id,
        own: round2(money.ownOf(p.id)),
        share: round2(money.shareOf(p.id)),
        total: round2(money.totalOf(p.id)),
        paid: round2(money.paidOf(p.id)),
        remaining: round2(money.remainingOf(p.id)),
        draft: round2(money.draftOf(p.id))
      }))
    }
  }
}

function pushTo(subscribers: Set<any>, payload: unknown) {
  if (subscribers.size === 0) return
  const data = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of subscribers) {
    try {
      res.write(data)
    } catch {
      subscribers.delete(res)
    }
  }
}

function broadcast(id: string) {
  const subs = streams.get(id)
  if (subs) pushTo(subs, snapshot(id))
  if (hallStreams.size > 0) pushTo(hallStreams, hallPayload(tables, shift))
  if (kitchenStreams.size > 0) pushTo(kitchenStreams, kitchenPayload(tables))
}

// --- HTTP helpers ---
function json(res: any, code: number, obj: unknown) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readBody(req: any): Promise<any> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64 * 1024) throw new Error('body too large')
  }
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
  return parsed
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
}

async function serveStatic(req: any, res: any, pathname: string) {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('dist not built')
    return
  }
  let filePath = path.normalize(path.join(DIST, pathname === '/' ? 'index.html' : pathname))
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  if (!existsSync(filePath)) filePath = path.join(DIST, 'index.html')
  try {
    const data = await readFile(filePath)
    const ext = path.extname(filePath)
    // Файлы в assets/ содержат хеш в имени — их можно кэшировать вечно.
    // index.html обязан перепроверяться, иначе тестировщик залипает на старой сборке.
    const hashed = filePath.includes(`${path.sep}assets${path.sep}`)
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

// --- Валидация входа ---
const NAME_MAX = 30
const ANIMALS = new Set(['fox', 'bear', 'panda', 'raccoon', 'owl', 'cat'])
const TABLE_RE = /^[A-Za-z0-9_-]{1,24}$/
const STAFF_ACTIONS = new Set(['serve', 'start', 'close', 'reset', 'ack'])
const GUEST_ACTIONS = new Set(['lines', 'remove', 'send', 'pay', 'tip', 'call'])
const IDEMPOTENT_ACTIONS = new Set(['join', 'lines', 'pay', 'tip'])
const CALL_REASONS = new Set(['help', 'bill', 'water'])
const MAX_QTY = 9

function sanitizeName(name: unknown): string {
  return String(name ?? '')
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, NAME_MAX)
}

const asId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null)
const asUid = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): MutationResult => ({
  status,
  body: { error, ...extra }
})
const ok = (body: Record<string, unknown> = { ok: true }): MutationResult => ({ status: 200, body })

/** Отменяет всё, что висит на кухне: повар должен узнать, что блюдо больше не нужно. */
function cancelPending(table: TableSession, reason: string): number {
  const now = Date.now()
  let count = 0
  for (const line of table.lines) {
    if (line.sent && !line.served && !line.cancelled) {
      line.cancelled = true
      line.cancelledAt = now
      line.cancelReason = reason
      count += 1
    }
  }
  return count
}

// --- Мутации ---
function mutate(tableId: string, action: string, body: any, actor: Actor | null, req: any): MutationResult {
  const t = getTable(tableId, true)

  // Действие должно относиться к текущей сессии стола: uid переиспользуются после закрытия
  if (body.sessionId && t.sessionId && body.sessionId !== t.sessionId) return fail(409, 'stale session')

  if (STAFF_ACTIONS.has(action)) return staffAction(t, tableId, action, body, actor)
  if (action === 'join') return joinGuest(t, tableId, body)
  if (!GUEST_ACTIONS.has(action)) return fail(404, 'unknown action')

  // Гостевые действия: только владелец персоны, по личному токену из join
  const token = req.headers['x-guest-token'] ?? body.guestToken
  if (!token) return fail(401, 'guest token required')
  const persona = t.personas.find(p => p.secret === String(token))
  if (!persona) return fail(403, 'unknown guest')
  if (body.personaId && body.personaId !== persona.id) return fail(403, 'not your persona')
  if (t.status !== 'open') return fail(409, 'table closed')

  return guestAction(t, tableId, action, body, persona)
}

function joinGuest(t: TableSession, tableId: string, body: any): MutationResult {
  if (!isKnownTable(tableId)) return fail(404, 'unknown table')
  const table = t.status === 'open' ? t : openSession(tableId)
  const seats = seatsOf(tableId)
  if (table.personas.length >= seats) return fail(400, 'table full', { seats })

  const name = sanitizeName(body.name) || `Гость ${table.personas.length + 1}`
  if (body.animal !== undefined && !ANIMALS.has(body.animal)) return fail(400, 'unknown animal')
  const animal = ANIMALS.has(body.animal) ? body.animal : 'fox'

  const persona = {
    id: crypto.randomUUID(),
    name,
    animal,
    joinedAt: Date.now(),
    secret: crypto.randomBytes(18).toString('base64url')
  }
  table.personas.push(persona)
  shift.guestsSeen += 1
  audit(null, 'сел за стол', tableId, name)
  broadcast(tableId)
  return ok({ personaId: persona.id, guestToken: persona.secret, snapshot: snapshot(tableId) })
}

function guestAction(t: TableSession, tableId: string, action: string, body: any, persona: Persona): MutationResult {
  if (action === 'lines') {
    const dish = getDish(asId(body.dishId))
    if (!dish) return fail(400, 'unknown dish')
    if (dish.stop) return fail(400, 'dish in stop list')

    const qty = Number(body.qty ?? 1)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return fail(400, 'bad qty', { min: 1, max: MAX_QTY })

    const checked = checkOptions(dish, body.options)
    if (checked.error) return fail(400, checked.error)
    if (t.lines.length >= MAX_LINES) return fail(400, 'too many lines')

    const line = {
      uid: t.seq++,
      dishId: dish.id,
      qty,
      price: dish.price, // цена фиксируется в момент заказа
      options: checked.options ?? {},
      shared: !!body.shared,
      sharedWith: [],
      personaId: persona.id,
      sent: false,
      served: false,
      cancelled: false,
      sentAt: null,
      startedAt: null,
      servedAt: null
    }
    t.lines.push(line)
    audit(null, 'добавил', tableId, `${persona.name}: ${dish.name}${qty > 1 ? ` ×${qty}` : ''}`)
    broadcast(tableId)
    return ok({ ok: true, uid: line.uid, line: publicLine(line) })
  }

  if (action === 'remove') {
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line || line.sent) return fail(400, 'locked or missing')
    if (line.personaId !== persona.id) return fail(403, 'not yours')
    t.lines = t.lines.filter(l => l !== line)
    audit(null, 'убрал', tableId, `${persona.name}: ${dishName(line.dishId)}`)
    broadcast(tableId)
    return ok()
  }

  if (action === 'send') {
    const scope = body.scope === 'all' ? 'all' : 'mine'
    const now = Date.now()
    const sharers = t.personas.map(p => p.id)
    let sent = 0
    for (const line of t.lines) {
      if (line.sent || line.cancelled) continue
      if (scope === 'mine' && line.personaId !== persona.id) continue
      line.sent = true
      line.sentAt = now
      // Доля общего блюда фиксируется здесь: делят те, кто за столом в момент заказа
      if (line.shared) line.sharedWith = sharers
      sent += 1
    }
    if (sent === 0) return fail(400, 'nothing to send')
    audit(null, 'отправил на кухню', tableId, `${persona.name}: ${sent} поз.`)
    broadcast(tableId)
    return ok({ ok: true, sent })
  }

  if (action === 'pay') {
    if (body.scope !== undefined && !PAY_SCOPES.includes(body.scope)) {
      return fail(400, 'unknown pay scope', { allowed: PAY_SCOPES })
    }
    const scope = body.scope ?? 'own'
    const money = computeTotals(t, priceOf)
    const amount = round2(amountFor(money, persona.id, scope))
    if (amount <= 0) return fail(400, 'nothing to pay')
    t.payments.push({ personaId: persona.id, amount, scope, at: Date.now() })
    audit(null, 'оплата', tableId, `${persona.name} · ${amount} ₽ (${scope})`)
    broadcast(tableId)
    return ok({ ok: true, amount, remaining: round2(computeTotals(t, priceOf).remaining) })
  }

  if (action === 'tip') {
    const raw = Number(body.amount)
    if (!Number.isFinite(raw) || raw <= 0) return fail(400, 'bad amount')
    const money = computeTotals(t, priceOf)
    // Потолок привязан к счёту и считается по СУММЕ чаевых стола: иначе обходится циклом
    const cap = Math.max(5000, round2(money.tableTotal))
    const already = t.tips.reduce((sum, x) => sum + x.amount, 0)
    if (round2(already + raw) > cap) return fail(400, 'tip too large', { cap, already: round2(already) })
    const amount = round2(raw)
    const waiter = waiterOfTable(tableId)
    t.tips.push({ personaId: persona.id, amount, at: Date.now(), waiterId: waiter?.id ?? null })
    if (waiter) shift.tipsByStaff[waiter.id] = (shift.tipsByStaff[waiter.id] ?? 0) + amount
    audit(null, 'чаевые', tableId, `${persona.name} → ${waiter?.name ?? 'официанту'} · ${amount} ₽`)
    broadcast(tableId)
    return ok({ ok: true, amount })
  }

  // call
  const reason = CALL_REASONS.has(body.reason) ? body.reason : 'help'
  if (t.calls.length >= MAX_CALLS) return fail(400, 'too many calls')
  if (!t.calls.some(c => c.personaId === persona.id && c.reason === reason)) {
    t.calls.push({ id: crypto.randomUUID(), at: Date.now(), personaId: persona.id, reason })
    audit(null, 'позвал официанта', tableId, `${persona.name} · ${reason}`)
  }
  broadcast(tableId)
  return ok()
}

function staffAction(t: TableSession, tableId: string, action: string, body: any, actor: Actor | null): MutationResult {
  if (!actor) return fail(401, 'staff login required')
  if (!can(actor.role, action as Permission)) return fail(403, 'role not allowed')
  // Закреплённые столы — ответственность, а не подсветка: чужой стол трогать нельзя
  if (!ownsTable(actor, tableId)) return fail(403, 'not your table', { waiter: waiterOfTable(tableId)?.name ?? null })

  if (action === 'start' || action === 'serve') {
    if (t.status !== 'open') return fail(409, 'table closed')
    if (!body.sessionId) return fail(400, 'sessionId required')
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line) return fail(404, 'line not found')
    if (line.cancelled) return fail(409, 'line cancelled')
    if (!line.sent) return fail(400, 'not sent to kitchen yet')
    if (line.served) return fail(409, 'already served')

    if (action === 'start') {
      line.startedAt = line.startedAt ?? Date.now()
      audit(actor, 'взял в работу', tableId, dishName(line.dishId))
      broadcast(tableId)
      return ok({ ok: true, startedAt: line.startedAt })
    }

    // сначала «в работу», иначе время готовки не собирается вовсе
    if (!line.startedAt) return fail(409, 'not started yet')
    line.served = true
    line.servedAt = Date.now()
    audit(actor, 'подал', tableId, dishName(line.dishId))
    broadcast(tableId)
    return ok()
  }

  if (action === 'ack') {
    if (t.calls.length === 0) return fail(400, 'no call')
    const callId = asId(body.callId)
    const call = callId ? t.calls.find(c => c.id === callId) : t.calls[0]
    if (!call) return fail(404, 'call not found')
    t.calls = t.calls.filter(c => c !== call)
    audit(actor, 'принял вызов', tableId, t.personas.find(p => p.id === call.personaId)?.name ?? null)
    broadcast(tableId)
    return ok({ ok: true, left: t.calls.length })
  }

  if (action === 'close') {
    if (t.status === 'open') {
      const money = computeTotals(t, priceOf)
      // Стол с долгом закрывается только осознанно: иначе выручка тихо исчезает
      if (money.remaining > 0.01 && body.force !== true) {
        return fail(409, 'unpaid', { remaining: round2(money.remaining) })
      }
      shift.tables += 1
      shift.revenue += money.paidTotal
      shift.guests += t.personas.length
      if (money.paidTotal > 0) shift.tablesWithRevenue += 1
      shift.debt += money.remaining
      const cancelled = cancelPending(t, 'стол закрыт')
      // Отмена неподанного могла уронить счёт ниже оплаченного — это переплата гостя,
      // её нельзя прятать: по 54-ФЗ нужен возврат
      const after = computeTotals(t, priceOf)
      const overpaid = round2(Math.max(0, after.paidTotal - after.tableTotal))
      if (overpaid > 0.01) {
        shift.overpaid += overpaid
        t.overpaid = overpaid
        audit(actor, 'переплата к возврату', tableId, `${overpaid} ₽ за отменённое`)
      }
      const withDebt = money.remaining > 0.01
      audit(
        actor,
        withDebt ? 'закрыл стол с долгом' : 'закрыл стол',
        tableId,
        `оплачено ${round2(money.paidTotal)} ₽${withDebt ? `, долг ${round2(money.remaining)} ₽` : ''}${
          cancelled ? `, отменено на кухне: ${cancelled}` : ''
        }`
      )
    }
    t.status = 'closed'
    t.closedAt = Date.now()
    broadcast(tableId)
    return ok()
  }

  // reset: тот же порядок, что и close — иначе это чёрный ход мимо защиты от долга
  if (t.status === 'open') {
    const money = computeTotals(t, priceOf)
    if (money.remaining > 0.01 && body.force !== true) {
      return fail(409, 'unpaid', { remaining: round2(money.remaining) })
    }
    shift.debt += money.remaining
    shift.revenue += money.paidTotal
    if (money.paidTotal > 0) shift.tablesWithRevenue += 1
    if (money.remaining > 0.01) audit(actor, 'сбросил стол с долгом', tableId, `долг ${round2(money.remaining)} ₽`)
  }
  const cancelled = cancelPending(t, 'стол сброшен')
  const dead = { ...emptySession(), lines: t.lines.filter(l => l.cancelled) }
  tables.set(tableId, dead)
  audit(actor, 'сбросил стол', tableId, cancelled ? `отменено на кухне: ${cancelled}` : null)
  broadcast(tableId)
  return ok()
}

/** Общая обвязка экранов персонала: GET-снапшот и SSE на одном payload. */
function staffFeed(req: any, res: any, url: URL, payloadFn: () => unknown, subscribers: Set<any>, permission: any) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method' })
  const actor = actorFrom(req, url)
  if (!actor) return json(res, 401, { error: 'staff login required' })
  if (!allowed(actor, permission)) return json(res, 403, { error: 'role not allowed' })
  if (!url.pathname.endsWith('/stream')) return json(res, 200, payloadFn())

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  })
  res.write(`data: ${JSON.stringify(payloadFn())}\n\n`)
  if (subscribers.size >= MAX_STAFF_STREAMS) {
    res.end()
    return
  }
  subscribers.add(res)
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* closed */
    }
  }, 25000)
  req.on('close', () => {
    clearInterval(ping)
    subscribers.delete(res)
  })
}

// --- Роутер API ---
async function handleApi(req: any, res: any, url: URL) {
  if (url.pathname === '/api/staff/login') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' })
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (!loginAllowed(ip)) return json(res, 429, { error: 'too many attempts' })
    const body = await readBody(req).catch(() => null)
    if (body === null) return json(res, 400, { error: 'bad json' })
    const result = loginByPin(body.pin, ip)
    if (!result) return json(res, 401, { error: 'wrong pin' })
    audit(result.staff, 'вошёл в смену', null)
    return json(res, 200, { token: result.token, staff: result.staff })
  }

  if (url.pathname === '/api/staff/me' || url.pathname === '/api/manager/check') {
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, { error: 'staff login required' })
    return json(res, 200, { ok: true, staff: actor, shiftTips: round2(shift.tipsByStaff[actor.id] ?? 0) })
  }

  if (url.pathname === '/api/staff/logout') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' })
    dropSession(req.headers['x-staff-token'])
    return json(res, 200, { ok: true })
  }

  if (url.pathname === '/api/staff/roster') {
    const actor = actorFrom(req, url)
    if (!allowed(actor, 'log')) return json(res, 403, { error: 'role not allowed' })
    return json(res, 200, { staff: staffRoster() })
  }

  if (url.pathname === '/api/log') {
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, { error: 'staff login required' })
    if (!allowed(actor, 'log')) return json(res, 403, { error: 'role not allowed' })
    return json(res, 200, { entries: [...auditLog].reverse().slice(0, 150) })
  }

  if (url.pathname === '/api/hall' || url.pathname === '/api/hall/stream') {
    return staffFeed(req, res, url, () => hallPayload(tables, shift), hallStreams, 'hall')
  }
  if (url.pathname === '/api/kitchen' || url.pathname === '/api/kitchen/stream') {
    return staffFeed(req, res, url, () => kitchenPayload(tables), kitchenStreams, 'kitchen')
  }

  // /api/t/:table[/action]
  const parts = url.pathname.split('/').filter(Boolean)
  const tableId = String(parts[2] ?? '')
  if (parts[1] !== 't' || !TABLE_RE.test(tableId)) return json(res, 404, { error: 'not found' })
  const action = parts[3] ?? ''

  if (req.method === 'GET' && action === '') return json(res, 200, snapshot(tableId))

  if (req.method === 'GET' && action === 'stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    res.write(`data: ${JSON.stringify(snapshot(tableId))}\n\n`)
    if (!streams.has(tableId)) streams.set(tableId, new Set())
    const subs = streams.get(tableId)!
    if (subs.size >= MAX_STREAMS_PER_TABLE) {
      res.end()
      return
    }
    subs!.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        /* closed */
      }
    }, 25000)
    req.on('close', () => {
      clearInterval(ping)
      streams.get(tableId)?.delete(res)
    })
    return
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method' })
  const body = await readBody(req).catch(() => null)
  if (body === null) return json(res, 400, { error: 'bad json' })

  // Для денег ключ идемпотентности обязателен: без него ретрай спишет дважды
  if ((action === 'pay' || action === 'tip') && !asId(body.idemKey)) {
    return json(res, 400, { error: 'idemKey required' })
  }
  const idemKey = IDEMPOTENT_ACTIONS.has(action) ? asId(body.idemKey) : null
  const cacheKey = idemKey && `${tableId}:${action}:${idemKey}`
  if (cacheKey) {
    const hit = idempotency.get(cacheKey)
    if (hit) return json(res, hit.status, hit.body)
  }

  const out = mutate(tableId, action, body, actorFrom(req), req)
  if (cacheKey && out.status === 200) idemRemember(cacheKey, out.status, out.body)
  return json(res, out.status, out.body)
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
      return await serveStatic(req, res, url.pathname)
    } catch (err) {
      console.error('request failed:', err)
      return json(res, 500, { error: 'internal' })
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`EasyPay demo server on :${PORT}`)
    console.log(
      process.env.EASYPAY_MANAGER_TOKEN
        ? 'Manager token: из EASYPAY_MANAGER_TOKEN'
        : `Manager token (сгенерирован): ${MANAGER_TOKEN}`
    )
  })
}
