// EasyPay demo backend: in-memory table state + SSE live sync.
// Демо-сервер без БД: перезапуск = чистые столы. Отдаёт и статику dist.
// Зависимостей нет намеренно: на VPS уезжает только dist + server + shared, без node_modules.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { amountFor, computeTotals, PAY_SCOPES, round2 } from '../shared/money.js'
import { summarizeHall } from '../shared/hall.js'
import { sortTickets, summarizeKitchen } from '../shared/kitchen.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = process.env.PORT || 8787

// --- Меню (единый источник цен с клиентом) ---
const MENU = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'menu.json'), 'utf8'))
const DISHES = new Map()
for (const cat of Object.keys(MENU)) for (const d of MENU[cat]) DISHES.set(d.id, d)
const priceOf = id => DISHES.get(id)?.price ?? 0

// --- План зала (столы, зоны, посадка) ---
const HALL = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'hall.json'), 'utf8'))
/** @type {Map<string, {zoneId:string, zoneName:string, seats:number}>} */
const TABLE_META = new Map()
for (const zone of HALL.zones) {
  for (const t of zone.tables) TABLE_META.set(String(t.id), { zoneId: zone.id, zoneName: zone.name, seats: t.seats })
}

// Итоги смены: копятся при закрытии столов, обнуляются с рестартом (демо без БД)
const shift = { tables: 0, revenue: 0, guests: 0, startedAt: Date.now() }

// --- Токен менеджера: закрывает serve/close/reset от посторонних ---
// Без переменной окружения генерируем случайный и печатаем в лог при старте.
export const MANAGER_TOKEN = process.env.EASYPAY_MANAGER_TOKEN || crypto.randomBytes(9).toString('base64url')

function tokenMatches(token) {
  const given = Buffer.from(String(token ?? ''))
  const want = Buffer.from(MANAGER_TOKEN)
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

// EventSource не умеет слать заголовки, поэтому для SSE зала токен принимаем и из query.
function managerOk(req, url) {
  return tokenMatches(req.headers['x-manager-token']) || (url ? tokenMatches(url.searchParams.get('token')) : false)
}

// --- Состояние столов ---
/** @type {Map<string, {sessionId:string|null, status:string, openedAt:number|null, closedAt:number|null, personas:any[], lines:any[], payments:any[], seq:number}>} */
const tables = new Map()
/** @type {Map<string, Set<import('node:http').ServerResponse>>} */
const streams = new Map()
/** @type {Set<import('node:http').ServerResponse>} */
const hallStreams = new Set()
/** @type {Set<import('node:http').ServerResponse>} */
const kitchenStreams = new Set()
// Идемпотентность: ключ клиента -> уже отданный ответ. Ретрай платежа не создаёт второй платёж.
/** @type {Map<string, {at:number, status:number, body:object}>} */
const idempotency = new Map()

const MAX_TABLES = 500
const MAX_STREAMS_PER_TABLE = 50
const MAX_STAFF_STREAMS = 20
const MAX_IDEM = 2000
const IDEM_TTL = 10 * 60 * 1000

function emptySession(status = 'closed') {
  return {
    sessionId: null,
    status, // 'open' | 'closed'
    openedAt: null,
    closedAt: null,
    personas: [],
    lines: [],
    payments: [],
    tips: [],
    call: null, // активный вызов официанта: {at, personaId, reason}
    seq: 1
  }
}

function getTable(id, create = false) {
  if (!tables.has(id)) {
    if (!create) return emptySession() // эфемерный ответ для read-only проб, не храним
    if (tables.size >= MAX_TABLES) {
      // Выдавливаем самый старый закрытый стол
      const victim = [...tables.entries()].find(([, t]) => t.status === 'closed')
      if (victim) tables.delete(victim[0])
      else throw new Error('table limit')
    }
    tables.set(id, emptySession())
  }
  return tables.get(id)
}

// Периодическая уборка: закрытые столы старше 2 часов и протухшие ключи идемпотентности
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
}, 10 * 60 * 1000)
sweeper.unref()

function idemRemember(key, status, body) {
  if (idempotency.size >= MAX_IDEM) idempotency.delete(idempotency.keys().next().value)
  idempotency.set(key, { at: Date.now(), status, body })
}

function openSession(id) {
  const fresh = emptySession('open')
  fresh.sessionId = crypto.randomUUID()
  fresh.openedAt = Date.now()
  tables.set(id, fresh)
  return fresh
}

