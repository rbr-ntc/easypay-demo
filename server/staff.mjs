// Персонал смены: вход по PIN, сессии, закрепление столов за официантами.
// Демо-хранилище: список в src/staff.json, сессии в памяти. В проде это БД,
// хеши PIN-кодов и общий SSO — здесь важна форма, а не хранилище.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAW = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'staff.json'), 'utf8'))

// PIN-коды из файла можно перекрыть переменной: EASYPAY_STAFF_PINS="max=4821,boss=7390"
const PIN_OVERRIDES = new Map(
  String(process.env.EASYPAY_STAFF_PINS ?? '')
    .split(',')
    .map(pair => pair.split('=').map(s => s.trim()))
    .filter(([id, pin]) => id && pin)
)

const STAFF = RAW.staff.map(s => ({
  id: String(s.id),
  name: String(s.name),
  role: String(s.role),
  tables: (s.tables ?? []).map(String),
  pin: String(PIN_OVERRIDES.get(String(s.id)) ?? s.pin)
}))

/** Публичная карточка сотрудника: без PIN-кода. */
function publicStaff(s) {
  return { id: s.id, name: s.name, role: s.role, tables: s.tables }
}

export function staffRoster() {
  return STAFF.map(publicStaff)
}

export function waiterOfTable(tableId) {
  const found = STAFF.find(s => s.role === 'waiter' && s.tables.includes(String(tableId)))
  return found ? { id: found.id, name: found.name } : null
}

// --- Сессии ---
const SESSION_TTL = 12 * 60 * 60 * 1000 // смена
/** @type {Map<string, {staff: object, expiresAt: number}>} */
const sessions = new Map()

export function createSession(staff) {
  const token = crypto.randomBytes(18).toString('base64url')
  sessions.set(token, { staff: publicStaff(staff), expiresAt: Date.now() + SESSION_TTL })
  return token
}

export function sessionStaff(token) {
  const found = sessions.get(String(token ?? ''))
  if (!found) return null
  if (found.expiresAt < Date.now()) {
    sessions.delete(String(token))
    return null
  }
  return found.staff
}

export function dropSession(token) {
  sessions.delete(String(token ?? ''))
}

export function sweepSessions() {
  const now = Date.now()
  for (const [token, s] of sessions) if (s.expiresAt < now) sessions.delete(token)
}

// --- Вход по PIN ---
const MAX_ATTEMPTS = 6
const ATTEMPT_WINDOW = 5 * 60 * 1000
/** @type {Map<string, {count: number, until: number}>} */
const attempts = new Map()

export function loginAllowed(ip) {
  const rec = attempts.get(ip)
  if (!rec) return true
  if (rec.until < Date.now()) {
    attempts.delete(ip)
    return true
  }
  return rec.count < MAX_ATTEMPTS
}

function noteFailure(ip) {
  const rec = attempts.get(ip)
  if (!rec || rec.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + ATTEMPT_WINDOW })
  else rec.count += 1
}

/** Сравнение PIN без утечки времени: одинаковая длина обязательна. */
function pinMatches(given, want) {
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(want))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function loginByPin(pin, ip) {
  const clean = String(pin ?? '').trim()
  if (!/^\d{4,8}$/.test(clean)) {
    noteFailure(ip)
    return null
  }
  const found = STAFF.find(s => pinMatches(clean, s.pin))
  if (!found) {
    noteFailure(ip)
    return null
  }
  attempts.delete(ip)
  return { staff: publicStaff(found), token: createSession(found) }
}
