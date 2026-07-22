// EasyPay demo backend: in-memory table state + SSE live sync.
// Демо-сервер без БД: перезапуск = чистые столы. Отдаёт и статику dist.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = process.env.PORT || 8787

// --- Меню (единый источник цен с клиентом) ---
const MENU = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'menu.json'), 'utf8'))
const DISHES = new Map()
for (const cat of Object.keys(MENU)) for (const d of MENU[cat]) DISHES.set(d.id, d)

// --- Состояние столов ---
/** @type {Map<string, {personas:any[], lines:any[], payments:any[], seq:number}>} */
const tables = new Map()
/** @type {Map<string, Set<import('node:http').ServerResponse>>} */
const streams = new Map()

function emptySession(status = 'closed') {
  return {
    sessionId: null,
    status, // 'open' | 'closed'
    openedAt: null,
    closedAt: null,
    personas: [],
    lines: [],
    payments: [],
    seq: 1
  }
}

const MAX_TABLES = 500
const MAX_STREAMS_PER_TABLE = 50

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

// Периодическая уборка: закрытые столы старше 2 часов забываем
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  for (const [id, t] of tables) {
    if (t.status === 'closed' && (t.closedAt ?? 0) < cutoff) {
      tables.delete(id)
      streams.delete(id)
    }
  }
}, 10 * 60 * 1000).unref()

function openSession(id) {
  const t = getTable(id)
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
    personas: t.personas,
    lines: t.lines,
    payments: t.payments
  }
}

function broadcast(id) {
  const subs = streams.get(id)
  if (!subs) return
  const data = `data: ${JSON.stringify(snapshot(id))}\n\n`
  for (const res of subs) {
    try {
      res.write(data)
    } catch {
      subs.delete(res)
    }
  }
}

// --- Расчёты (сервер — источник истины по суммам) ---
function totals(t) {
  const participants = Math.max(1, t.personas.length)
  const price = l => (DISHES.get(l.dishId)?.price ?? 0) * l.qty
  const sharedTotal = t.lines.filter(l => l.shared).reduce((s, l) => s + price(l), 0)
  const own = pid => t.lines.filter(l => !l.shared && l.personaId === pid).reduce((s, l) => s + price(l), 0)
  const ownAll = t.lines.filter(l => !l.shared).reduce((s, l) => s + price(l), 0)
  const share = sharedTotal / participants
  const tableTotal = ownAll + sharedTotal
  const paidTotal = t.payments.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.max(0, tableTotal - paidTotal)
  const personaPaid = pid => t.payments.filter(p => p.personaId === pid).reduce((s, p) => s + p.amount, 0)
  return { participants, sharedTotal, own, share, tableTotal, paidTotal, remaining, personaPaid }
}

