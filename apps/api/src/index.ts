// EasyPay API: HTTP + SSE. Состояние стола живёт в хранилище (память или Postgres),
// доменные правила — чистые функции над объектом сессии стола.
//
// Порядок любой мутации: загрузили сессию под блокировкой → применили правило →
// сохранили → записали журнал → разослали снапшот. Деньги считает только сервер.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { amountFor, computeTotals, isBillLine, PAY_SCOPES, round2, splitRounded } from '@easypay/domain/money'
import type { PayScope } from '@easypay/domain/money'
import { can, ownsTable } from '@easypay/domain/roles'
import type { Permission } from '@easypay/domain/roles'
import { allergensOf, checkOptions, dishName, getDish, menuPayload, priceOf, priceWithOptions } from './menu.ts'
import { ALLERGENS } from '@easypay/domain/allergens'
import { isKnownTable, seatsOf } from './hallplan.ts'
import { hallPayload, kitchenPayload } from './feeds.ts'
import { createStore, type Store } from './store/index.ts'
import {
  dropSession,
  wasRevoked,
  loginAllowed,
  lockoutSeconds,
  loginByPin,
  sessionStaff,
  staffName,
  staffRoster,
  sweepSessions,
  waiterOfTable
} from './staff.ts'
import type { Actor, AuditEntry, MutationResult, PayMethod, Persona, TableSession } from './types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', '..', 'web', 'dist')
const PORT = process.env.PORT || 8787

// --- Хранилище ---
let storePromise: Promise<Store> | null = null
const getStore = () => (storePromise ??= createStore())

/** Для тестов и корректного завершения: закрывает подключение хранилища. */
export async function closeStore() {
  if (!storePromise) return
  const store = await storePromise
  storePromise = null
  await store.close()
}

// --- Токен менеджера: сервисный вход, когда PIN-ов ещё нет ---
export const MANAGER_TOKEN = process.env.EASYPAY_MANAGER_TOKEN || crypto.randomBytes(9).toString('base64url')