function snapshot(id) {
  const t = getTable(id, false)
  return {
    tableId: id,
    sessionId: t.sessionId,
    status: t.status,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    personas: t.personas,
    lines: t.lines,
    payments: t.payments,
    tips: t.tips,
    call: t.call
  }
}

function broadcast(id) {
  const subs = streams.get(id)
  if (subs) {
    const data = `data: ${JSON.stringify(snapshot(id))}\n\n`
    for (const res of subs) {
      try {
        res.write(data)
      } catch {
        subs.delete(res)
      }
    }
  }
  // любая мутация стола меняет картину зала и очередь кухни
  broadcastHall()
  broadcastKitchen()
}

// --- Зал ---
/** Компактная карточка стола: из неё shared/hall.js считает статус, таймеры и алерты. */
function hallCard(id, meta) {
  const t = getTable(id, false)
  const money = computeTotals(t, priceOf)
  const pending = t.lines.filter(l => l.sent && !l.served)
  const sentAts = t.lines.filter(l => l.sentAt).map(l => l.sentAt)
  const servedAts = t.lines.filter(l => l.servedAt).map(l => l.servedAt)
  const payAts = t.payments.map(p => p.at)

  return {
    id,
    zoneId: meta?.zoneId ?? 'other',
    zoneName: meta?.zoneName ?? 'Вне плана',
    seats: meta?.seats ?? 0,
    status: t.status,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    guests: t.personas.length,
    personas: t.personas.map(p => ({ name: p.name, animal: p.animal })),
    tableTotal: round2(money.tableTotal),
    paidTotal: round2(money.paidTotal),
    remaining: round2(money.remaining),
    sentCount: t.lines.filter(l => l.sent).length,
    kitchenPending: pending.length,
    oldestPendingSentAt: pending.length ? Math.min(...pending.map(l => l.sentAt ?? 0)) : null,
    lastSentAt: sentAts.length ? Math.max(...sentAts) : null,
    lastServedAt: servedAts.length ? Math.max(...servedAts) : null,
    lastPaidAt: payAts.length ? Math.max(...payAts) : null,
    tipsTotal: round2(t.tips.reduce((s, x) => s + x.amount, 0)),
    call: t.call
      ? {
          at: t.call.at,
          reason: t.call.reason,
          name: t.personas.find(p => p.id === t.call.personaId)?.name ?? 'Гость'
        }
      : null
  }
}

function hallPayload() {
  const now = Date.now()
  const cards = [...TABLE_META].map(([id, meta]) => hallCard(id, meta))
  // Столы, которых нет в плане зала (гость открыл произвольный ?t=): показываем отдельно
  for (const [id, t] of tables) {
    if (!TABLE_META.has(id) && t.status === 'open') cards.push(hallCard(id, null))
  }
  return {
    restaurant: HALL.restaurant,
    zones: HALL.zones.map(z => ({ id: z.id, name: z.name })),
    tables: cards,
    shift: { tables: shift.tables, revenue: round2(shift.revenue), guests: shift.guests, startedAt: shift.startedAt },
    summary: summarizeHall(cards, shift, now),
    now
  }
}

