// Персонал смены: вход по PIN, сессии, закрепление столов за официантами.
// Демо-хранилище: список в src/staff.json, сессии в памяти. В проде это БД,
// хеши PIN-кодов и общий SSO — здесь важна форма, а не хранилище.
import crypto from 'node:crypto'
import { staff as RAW } from '@easypay/config'

// PIN-коды из файла можно перекрыть переменной: EASYPAY_STAFF_PINS="max=4821,boss=7390"
const PIN_OVERRIDES = new Map(
  String(process.env.EASYPAY_STAFF_PINS ?? '')
    .split(',')
    .map(pair => pair.split('=').map(x => x.trim()) as [string, string])
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
function publicStaff(s: any) {
  return { id: s.id, name: s.name, role: s.role, tables: s.tables }
}

export function staffRoster() {
  return STAFF.map(publicStaff)
}

export function waiterOfTable(tableId: string) {
  const found = STAFF.find(s => s.role === 'waiter' && s.tables.includes(String(tableId)))
  return found ? { id: found.id, name: found.name } : null
}

// --- Сессии ---
const SESSION_TTL = 12 * 60 * 60 * 1000 // смена
/** @type {Map<string, {staff: object, expiresAt: number}>} */
const sessions = new Map<string, { id: string; staffId: string; staff: any; device: string | null; expiresAt: number }>()

export function createSession(staff: any, device: string | null = null) {
  // Новый вход гасит прежние сессии этого сотрудника: две смены под одним PIN
  // означали, что журнал не отличает людей, а действия наступают друг на друга.
  for (const [token, s] of sessions) if (s.staffId === staff.id) sessions.delete(token)

  const token = crypto.randomBytes(18).toString('base64url')
  const id = crypto.randomUUID()
  sessions.set(token, {
    id,
    staffId: staff.id,
    staff: publicStaff(staff),
    device,
    expiresAt: Date.now() + SESSION_TTL
  })
  return { token, sessionId: id }
}

export function sessionStaff(token: unknown) {
  const found = sessions.get(String(token ?? ''))
  if (!found) return null
  if (found.expiresAt < Date.now()) {
    sessions.delete(String(token))
    return null
  }
  // Действие в журнале должно отвечать не только «под каким аккаунтом», но и «с какого устройства»
  return { ...found.staff, sessionId: found.id, device: found.device }
}

/** Активные сессии сотрудника — менеджеру видно, кто сейчас в смене и с чего. */
export function activeSessions() {
  const now = Date.now()
  return [...sessions.values()]
    .filter(s => s.expiresAt > now)
    .map(s => ({ id: s.id, staffId: s.staffId, name: s.staff.name, role: s.staff.role, device: s.device }))
}

export function dropSession(token: unknown) {
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
const attempts = new Map<string, { count: number; until: number }>()

export function loginAllowed(ip: string) {
  const rec = attempts.get(ip)
  if (!rec) return true
  if (rec.until < Date.now()) {
    attempts.delete(ip)
    return true
  }
  return rec.count < MAX_ATTEMPTS
}

function noteFailure(ip: string) {
  const rec = attempts.get(ip)
  if (!rec || rec.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + ATTEMPT_WINDOW })
  else rec.count += 1
}

/** Сравнение PIN без утечки времени: одинаковая длина обязательна. */
function pinMatches(given: unknown, want: unknown) {
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(want))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function loginByPin(pin: unknown, ip: string, device: unknown = null) {
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
  const label = typeof device === 'string' && device.length <= 40 ? device : null
  const session = createSession(found, label)
  return { staff: publicStaff(found), token: session.token, sessionId: session.sessionId, device: label }
}