function tokenMatches(token: unknown): boolean {
  const given = Buffer.from(String(token ?? ''))
  const want = Buffer.from(MANAGER_TOKEN)
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

const hashToken = (token: unknown) => crypto.createHash('sha256').update(String(token)).digest('hex')

/**
 * Кто действует: сотрудник со своей сессией (вход по PIN) или мастер-токен менеджера.
 * EventSource не умеет слать заголовки, поэтому для SSE токен принимаем и из query.
 */
function actorFrom(req: any, url?: URL | null): Actor | null {
  const token =
    req.headers['x-staff-token'] ?? req.headers['x-manager-token'] ?? (url ? url.searchParams.get('token') : null)
  if (!token) return null
  if (tokenMatches(token)) return { id: 'token', name: 'Менеджер (токен)', role: 'manager', tables: [], sessionId: null }
  return sessionStaff(token)
}

const allowed = (actor: Actor | null, permission: Permission) => !!actor && can(actor.role, permission)

// --- Журнал ---
// Мутация синхронна, поэтому записи можно копить здесь и сбрасывать после сохранения.
let pendingAudit: AuditEntry[] = []

function audit(
  actor: Actor | null,
  action: string,
  tableId: string | null,
  detail: string | null = null,
  amount: number | null = null,
  guest: { id: string; name: string } | null = null
) {
  pendingAudit.push({
    at: Date.now(),
    staffId: actor?.id ?? null,
    // Гость — тоже автор действия, и в споре о деньгах важно знать, какой именно
    guestId: guest?.id ?? null,
    name: actor?.name ?? guest?.name ?? 'Гость',
    role: actor?.role ?? null,
    sessionId: actor?.sessionId ?? null,
    action,
    tableId: tableId ?? null,
    detail,
    amount
  })
}

async function flushAudit(store: Store) {
  const entries = pendingAudit
  pendingAudit = []
  for (const entry of entries) await store.audit(entry)
}

// --- Потоки SSE ---
const streams = new Map<string, Set<http.ServerResponse>>()
const hallStreams = new Set<http.ServerResponse>()
const kitchenStreams = new Set<http.ServerResponse>()
const idempotency = new Map<string, { at: number; status: number; body: Record<string, unknown> }>()

const MAX_STREAMS_PER_TABLE = 50
const MAX_STAFF_STREAMS = 20
const MAX_IDEM = 2000
const IDEM_TTL = 10 * 60 * 1000
const MAX_CALLS = 5
const MAX_LINES = 200

const sweeper = setInterval(() => {
  const cutoff = Date.now() - IDEM_TTL
  for (const [key, rec] of idempotency) if (rec.at < cutoff) idempotency.delete(key)
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

/** Открывает новую сессию прямо в объекте: хранилище не должно подменять ссылки. */
function openSessionInPlace(t: TableSession) {
  // Новая посадка — всегда новая сессия. Раньше при переоткрытии стола сюда
  // попадал id ЗАКРЫТОЙ сессии из базы: клиент не видел расхождения, не забывал
  // мёртвую личность и упирался в «unknown guest» на каждом действии.
  t.sessionId = crypto.randomUUID()
  t.status = 'open'
  t.openedAt = Date.now()
  t.closedAt = null
  t.personas = []
  t.lines = []
  t.payments = []
  t.tips = []
  t.calls = []
  t.seq = 1
  t.overpaid = 0
  if (t.db) t.db.sessionUuid = null // в БД это будет новая строка сессии
}

/** Публичная позиция: без внутренних полей, зато с названием блюда. */
function publicLine(line: any) {
  return {
    uid: line.uid,
    dishId: line.dishId,
    name: dishName(line.dishId),
    qty: line.qty,
    price: line.price,
    options: line.options ?? {},
    // Состав с учётом модификаторов: гость должен иметь возможность перепроверить,
    // что он съест, уже после отправки на кухню
    allergens: allergensOf(line.dishId, line.options ?? {}),
    comment: line.comment ?? null,
    shared: !!line.shared,
    sharedWith: line.sharedWith ?? [],
    personaId: line.personaId,
    sent: !!line.sent,
    served: !!line.served,
    cancelled: !!line.cancelled,
    cancelReason: line.cancelReason ?? null,
    sentAt: line.sentAt ?? null,
    startedAt: line.startedAt ?? null,
    readyAt: line.readyAt ?? null,
    servedAt: line.servedAt ?? null
  }
}

/**
 * Снапшот стола. Секреты гостей наружу не уходят, зато уходят ИТОГИ: гость должен
 * видеть ровно те числа, которые спишет сервер, а не считать их сам.
 */
function snapshot(t: TableSession, id: string) {
  const money = computeTotals(t, priceOf)
  const nameOf = (pid: string) => t.personas.find(p => p.id === pid)?.name ?? 'Гость'

  return {
    tableId: id,
    sessionId: t.sessionId,
    status: t.status,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    personas: t.personas.map(p => ({
      id: p.id,
      name: p.name,
      animal: p.animal,
      joinedAt: p.joinedAt,
      allergies: p.allergies ?? []
    })),
    lines: t.lines.map(publicLine),
    payments: t.payments.map(p => ({
      personaId: p.personaId,
      amount: p.amount,
      scope: p.scope,
      at: p.at,
      method: p.method ?? 'sbp',
      // Кто физически взял наличные — вечером по этому имени сверяют кассу
      takenByName: p.takenByName ?? staffName(p.takenBy),
      receiptNo: p.receiptNo ?? null,
      lines: p.lines ?? []
    })),
    tips: t.tips.map(x => ({ personaId: x.personaId, amount: x.amount, at: x.at, waiterId: x.waiterId })),
    calls: t.calls.map(c => ({
      id: c.id,
      at: c.at,
      personaId: c.personaId,
      reason: c.reason,
      note: c.note ?? null,
      name: nameOf(c.personaId)
    })),
    call: t.calls[0] ? { ...t.calls[0], name: nameOf(t.calls[0].personaId) } : null,
    waiter: waiterOfTable(id),
    // «Хочу наличными»: официант подойдёт и подтвердит приём денег
    cashIntent: t.cashIntent ?? null,
    seats: seatsOf(id),
    totals: {
      tableTotal: round2(money.tableTotal),
      paidTotal: round2(money.paidTotal),
      remaining: round2(money.remaining),
      // Заплатили больше, чем осталось в счёте (например, блюдо отменили после
      // оплаты) — эти деньги надо вернуть, и видно это должно быть сразу
      overpaid: round2(Math.max(0, money.paidTotal - money.tableTotal)),
      sharedTotal: round2(money.sharedTotal),
      draftTotal: round2(money.draftTotal),
      byPersona: (() => {
        // Округляем не по отдельности, а так, чтобы суммы сходились со столом:
        // иначе гость видит доли, которые в сумме не равны счёту
        const ids = t.personas.map(p => p.id)
        // Хвост округления раскладываем ОДИН раз — на долях общих блюд. Всё
        // остальное выводится из них, поэтому «своё + доля» у гостя всегда
        // равно его счёту, а остаток — счёту минус оплаченное. Раньше доли и
        // итоги округлялись независимо: гость видел долю 163,34 при остатке 163,33.
        const shares = splitRounded(ids.map(id => money.shareOf(id)), round2(money.sharedTotal))
        const tableLeft = round2(money.remaining)
        return t.personas.map((p, i) => {
          const own = round2(money.ownOf(p.id))
          const total = round2(own + shares[i])
          const paid = round2(money.paidOf(p.id))
          return {
            personaId: p.id,
            own,
            share: shares[i],
            total,
            paid,
            // С гостя не возьмут больше, чем должен стол
            remaining: round2(Math.min(Math.max(0, round2(total - paid)), tableLeft)),
            draft: round2(money.draftOf(p.id))
          }
        })
      })()
    }
  }
}

/**
 * Что видно постороннему: стол существует, занят или свободен, сколько мест.
 * Ни имён, ни блюд, ни денег — гость по QR должен понять, куда он сел,
 * а не прочитать выписку по соседям.
 */
function publicStub(t: TableSession, id: string) {
  return {
    tableId: id,
    sessionId: null,
    status: t.status,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    occupied: t.personas.length,
    seats: seatsOf(id),
    personas: [],
    lines: [],
    payments: [],
    tips: [],
    calls: [],
    call: null,
    waiter: null,
    limited: true,
    totals: { tableTotal: 0, paidTotal: 0, remaining: 0, sharedTotal: 0, draftTotal: 0, byPersona: [] }
  }
}

/** Гость этого стола — тот, чей секрет совпал с одной из персон сессии. */
function guestOf(t: TableSession, token: unknown): Persona | null {
  if (!token) return null
  const hash = hashToken(token)
  return t.personas.find(p => p.secretHash === hash) ?? null
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

async function broadcast(store: Store, id: string) {
  const subs = streams.get(id)
  if (subs?.size) {
    const session = await store.read(id)
    const full = snapshot(session, id)
    const stub = publicStub(session, id)
    for (const res of subs) {
      try {
        res.write(`data: ${JSON.stringify((res as any).epFullView ? full : stub)}\n\n`)
      } catch {
        subs.delete(res)
      }
    }
  }
  if (hallStreams.size > 0) pushTo(hallStreams, hallPayload(await store.activeSessions(), await store.shift()))
  if (kitchenStreams.size > 0) pushTo(kitchenStreams, kitchenPayload(await store.activeSessions()))
}

// --- HTTP helpers ---
/** 401 с причиной: «вас вытеснили» и «вы не вошли» — разные вещи для человека. */
function staffUnauthorized(req: any) {
  return wasRevoked(req.headers['x-staff-token'])
    ? { error: 'signed out elsewhere', hint: 'вы вошли на другом устройстве — войдите заново' }
    : { error: 'staff login required' }
}

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
    // Хешированные бандлы кэшируются вечно, index.html — всегда перепроверяется
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
const STAFF_ACTIONS = new Set(['serve', 'ready', 'start', 'close', 'reset', 'ack', 'dismiss', 'clean', 'cash'])
const GUEST_ACTIONS = new Set(['lines', 'remove', 'send', 'pay', 'tip', 'call', 'cancelMine', 'cashIntent'])
const IDEMPOTENT_ACTIONS = new Set(['join', 'lines', 'pay', 'tip'])
const CALL_REASONS = new Set(['help', 'bill', 'water'])
const PAY_METHODS = new Set(['sbp', 'card', 'cash'])
// send говорит mine/all, pay — own/full. Принимаем оба словаря, чтобы разница
// между соседними ручками не стоила гостю ошибки
const PAY_SCOPE_ALIASES: Record<string, PayScope> = { mine: 'own', all: 'full' }
const MAX_QTY = 9

function sanitizeName(name: unknown): string {
  return String(name ?? '')
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, NAME_MAX)
}

const NOTE_MAX = 200

/** Заметка гостя: живой текст, но без разметки и управляющих символов. */
function sanitizeNote(note: unknown): string | null {
  if (note === undefined || note === null) return null
  const clean = String(note)
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, NOTE_MAX)
  return clean.length > 0 ? clean : null
}

const asId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null)
const asUid = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): MutationResult => ({
  status,
  body: { error, ...extra }
})
const ok = (body: Record<string, unknown> = { ok: true }): MutationResult => ({ status: 200, body })