function payAmount(t, personaId, scope) {
  const T = totals(t)
  if (scope === 'full') return T.remaining
  if (scope === 'equal') return Math.min(T.remaining, T.tableTotal / T.participants)
  // own: своё + доля общего, минус уже оплаченное этой персоной, не больше остатка стола
  const mine = T.own(personaId) + T.share
  return Math.max(0, Math.min(mine - T.personaPaid(personaId), T.remaining))
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
  return raw ? JSON.parse(raw) : {}
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

// --- Валидация ---
const NAME_MAX = 30
const ANIMALS = new Set(['fox', 'bear', 'panda', 'raccoon', 'owl', 'cat'])

function sanitizeName(name) {
  return String(name ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, NAME_MAX)
}

// --- Роутер API ---
async function handleApi(req, res, url) {
  // /api/t/:table[/action[/param]]
  const parts = url.pathname.split('/').filter(Boolean) // ['api','t','12','lines',...]
  const tableId = String(parts[2] ?? '').slice(0, 24)
  if (parts[1] !== 't' || !tableId) return json(res, 404, { error: 'not found' })
  const action = parts[3] ?? ''
  const t = getTable(tableId, req.method === 'POST')

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

  if (action === 'join') {
    // Закрытый стол: первый гость открывает НОВУЮ сессию с чистого листа
    const table = t.status === 'open' ? t : openSession(tableId)
    const name = sanitizeName(body.name) || `Гость ${table.personas.length + 1}`
    const animal = ANIMALS.has(body.animal) ? body.animal : 'fox'
    if (table.personas.length >= 12) return json(res, 400, { error: 'table full' })
    const persona = { id: crypto.randomUUID(), name, animal, joinedAt: Date.now() }
    table.personas.push(persona)
    broadcast(tableId)
    return json(res, 200, { personaId: persona.id, snapshot: snapshot(tableId) })
  }

  if (action === 'serve') {
    // Официант отмечает блюдо поданным (менеджерское действие, без persona)
    const line = t.lines.find(l => l.uid === Number(body.uid))
    if (!line || !line.sent) return json(res, 400, { error: 'not sent yet' })
    line.served = true
    broadcast(tableId)
    return json(res, 200, { ok: true })
  }

  if (action === 'close') {
    // Менеджер закрывает стол: сессия замораживается, следующий join откроет новую
    t.status = 'closed'
    t.closedAt = Date.now()
    broadcast(tableId)
    return json(res, 200, { ok: true })
  }

  const persona = t.personas.find(p => p.id === body.personaId)
  if (action !== 'reset' && !persona) return json(res, 403, { error: 'unknown persona' })
  if (t.status !== 'open' && !['reset'].includes(action)) return json(res, 409, { error: 'table closed' })

  if (action === 'lines') {
    const dish = DISHES.get(body.dishId)
    if (!dish || dish.stop) return json(res, 400, { error: 'bad dish' })
    const qty = Math.min(9, Math.max(1, Number(body.qty) || 1))
    if (t.lines.length >= 200) return json(res, 400, { error: 'too many lines' })
    t.lines.push({
      uid: t.seq++,
      dishId: dish.id,
      qty,
      shared: !!body.shared,
      personaId: persona.id,
      sent: false,
      served: false
    })
    broadcast(tableId)
    return json(res, 200, { ok: true })
  }

  if (action === 'remove') {
    const line = t.lines.find(l => l.uid === Number(body.uid))
    if (!line || line.sent) return json(res, 400, { error: 'locked or missing' })
    if (line.personaId !== persona.id) return json(res, 403, { error: 'not yours' })
    t.lines = t.lines.filter(l => l !== line)
    broadcast(tableId)
    return json(res, 200, { ok: true })
  }

  if (action === 'send') {
    const scope = body.scope === 'all' ? 'all' : 'mine'
    t.lines = t.lines.map(l => {
      const mineUnsent = !l.sent && l.personaId === persona.id
      const anyUnsent = !l.sent
      return (scope === 'all' ? anyUnsent : mineUnsent) ? { ...l, sent: true } : l
    })
    broadcast(tableId)
    return json(res, 200, { ok: true })
  }

  if (action === 'pay') {
    const scope = ['own', 'equal', 'full'].includes(body.scope) ? body.scope : 'own'
    const amount = Math.round(payAmount(t, persona.id, scope) * 100) / 100
    if (amount <= 0) return json(res, 400, { error: 'nothing to pay' })
    t.payments.push({ personaId: persona.id, amount, scope, at: Date.now() })
    broadcast(tableId)
    return json(res, 200, { ok: true, amount })
  }

  if (action === 'reset') {
    tables.set(tableId, emptySession())
    broadcast(tableId)
    return json(res, 200, { ok: true })
  }

  return json(res, 404, { error: 'unknown action' })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    return await serveStatic(req, res, url.pathname)
  } catch (err) {
    console.error('request failed:', err)
    return json(res, 500, { error: 'internal' })
  }
})

server.listen(PORT, () => console.log(`EasyPay demo server on :${PORT}`))