function pushTo(subscribers, payload) {
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

function broadcastHall() {
  if (hallStreams.size > 0) pushTo(hallStreams, hallPayload())
}

// --- Кухня ---
/** Тикет = отправленная, но ещё не поданная позиция. Кухня видит весь ресторан сразу. */
function kitchenPayload() {
  const now = Date.now()
  const tickets = []
  for (const [id, t] of tables) {
    if (t.status !== 'open') continue
    const meta = TABLE_META.get(id)
    for (const l of t.lines) {
      if (!l.sent || l.served) continue
      const persona = t.personas.find(p => p.id === l.personaId)
      tickets.push({
        tableId: id,
        zoneName: meta?.zoneName ?? 'Вне плана',
        uid: l.uid,
        dishId: l.dishId,
        qty: l.qty,
        options: l.options ?? {},
        shared: !!l.shared,
        guest: persona?.name ?? 'Гость',
        animal: persona?.animal ?? 'fox',
        sentAt: l.sentAt,
        startedAt: l.startedAt ?? null
      })
    }
  }
  const sorted = sortTickets(tickets)
  return { tickets: sorted, summary: summarizeKitchen(sorted, now), now }
}

function broadcastKitchen() {
  if (kitchenStreams.size > 0) pushTo(kitchenStreams, kitchenPayload())
}

// --- HTTP helpers ---
function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readBody(req) {
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

const MIME = {
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

async function serveStatic(req, res, pathname) {
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
  if (!existsSync(filePath)) filePath = path.join(DIST, 'index.html') // SPA fallback
  try {
    const data = await readFile(filePath)
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

// --- Валидация входа (руками: зависимостей на сервере нет) ---
const NAME_MAX = 30
const ANIMALS = new Set(['fox', 'bear', 'panda', 'raccoon', 'owl', 'cat'])
const TABLE_RE = /^[A-Za-z0-9_-]{1,24}$/
const MANAGER_ACTIONS = new Set(['serve', 'start', 'close', 'reset', 'ack'])
const IDEMPOTENT_ACTIONS = new Set(['join', 'lines', 'pay', 'tip'])

function sanitizeName(name) {
  return String(name ?? '')
    .replace(/[<>]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, NAME_MAX)
}

function asId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null
}

function asUid(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Модификаторы блюда (острота, прожарка): принимаем только значения из меню. */
function sanitizeOptions(dish, raw) {
  const spec = dish.options ?? []
  if (spec.length === 0) return {}
  const out = {}
  for (const opt of spec) {
    const given = raw && typeof raw === 'object' ? raw[opt.id] : null
    out[opt.id] = opt.choices.includes(given) ? given : opt.default ?? opt.choices[0]
  }
  return out
}

const CALL_REASONS = new Set(['help', 'bill', 'water'])

// --- Мутации (POST): возвращают {status, body}, чтобы ответ можно было закэшировать по idemKey ---
function mutate(tableId, action, body, isManager) {
  const t = getTable(tableId, true)

  if (MANAGER_ACTIONS.has(action)) {
    if (!isManager) return { status: 401, body: { error: 'manager token required' } }

    if (action === 'start') {
      // Кухня взяла позицию в работу
      const uid = asUid(body.uid)
      const line = uid === null ? null : t.lines.find(l => l.uid === uid)
      if (!line || !line.sent || line.served) return { status: 400, body: { error: 'not in queue' } }
      line.startedAt = line.startedAt ?? Date.now()
      broadcast(tableId)
      return { status: 200, body: { ok: true, startedAt: line.startedAt } }
    }

    if (action === 'serve') {
      const uid = asUid(body.uid)
      const line = uid === null ? null : t.lines.find(l => l.uid === uid)
      if (!line || !line.sent) return { status: 400, body: { error: 'not sent yet' } }
      line.served = true
      line.servedAt = Date.now()
      broadcast(tableId)
      return { status: 200, body: { ok: true } }
    }

    if (action === 'ack') {
      // Персонал принял вызов гостя
      t.call = null
      broadcast(tableId)
      return { status: 200, body: { ok: true } }
    }

    if (action === 'close') {
      // Менеджер закрывает стол: сессия замораживается, следующий join откроет новую
      if (t.status === 'open') {
        // Итоги смены: закрытый стол уходит в статистику зала
        const money = computeTotals(t, priceOf)
        shift.tables += 1
        shift.revenue += money.paidTotal
        shift.guests += t.personas.length
      }
      t.status = 'closed'
      t.closedAt = Date.now()
      broadcast(tableId)
      return { status: 200, body: { ok: true } }
    }

    // reset — сброс демо-стола к чистому листу
    tables.set(tableId, emptySession())
    broadcast(tableId)
    return { status: 200, body: { ok: true } }
  }

  if (action === 'join') {
    // Закрытый стол: первый гость открывает НОВУЮ сессию с чистого листа
    const table = t.status === 'open' ? t : openSession(tableId)
    if (table.personas.length >= 12) return { status: 400, body: { error: 'table full' } }
    const name = sanitizeName(body.name) || `Гость ${table.personas.length + 1}`
    const animal = ANIMALS.has(body.animal) ? body.animal : 'fox'
    const persona = { id: crypto.randomUUID(), name, animal, joinedAt: Date.now() }
    table.personas.push(persona)
    broadcast(tableId)
    return { status: 200, body: { personaId: persona.id, snapshot: snapshot(tableId) } }
  }

  const personaId = asId(body.personaId)
  const persona = personaId === null ? null : t.personas.find(p => p.id === personaId)
  if (!persona) return { status: 403, body: { error: 'unknown persona' } }
  if (t.status !== 'open') return { status: 409, body: { error: 'table closed' } }

  if (action === 'lines') {
    const dish = DISHES.get(asId(body.dishId))
    if (!dish || dish.stop) return { status: 400, body: { error: 'bad dish' } }
    const rawQty = Number(body.qty)
    const qty = Number.isFinite(rawQty) ? Math.min(9, Math.max(1, Math.floor(rawQty))) : 1
    if (t.lines.length >= 200) return { status: 400, body: { error: 'too many lines' } }
    t.lines.push({
      uid: t.seq++,
      dishId: dish.id,
      qty,
      options: sanitizeOptions(dish, body.options),
      shared: !!body.shared,
      personaId: persona.id,
      sent: false,
      served: false,
      sentAt: null,
      startedAt: null, // кухня взяла в работу
      servedAt: null
    })
    broadcast(tableId)
    return { status: 200, body: { ok: true } }
  }

  if (action === 'remove') {
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line || line.sent) return { status: 400, body: { error: 'locked or missing' } }
    if (line.personaId !== persona.id) return { status: 403, body: { error: 'not yours' } }
    t.lines = t.lines.filter(l => l !== line)
    broadcast(tableId)
    return { status: 200, body: { ok: true } }
  }

  if (action === 'send') {
    const scope = body.scope === 'all' ? 'all' : 'mine'
    const now = Date.now()
    t.lines = t.lines.map(l => {
      const mineUnsent = !l.sent && l.personaId === persona.id
      const anyUnsent = !l.sent
      return (scope === 'all' ? anyUnsent : mineUnsent) ? { ...l, sent: true, sentAt: now } : l
    })
    broadcast(tableId)
    return { status: 200, body: { ok: true } }
  }

  if (action === 'pay') {
    const scope = PAY_SCOPES.includes(body.scope) ? body.scope : 'own'
    // Сумму считает сервер: клиентским числам не доверяем
    const amount = round2(amountFor(computeTotals(t, priceOf), persona.id, scope))
    if (amount <= 0) return { status: 400, body: { error: 'nothing to pay' } }
    t.payments.push({ personaId: persona.id, amount, scope, at: Date.now() })
    broadcast(tableId)
    return { status: 200, body: { ok: true, amount } }
  }

  if (action === 'tip') {
    // Чаевые не входят в счёт стола: идут официанту отдельной строкой
    const raw = Number(body.amount)
    const amount = Number.isFinite(raw) ? round2(Math.min(100_000, Math.max(0, raw))) : 0
    if (amount <= 0) return { status: 400, body: { error: 'bad amount' } }
    t.tips.push({ personaId: persona.id, amount, at: Date.now() })
    broadcast(tableId)
    return { status: 200, body: { ok: true, amount } }
  }

  if (action === 'call') {
    // Вызов официанта: горит в зале и на экране стола, пока персонал не примет
    const reason = CALL_REASONS.has(body.reason) ? body.reason : 'help'
    t.call = { at: Date.now(), personaId: persona.id, reason }
    broadcast(tableId)
    return { status: 200, body: { ok: true } }
  }

  return { status: 404, body: { error: 'unknown action' } }
}

/** Общая обвязка экранов персонала: GET-снапшот и SSE на одном payload. */
function staffFeed(req, res, url, payloadFn, subscribers) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method' })
  if (!managerOk(req, url)) return json(res, 401, { error: 'manager token required' })
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
async function handleApi(req, res, url) {
  if (url.pathname === '/api/manager/check') {
    return managerOk(req) ? json(res, 200, { ok: true }) : json(res, 401, { error: 'manager token required' })
  }

  // Экраны персонала: зал и кухня. Снапшот или SSE — только с токеном
  if (url.pathname === '/api/hall' || url.pathname === '/api/hall/stream') {
    return staffFeed(req, res, url, hallPayload, hallStreams)
  }
  if (url.pathname === '/api/kitchen' || url.pathname === '/api/kitchen/stream') {
    return staffFeed(req, res, url, kitchenPayload, kitchenStreams)
  }

  // /api/t/:table[/action]
  const parts = url.pathname.split('/').filter(Boolean) // ['api','t','12','lines',...]
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
    const subs = streams.get(tableId)
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

  // Идемпотентность: тот же ключ = тот же ответ, повторного действия не происходит
  const idemKey = IDEMPOTENT_ACTIONS.has(action) ? asId(body.idemKey) : null
  const cacheKey = idemKey && `${tableId}:${action}:${idemKey}`
  if (cacheKey) {
    const hit = idempotency.get(cacheKey)
    if (hit) return json(res, hit.status, hit.body)
  }

  const out = mutate(tableId, action, body, managerOk(req))
  if (cacheKey && out.status === 200) idemRemember(cacheKey, out.status, out.body)
  return json(res, out.status, out.body)
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
      return await serveStatic(req, res, url.pathname)
    } catch (err) {
      console.error('request failed:', err)
      return json(res, 500, { error: 'internal' })
    }
  })
}

// Запуск только при прямом вызове — тесты импортируют createServer() и слушают свой порт
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