/** Отменяет всё, что висит на кухне: повар должен узнать, что блюдо больше не нужно. */
function cancelPending(table: TableSession, reason: string, actor: Actor | null): { count: number; amount: number } {
  const now = Date.now()
  let count = 0
  let amount = 0
  for (const line of table.lines) {
    if (line.sent && !line.served && !line.cancelled) {
      line.cancelled = true
      line.cancelledAt = now
      line.cancelReason = reason
      line.cancelledBy = actor?.id ?? null
      count += 1
      amount += line.price * line.qty
    }
  }
  return { count, amount: round2(amount) }
}

// --- Мутации: чистые функции над сессией стола ---
export function mutate(
  t: TableSession,
  tableId: string,
  action: string,
  body: any,
  actor: Actor | null,
  req: any
): MutationResult {
  // Действие должно относиться к текущей сессии стола: uid переиспользуются после закрытия.
  // Гостю и персоналу нужны разные слова: сотрудник просто перезагрузит экран,
  // а гость с полной тарелкой должен понять, что стол закрыли и надо позвать человека.
  if (body.sessionId && t.sessionId && body.sessionId !== t.sessionId) {
    return fail(409, actor ? 'stale session' : 'session ended', { sessionId: t.sessionId })
  }

  if (STAFF_ACTIONS.has(action)) return staffAction(t, tableId, action, body, actor)
  if (action === 'join') return joinGuest(t, tableId, body)
  if (!GUEST_ACTIONS.has(action)) return fail(404, 'unknown action')

  // Гостевые действия: только владелец персоны, по личному токену из join
  const token = req.headers['x-guest-token'] ?? body.guestToken
  if (!token) return fail(401, 'guest token required')
  const hash = hashToken(token)
  const persona = t.personas.find(p => p.secretHash === hash)
  if (!persona) {
    // Стол умирает двумя способами, и гость переживает их по-разному. На сбросе
    // позиции остаются с читаемой причиной, а на пересоздании сессии тот же
    // токен получал голое «unknown guest» — техническую фразу вместо объяснения.
    // Гость с полной тарелкой видел приложение, которое утверждает, что его тут нет.
    const stale = body.sessionId && t.sessionId && body.sessionId !== t.sessionId
    if (stale || t.status !== 'open') {
      return fail(409, 'session ended', { sessionId: t.sessionId })
    }
    return fail(403, 'unknown guest')
  }
  if (body.personaId && body.personaId !== persona.id) return fail(403, 'not your persona')
  // Чаевые — исключение: гость ещё сидит за столом, даже если зал уже его закрыл.
  // Иначе окно для благодарности схлопывается в ноль секунд ровно у того, кто
  // заплатил за всех, — а чаевые идут официанту мимо счёта и ничего не ломают.
  const TIP_AFTER_CLOSE_MS = 30 * 60_000
  const justClosed = t.status === 'closed' && t.closedAt && Date.now() - t.closedAt < TIP_AFTER_CLOSE_MS
  if (t.status !== 'open' && !(action === 'tip' && justClosed)) return fail(409, 'table closed')

  return guestAction(t, tableId, action, body, persona)
}

function joinGuest(t: TableSession, tableId: string, body: any): MutationResult {
  if (!isKnownTable(tableId)) return fail(404, 'unknown table')

  // Сначала все проверки, только потом открытие сессии: упавший join не должен
  // оставлять ресторану «занятый» стол без единого гостя
  if (body.animal !== undefined && !ANIMALS.has(body.animal)) {
    return fail(400, 'unknown animal', { allowed: [...ANIMALS] })
  }
  const seats = seatsOf(tableId)
  const seated = t.status === 'open' ? t.personas.length : 0
  if (seated >= seats) return fail(400, 'table full', { seats })

  // Молчаливое выбрасывание чужого значения — та же болезнь, что была у /call:
  // гость пишет «молоко», система оставляет пустой список, и оба уверены,
  // что предупреждение сделано. Лучше честная ошибка со списком.
  const rawAllergies: unknown[] = Array.isArray(body.allergies) ? (body.allergies as unknown[]) : []
  const unknownAllergies = rawAllergies.filter(a => typeof a !== 'string' || !ALLERGENS.includes(a))
  if (unknownAllergies.length > 0) {
    return fail(400, 'unknown allergen', { unknown: unknownAllergies.map(String), allowed: ALLERGENS })
  }
  const allergies: string[] = [...new Set(rawAllergies as string[])]

  if (t.status !== 'open') openSessionInPlace(t)

  // Аллергии гостя: только значения из справочника, чужое молча не принимаем
  const name = sanitizeName(body.name) || `Гость ${t.personas.length + 1}`
  const animal = ANIMALS.has(body.animal) ? body.animal : 'fox'

  // Токен показываем один раз, в базе живёт только его хеш
  const guestToken = crypto.randomBytes(18).toString('base64url')
  const persona: Persona = {
    id: crypto.randomUUID(),
    name,
    animal,
    joinedAt: Date.now(),
    allergies,
    secretHash: hashToken(guestToken)
  }
  t.personas.push(persona)
  audit(null, 'сел за стол', tableId, name, null, persona)
  return ok({ personaId: persona.id, guestToken, snapshot: snapshot(t, tableId) })
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

    // Комментарий доезжает до повара как есть. Пустой — значит его нет.
    const comment = sanitizeNote(body.comment ?? body.note)

    // Блюдо с заявленным аллергеном не заказывается «случайно»: система знает,
    // что человеку нельзя, и обязана остановить его, а не промолчать
    const mine = persona.allergies ?? []
    const hits = mine.length > 0 ? allergensOf(dish.id, checked.options ?? {}).filter(a => mine.includes(a)) : []
    if (hits.length > 0 && body.confirmAllergen !== true) {
      return fail(409, 'allergen warning', { allergens: hits, dish: dish.name })
    }

    const line = {
      uid: t.seq++,
      dishId: dish.id,
      qty,
      // Цена фиксируется в момент заказа и уже включает надбавку за модификатор
      price: priceWithOptions(dish.id, checked.options ?? {}),
      options: checked.options ?? {},
      comment,
      shared: !!body.shared,
      sharedWith: [] as string[],
      personaId: persona.id,
      sent: false,
      served: false,
      cancelled: false,
      sentAt: null,
      startedAt: null,
      servedAt: null
    }
    t.lines.push(line)
    audit(null, 'добавил', tableId, `${persona.name}: ${dish.name}${qty > 1 ? ` ×${qty}` : ''}`, round2(line.price * qty), persona)
    return ok({ ok: true, uid: line.uid, line: publicLine(line) })
  }

  if (action === 'remove') {
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line) return fail(404, 'line not found')
    if (line.sent) return fail(409, 'already sent to kitchen')
    if (line.personaId !== persona.id) return fail(403, 'not yours')
    t.lines = t.lines.filter(l => l !== line)
    audit(null, 'убрал', tableId, `${persona.name}: ${dishName(line.dishId)}`, round2(line.price * line.qty), persona)
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
    // Гость с плохой связью жмёт кнопку дважды: заказ уже на кухне, и сказать
    // об этом надо спокойно, а не красной ошибкой на успешном действии
    if (sent === 0) return ok({ ok: true, sent: 0, alreadySent: true })
    audit(null, 'отправил на кухню', tableId, `${persona.name}: ${sent} поз.`, null, persona)
    return ok({ ok: true, sent })
  }

  if (action === 'pay') {
    // Раньше запрос без «за что платим» молча списывал весь личный счёт.
    // Для ключа идемпотентности обязательность была, для суммы — нет.
    if (body.scope === undefined) {
      return fail(400, 'scope required', { allowed: [...PAY_SCOPES, ...Object.keys(PAY_SCOPE_ALIASES)] })
    }
    const wanted = (PAY_SCOPE_ALIASES[String(body.scope)] ?? body.scope) as PayScope
    if (!PAY_SCOPES.includes(wanted)) {
      return fail(400, 'unknown pay scope', { allowed: [...PAY_SCOPES, ...Object.keys(PAY_SCOPE_ALIASES)] })
    }
    const scope: PayScope = wanted
    // С телефона платят только безналом: наличные принимает официант и подтверждает сам
    const method: PayMethod = body.method === 'card' ? 'card' : 'sbp'
    const money = computeTotals(t, priceOf)
    const amount = round2(amountFor(money, persona.id, scope))
    if (amount <= 0) return fail(400, 'nothing to pay')
    // Состав чека фиксируем в момент оплаты: за что именно списаны деньги
    const covered = t.lines.filter(l => {
      if (!isBillLine(l)) return false
      if (scope === 'own') return l.personaId === persona.id || (l.shared && (l.sharedWith ?? []).includes(persona.id))
      return true
    })
    const payment = {
      id: crypto.randomUUID(),
      personaId: persona.id,
      amount,
      scope,
      method,
      at: Date.now(),
      // Номер, который гость может назвать в споре
      receiptNo: `${tableId}-${String(t.payments.length + 1).padStart(3, '0')}-${String(Date.now()).slice(-5)}`,
      lines: covered.map(l => ({
        name: dishName(l.dishId),
        qty: l.qty,
        price: l.price,
        shared: !!l.shared,
        share: l.shared ? round2((l.price * l.qty) / Math.max(1, (l.sharedWith ?? []).length || t.personas.length)) : null
      }))
    }
    t.payments.push(payment)
    audit(null, 'оплата', tableId, `${persona.name} · ${scope} · ${method}`, amount, persona)

    const left = round2(computeTotals(t, priceOf).remaining)
    // Причина вызова исчезла — снимаем его сам, иначе официант идёт с папкой
    // к гостю, который уже расплатился, а красный чип приучает игнорировать зал
    if (left <= 0.01) t.calls = t.calls.filter(c => c.reason !== 'bill')

    return ok({
      ok: true,
      amount,
      remaining: left,
      // Чек: номер, время и состав — то, что гость может сохранить или оспорить
      receipt: {
        no: payment.receiptNo,
        at: payment.at,
        amount,
        scope,
        method,
        guest: persona.name,
        table: tableId,
        lines: payment.lines,
        // При оплате за стол в чеке лежит весь его состав, поэтому строки
        // сами по себе не сходятся со списанным. Показываем, почему.
        tableTotal: round2(money.tableTotal),
        paidBefore: round2(money.paidTotal),
        note: scope === 'full' && money.paidTotal > 0 ? 'оплачен остаток по столу' : null
      }
    })
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
    const tip = {
      id: crypto.randomUUID(),
      personaId: persona.id,
      amount,
      at: Date.now(),
      waiterId: waiter?.id ?? null
    }
    t.tips.push(tip)
    audit(null, 'чаевые', tableId, `${persona.name} → ${waiter?.name ?? 'официанту'}`, amount, persona)
    return ok({
      ok: true,
      amount,
      // Чаевые — тоже списание, и подтверждение по ним гостю тоже нужно
      receipt: {
        no: `${tableId}-tip-${String(Date.now()).slice(-5)}`,
        at: tip.at,
        amount,
        kind: 'tip',
        guest: persona.name,
        table: tableId,
        waiter: waiter?.name ?? null
      }
    })
  }

  if (action === 'cancelMine') {
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line) return fail(404, 'line not found')
    if (line.personaId !== persona.id) return fail(403, 'not yours')
    if (line.cancelled) return fail(409, 'already cancelled')
    if (line.served) return fail(409, 'already served')
    // Кухня уже взялась — отменять поздно, продукт в работе
    if (line.startedAt) return fail(409, 'already cooking')

    line.cancelled = true
    line.cancelledAt = Date.now()
    line.cancelReason = 'гость отменил'
    audit(null, 'гость отменил блюдо', tableId, `${persona.name}: ${dishName(line.dishId)}`, round2(line.price * line.qty), persona)
    return ok()
  }

  if (action === 'cashIntent') {
    // Это ещё не деньги, а просьба принять их. Официант увидит её в зале и подойдёт.
    const wanted = PAY_SCOPE_ALIASES[String(body.scope ?? 'own')] ?? body.scope ?? 'own'
    if (!PAY_SCOPES.includes(wanted as PayScope)) return fail(400, 'unknown pay scope', { allowed: PAY_SCOPES })

    const money = computeTotals(t, priceOf)
    const amount = round2(amountFor(money, persona.id, wanted as PayScope))
    if (amount <= 0) return fail(400, 'nothing to pay')

    t.cashIntent = { personaId: persona.id, scope: wanted, amount, at: Date.now() }
    audit(null, 'просит принять наличные', tableId, `${persona.name} · ${wanted}`, amount, persona)
    return ok({ ok: true, amount, scope: wanted })
  }

  // call
  if (body.reason !== undefined && !CALL_REASONS.has(body.reason)) {
    return fail(400, 'unknown call reason', { allowed: [...CALL_REASONS] })
  }
  const reason = body.reason ?? 'help'
  // Текст вызова — единственный способ гостя сказать «у меня аллергия». Раньше он
  // приходил в reason, не проходил вайтлист и исчезал с ответом ok
  const note = sanitizeNote(body.note ?? body.message)
  if (t.calls.length >= MAX_CALLS) return fail(400, 'too many calls')

  const existing = t.calls.find(c => c.personaId === persona.id && c.reason === reason)
  if (existing) {
    // Повтор — не ошибка и не тишина: гость должен видеть, что его услышали
    if (note && !existing.note) existing.note = note
    return ok({ ok: true, callId: existing.id, at: existing.at, repeated: true })
  }

  const call = { id: crypto.randomUUID(), at: Date.now(), personaId: persona.id, reason, note }
  t.calls.push(call)
  audit(null, 'позвал официанта', tableId, `${persona.name} · ${reason}${note ? `: ${note}` : ''}`, null, persona)
  return ok({ ok: true, callId: call.id, at: call.at, repeated: false })
}

function staffAction(t: TableSession, tableId: string, action: string, body: any, actor: Actor | null): MutationResult {
  if (!actor) return fail(401, 'staff login required')
  if (!can(actor.role, action as Permission)) return fail(403, 'role not allowed')
  // Закреплённые столы — ответственность, а не подсветка: чужой стол трогать нельзя
  // ack — подойти к гостю, а не тронуть его деньги: это можно на любом столе
  if (action !== 'ack' && !ownsTable(actor, tableId)) {
    return fail(403, 'not your table', { waiter: waiterOfTable(tableId)?.name ?? null })
  }

  if (action === 'start' || action === 'ready' || action === 'serve') {
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
      line.startedBy = actor.id
      audit(actor, 'взял в работу', tableId, dishName(line.dishId))
      return ok({ ok: true, startedAt: line.startedAt })
    }

    if (action === 'ready') {
      // Повар закончил: блюдо стоит на раздаче и ждёт официанта
      if (!line.startedAt) return fail(409, 'not started yet')
      line.readyAt = line.readyAt ?? Date.now()
      line.readyBy = actor.id
      audit(actor, 'блюдо готово', tableId, dishName(line.dishId))
      return ok({ ok: true, readyAt: line.readyAt })
    }

    // сначала «в работу», иначе время готовки не собирается вовсе
    if (!line.startedAt) return fail(409, 'not started yet')
    // Официант унёс с раздачи. Если повар не отметил готовность (отдал из рук
    // в руки), фиксируем её этим же моментом — иначе время на раздаче соврёт.
    line.readyAt = line.readyAt ?? Date.now()
    line.served = true
    line.servedAt = Date.now()
    line.servedBy = actor.id
    audit(actor, 'подал', tableId, dishName(line.dishId))
    return ok()
  }

  if (action === 'cash') {
    // Официант физически взял деньги. Только теперь они попадают в счёт —
    // и в отчёт по наличным, который вечером сверяют с ящиком кассы.
    if (t.status !== 'open') return fail(409, 'table closed')
    const money = computeTotals(t, priceOf)

    const personaId = asId(body.personaId)
    const persona = personaId ? t.personas.find(p => p.id === personaId) : null
    if (personaId && !persona) return fail(404, 'guest not found')

    const scope: PayScope =
      (PAY_SCOPE_ALIASES[String(body.scope ?? (persona ? 'own' : 'full'))] as PayScope) ??
      (body.scope as PayScope) ??
      (persona ? 'own' : 'full')
    if (!PAY_SCOPES.includes(scope)) return fail(400, 'unknown pay scope', { allowed: PAY_SCOPES })

    // Сумму считает сервер и клампит остатком: сдача — не повод списать лишнее
    const wanted = body.amount === undefined ? amountFor(money, persona?.id ?? null, scope) : Number(body.amount)
    if (!Number.isFinite(wanted) || wanted <= 0) return fail(400, 'bad amount')
    const amount = round2(Math.min(wanted, money.remaining))
    if (amount <= 0) return fail(400, 'nothing to pay')

    t.payments.push({
      id: crypto.randomUUID(),
      personaId: persona?.id ?? null,
      amount,
      scope,
      method: 'cash',
      takenBy: actor.id,
      takenByName: actor.name,
      at: Date.now(),
      receiptNo: `${tableId}-${String(t.payments.length + 1).padStart(3, '0')}-${String(Date.now()).slice(-5)}`,
      lines: []
    })
    t.cashIntent = null
    audit(actor, 'принял наличные', tableId, persona ? `от ${persona.name}` : 'за стол', amount)

    const left = round2(computeTotals(t, priceOf).remaining)
    if (left <= 0.01) t.calls = t.calls.filter(c => c.reason !== 'bill')
    return ok({ ok: true, amount, remaining: left })
  }

  if (action === 'clean') {
    // Раньше стол становился свободным просто через пять минут — зал считал его
    // готовым, потому что прошло время, а не потому что его кто-то протёр
    if (t.status === 'open') return fail(409, 'table is open')
    // Двое официантов могут нажать «убрано» одновременно — время должно остаться
    // от первого, иначе непонятно, когда стол реально освободился
    if (t.cleanedAt) return ok({ ok: true, cleanedAt: t.cleanedAt, alreadyClean: true })
    t.cleanedAt = Date.now()
    audit(actor, 'убрал стол', tableId, `стол свободен`)
    return ok({ ok: true, cleanedAt: t.cleanedAt })
  }

  if (action === 'dismiss') {
    // Повар подтверждает, что увидел отмену и снял блюдо с плиты
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line || !line.cancelled) return fail(400, 'nothing to dismiss')
    if (line.cancelAck) return fail(400, 'nothing to dismiss')
    line.cancelAck = true
    audit(actor, 'снял отменённое с плиты', tableId, dishName(line.dishId), round2(line.price * line.qty))
    return ok()
  }

  if (action === 'ack') {
    if (t.calls.length === 0) return fail(400, 'no call')
    const callId = asId(body.callId)
    const call = callId ? t.calls.find(c => c.id === callId) : t.calls[0]
    if (!call) return fail(404, 'call not found')
    t.calls = t.calls.filter(c => c !== call)
    audit(actor, 'принял вызов', tableId, t.personas.find(p => p.id === call.personaId)?.name ?? null)
    return ok({ ok: true, left: t.calls.length })
  }

  if (action === 'close' || action === 'reset') {
    const closing = action === 'close'
    // Раньше отвечали ok, и менеджер оставался в уверенности, что закрыл он
    if (closing && t.status !== 'open') return fail(409, 'already closed', { closedAt: t.closedAt ?? null })
    if (t.status === 'open') {
      const money = computeTotals(t, priceOf)
      // Стол с долгом закрывается только осознанно: иначе выручка тихо исчезает.
      // reset подчиняется тому же правилу — иначе это чёрный ход мимо защиты.
      if (money.remaining > 0.01 && body.force !== true) {
        return fail(409, 'unpaid', { remaining: round2(money.remaining) })
      }
      // Гости заплатили и уходят, а на кухне ещё готовится их еда — закрывать
      // такой стол молча нельзя: деньги взяли, блюда не отдали
      const pending = t.lines.filter(l => isBillLine(l) && !l.served)
      if (pending.length > 0 && body.force !== true) {
        return fail(409, 'kitchen pending', {
          pending: pending.length,
          dishes: pending.map(l => dishName(l.dishId))
        })
      }

      // Долг запоминаем до отмены: отменённые позиции выпадают из счёта
      const cancelled = cancelPending(t, closing ? 'стол закрыт' : 'стол сброшен', actor)
      if (cancelled.count > 0) {
        audit(
          actor,
          'списание с кухни',
          tableId,
          `${cancelled.count} поз. снято с приготовления`,
          cancelled.amount
        )
      }

      // Отмена неподанного могла уронить счёт ниже оплаченного — это переплата гостя,
      // её нельзя прятать: по 54-ФЗ нужен возврат
      const after = computeTotals(t, priceOf)

      // Долг снимаем ПОСЛЕ отмены: гость должен за то, что получил, а не за то,
      // что успело уехать на кухню. Раньше сумма бралась до отмены и включала
      // неподанное, а витрина пыталась это компенсировать вычитанием списаний —
      // но там суммировались и позиции, отменённые самим гостём задолго до
      // закрытия, которые в долг не входили никогда.
      t.closedWithDebt = round2(after.remaining)
      const overpaid = round2(Math.max(0, after.paidTotal - after.tableTotal))
      if (overpaid > 0.01) {
        t.overpaid = overpaid
        audit(actor, 'переплата к возврату', tableId, 'за отменённое', overpaid)
      }

      // Журнал называет тот же долг, что чек и итоги смены: раньше сюда шли
      // до-отменочные числа, и одна и та же сумма расходилась на четырёх экранах
      const debt = round2(after.remaining)
      const withDebt = debt > 0.01
      audit(
        actor,
        withDebt ? `${closing ? 'закрыл' : 'сбросил'} стол с долгом` : `${closing ? 'закрыл' : 'сбросил'} стол`,
        tableId,
        `оплачено ${round2(after.paidTotal)} ₽${withDebt ? `, долг ${debt} ₽` : ''}`,
        withDebt ? debt : round2(after.paidTotal)
      )
    }

    t.status = 'closed'
    t.closedAt = Date.now()
    // Сброс освобождает стол сразу, но чистит данные хранилище — после того,
    // как зафиксирует чек смены: иначе состав закрытой сессии теряется.
    if (!closing) t.resetRequested = true
    return ok()
  }

  return fail(404, 'unknown action')
}

/** Общая обвязка экранов персонала: GET-снапшот и SSE на одном payload. */
async function staffFeed(
  req: any,
  res: any,
  url: URL,
  payloadFn: () => Promise<unknown>,
  subscribers: Set<any>,
  permission: Permission
) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method' })
  const actor = actorFrom(req, url)
  if (!actor) return json(res, 401, staffUnauthorized(req))
  if (!allowed(actor, permission)) return json(res, 403, { error: 'role not allowed' })
  if (!url.pathname.endsWith('/stream')) return json(res, 200, await payloadFn())

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  })
  res.write(`data: ${JSON.stringify(await payloadFn())}\n\n`)
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
  const store = await getStore()

  if (url.pathname === '/api/staff/login') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' })
    const ip = req.socket.remoteAddress ?? 'unknown'
    // Устройство важнее адреса: в ресторане вся смена за одним роутером,
    // и промахи одного планшета не должны запирать вход остальным
    const device = asId(req.headers['x-device-id'])
    if (!loginAllowed(ip, device)) {
      const wait = lockoutSeconds(ip, device)
      return json(res, 429, {
        error: 'too many attempts',
        retryAfterSec: wait,
        hint: `слишком много попыток — попробуйте через ${Math.max(1, Math.ceil(wait / 60))} мин`
      })
    }
    const body = await readBody(req).catch(() => null)
    if (body === null) return json(res, 400, { error: 'bad json' })
    const result = loginByPin(body.pin, ip, device ?? body.device)
    if (!result) return json(res, 401, { error: 'wrong pin' })
    audit({ ...result.staff, sessionId: result.sessionId }, 'вошёл в смену', null, result.device ?? null)
    await flushAudit(store)
    return json(res, 200, { token: result.token, staff: result.staff })
  }

  if (url.pathname === '/api/staff/me' || url.pathname === '/api/manager/check') {
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, staffUnauthorized(req))
    const shift = await store.shift()
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
    if (!actor) return json(res, 401, staffUnauthorized(req))
    if (!allowed(actor, 'log')) return json(res, 403, { error: 'role not allowed' })
    return json(res, 200, { entries: await store.auditEntries(150) })
  }

  // Реестр чеков смены — то, чем сводят кассу
  if (url.pathname === '/api/shift/checks') {
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, staffUnauthorized(req))
    if (!allowed(actor, 'log')) return json(res, 403, { error: 'role not allowed' })
    const shift = await store.shift()
    const checks = await store.shiftChecks(100)
    return json(res, 200, {
      shift: {
        startedAt: shift.startedAt,
        revenue: round2(shift.revenue),
        closedRevenue: round2(shift.closedRevenue),
        debt: round2(shift.debt),
        overpaid: round2(shift.overpaid),
        // Заработанное ≠ принятое: переплату придётся вернуть, поэтому в
        // выручке ей не место. Без этой строки владельцу нечего показать.
        netRevenue: round2(shift.closedRevenue - shift.overpaid),
        // Снятое с кухни: еда не отдана, это потеря продукта, а не долг гостя
        writtenOff: round2(shift.writtenOff ?? 0),
        tables: shift.tables,
        guests: shift.guestsSeen
      },
      checks,
      // Сверка: сумма чеков обязана совпасть с выручкой смены
      // Сверка кассы: сумма чеков закрытых столов обязана совпасть с их выручкой.
      // Деньги на ещё открытых столах в реестр не входят и показаны отдельно.
      control: {
        checksPaid: round2(checks.reduce((s, c) => s + c.paid, 0)),
        closedRevenue: round2(shift.closedRevenue),
        openPaid: round2(shift.revenue - shift.closedRevenue),
        // Сверка ловила одно поле из четырёх и при этом рапортовала «сходится» —
        // расхождение по долгу проходило мимо. Теперь сверяем всё, чем отчитываемся.
        checksDebt: round2(checks.reduce((s, c) => s + c.debt, 0)),
        shiftDebt: round2(shift.debt),
        checksOverpaid: round2(checks.reduce((s, c) => s + c.overpaid, 0)),
        shiftOverpaid: round2(shift.overpaid),
        checksWrittenOff: round2(checks.reduce((s, c) => s + c.cancelledTotal, 0)),
        shiftWrittenOff: round2(shift.writtenOff ?? 0),
        debtMatches: Math.abs(round2(checks.reduce((s, c) => s + c.debt, 0)) - round2(shift.debt)) < 0.01,
        overpaidMatches:
          Math.abs(round2(checks.reduce((s, c) => s + c.overpaid, 0)) - round2(shift.overpaid)) < 0.01,
        matches: Math.abs(round2(checks.reduce((s, c) => s + c.paid, 0)) - round2(shift.closedRevenue)) < 0.01
      }
    })
  }

  if (url.pathname === '/api/menu' && req.method === 'GET') {
    return json(res, 200, menuPayload())
  }

  if (url.pathname === '/api/hall' || url.pathname === '/api/hall/stream') {
    return staffFeed(req, res, url, async () => hallPayload(await store.activeSessions(), await store.shift()), hallStreams, 'hall')
  }
  if (url.pathname === '/api/kitchen' || url.pathname === '/api/kitchen/stream') {
    return staffFeed(req, res, url, async () => kitchenPayload(await store.activeSessions()), kitchenStreams, 'kitchen')
  }

  // /api/t/:table[/action]
  const parts = url.pathname.split('/').filter(Boolean)
  const tableId = String(parts[2] ?? '')
  if (parts[1] !== 't' || !TABLE_RE.test(tableId)) return json(res, 404, { error: 'not found' })
  const action = parts[3] ?? ''

  if (!isKnownTable(tableId)) return json(res, 404, { error: 'unknown table' })


  if (req.method === 'GET' && action === '') {
    const t = await store.read(tableId)
    const token = req.headers['x-guest-token'] ?? url.searchParams.get('g')
    // Роль решает и здесь: повару нужна очередь кухни, а не имена, аллергии
    // и счета гостей всего зала
    const staff = actorFrom(req, url)
    const maySeeAll = !!guestOf(t, token) || allowed(staff, 'table')
    return json(res, 200, maySeeAll ? snapshot(t, tableId) : publicStub(t, tableId))
  }

  if (req.method === 'GET' && action === 'stream') {
    const t = await store.read(tableId)
    const token = req.headers['x-guest-token'] ?? url.searchParams.get('g')
    // Свой видит стол целиком, посторонний — только занят он или нет.
    // Рвать подписку нельзя: гость подключается ещё до того, как представился.
    const full = !!guestOf(t, token) || allowed(actorFrom(req, url), 'table')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    const view = (session: TableSession) => (full ? snapshot(session, tableId) : publicStub(session, tableId))
    res.write(`data: ${JSON.stringify(view(await store.read(tableId)))}\n\n`)
    if (!streams.has(tableId)) streams.set(tableId, new Set())
    const subs = streams.get(tableId)!
    // Помечаем подписку: рассылка выберет по ней, что этому клиенту можно видеть
    ;(res as any).epFullView = full
    if (subs.size >= MAX_STREAMS_PER_TABLE) {
      res.end()
      return
    }
    subs.add(res)
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

  const actor = actorFrom(req)
  const out = await store.withTable(tableId, session => mutate(session, tableId, action, body, actor, req))
  await flushAudit(store)
  if (cacheKey && out.status === 200) idemRemember(cacheKey, out.status, out.body)
  if (out.status === 200) await broadcast(store, tableId)
  return json(res, out.status, out.body)
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
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
  const store = await getStore()
  createServer().listen(PORT, () => {
    console.log(`EasyPay API on :${PORT} · хранилище: ${store.kind}`)
    console.log(
      process.env.EASYPAY_MANAGER_TOKEN
        ? 'Manager token: из EASYPAY_MANAGER_TOKEN'
        : `Manager token (сгенерирован): ${MANAGER_TOKEN}`
    )
  })
}
