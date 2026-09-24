// Персонал смены: вход по PIN, сессии, закрепление столов за официантами.
//
// Список сотрудников живёт в базе и правится из кабинета («Персонал»); в
// памяти процесса — его копия, чтобы вход по PIN не ходил в базу. Файл
// packages/config/staff.json — только начальное наполнение. PIN хранится
// хешем: тот же scrypt, что в packages/db/src/seed.js, иначе засеянные
// сотрудники не смогли бы войти.
import crypto from 'node:crypto'
import { staff as RAW } from '@easypay/config'

// PIN-коды из файла можно перекрыть переменной: EASYPAY_STAFF_PINS="max=4821,boss=7390"
const PIN_OVERRIDES = new Map(
  String(process.env.EASYPAY_STAFF_PINS ?? '')
    .split(',')
    .map(pair => pair.split('=').map(x => x.trim()) as [string, string])
    .filter(([id, pin]) => id && pin)
)

export const STAFF_ROLES = ['manager', 'waiter', 'cook'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export interface StaffRecord {
  id: string
  name: string
  role: string
  tables: string[]
  pinHash: string
  /** Уволенный не входит и не значится в зале, но остаётся в журнале и чеках. */
  active: boolean
  phone: string | null
}

export function hashPin(pin: string): string {
  return crypto.scryptSync(String(pin), 'easypay', 32).toString('base64')
}

/** Персонал из файла — пока в базе никого нет (запуск без базы, тесты). */
export function staffFromConfig(): StaffRecord[] {
  return RAW.staff.map((s: any) => ({
    id: String(s.id),
    name: String(s.name),
    role: String(s.role),
    tables: (s.tables ?? []).map(String),
    pinHash: hashPin(String(PIN_OVERRIDES.get(String(s.id)) ?? s.pin)),
    active: true,
    phone: s.phone ? String(s.phone) : null
  }))
}

let STAFF: StaffRecord[] = staffFromConfig()

/** Заменить список в памяти: при старте из базы и после правки в кабинете. */
export function applyStaff(list: StaffRecord[]) {
  STAFF = list.map(s => ({ ...s, tables: [...s.tables] }))
  // Уволенного выкидываем из смены сразу, а не через двенадцать часов
  const fired = new Set(STAFF.filter(s => !s.active).map(s => s.id))
  for (const [token, sess] of sessions) {
    if (fired.has(sess.staffId)) {
      sessions.delete(token)
      revoked.set(token, Date.now())
    }
  }
}

export const allStaff = (): StaffRecord[] => STAFF
export const findStaff = (id: string) => STAFF.find(s => s.id === id) ?? null
/** PIN занят другим работающим сотрудником — вход по PIN не различил бы их. */
export const pinTaken = (hash: string, exceptId: string | null) => STAFF.some(s => s.active && s.pinHash === hash && s.id !== exceptId)

/** Публичная карточка сотрудника: без PIN-кода. */
function publicStaff(s: any) {
  return { id: s.id, name: s.name, role: s.role, tables: s.tables }
}

export function staffRoster() {
  return STAFF.filter(s => s.active).map(publicStaff)
}

/** Имя сотрудника по его id: чек и журнал должны называть человека, а не код. */
export function staffName(id: string | null | undefined) {
  if (!id) return null
  return STAFF.find(s => s.id === id)?.name ?? null
}

export function waiterOfTable(tableId: string) {
  const found = STAFF.find(s => s.active && s.role === 'waiter' && s.tables.includes(String(tableId)))
  return found ? { id: found.id, name: found.name } : null
}

// --- Сессии ---
const SESSION_TTL = 12 * 60 * 60 * 1000 // смена
/** @type {Map<string, {staff: object, expiresAt: number}>} */
const sessions = new Map<string, { id: string; staffId: string; staff: any; device: string | null; expiresAt: number }>()

const MAX_SESSIONS_PER_STAFF = 5

export function createSession(staff: any, device: string | null = null) {
  // У повара три экрана (горячий, холодный, раздача), у официанта телефон и планшет.
  // Гасить прежний вход при каждом новом означало, что люди выбивают друг друга
  // посреди смены без объяснения. Разрешаем несколько устройств, но не бесконечно.
  const own = [...sessions.entries()].filter(([, s]) => s.staffId === staff.id)
  if (own.length >= MAX_SESSIONS_PER_STAFF) {
    const oldest = own.sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
    if (oldest) {
      sessions.delete(oldest[0])
      revoked.set(oldest[0], Date.now())
    }
  }

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
  // Роль и столы — текущие: менеджер мог переназначить их посреди смены
  const rec = findStaff(found.staffId)
  const staff = rec ? publicStaff(rec) : found.staff
  // Действие в журнале должно отвечать не только «под каким аккаунтом», но и «с какого устройства»
  return { ...staff, sessionId: found.id, device: found.device }
}

/** Активные сессии сотрудника — менеджеру видно, кто сейчас в смене и с чего. */
export function activeSessions() {
  const now = Date.now()
  return [...sessions.values()]
    .filter(s => s.expiresAt > now)
    .map(s => ({ id: s.id, staffId: s.staffId, name: s.staff.name, role: s.staff.role, device: s.device }))
}

/** Токен был погашен вытеснением — об этом надо сказать прямо. */
export function wasRevoked(token: unknown) {
  return revoked.has(String(token ?? ''))
}

export function dropSession(token: unknown) {
  sessions.delete(String(token ?? ''))
}

export function sweepSessions() {
  const now = Date.now()
  for (const [token, s] of sessions) if (s.expiresAt < now) sessions.delete(token)
}

// --- Вход по PIN ---
// Ограничитель считает промахи по УСТРОЙСТВУ, а не по адресу: в ресторане вся
// смена сидит за одним роутером, и шесть опечаток новичка запирали вход всем,
// включая управляющего. По IP оставлен грубый предохранитель с большим потолком —
// он ловит настоящий перебор, а не заплетающиеся пальцы.
const MAX_ATTEMPTS = 6
const MAX_ATTEMPTS_PER_IP = 40
const ATTEMPT_WINDOW = 5 * 60 * 1000
/** @type {Map<string, {count: number, until: number}>} */
const attempts = new Map<string, { count: number; until: number }>()
// Погашенные токены помним, чтобы сказать человеку, ПОЧЕМУ его выкинуло:
// голый 401 неотличим от «не вошёл» и «протухло»
const revoked = new Map<string, number>()

/** Сколько секунд осталось до снятия блокировки: глухой отказ бесполезен. */
export function lockoutSeconds(ip: string, device: string | null = null) {
  const now = Date.now()
  const until = [deviceKey(ip, device), ipKey(ip)]
    .map(key => attempts.get(key))
    .filter(rec => rec && rec.until > now)
    .map(rec => rec!.until)
  return until.length > 0 ? Math.ceil((Math.max(...until) - now) / 1000) : 0
}

export function loginAllowed(ip: string, device: string | null = null) {
  const overLimit = (key: string, max: number) => {
    const rec = attempts.get(key)
    if (!rec) return false
    if (rec.until < Date.now()) {
      attempts.delete(key)
      return false
    }
    return rec.count >= max
  }
  return !overLimit(deviceKey(ip, device), MAX_ATTEMPTS) && !overLimit(ipKey(ip), MAX_ATTEMPTS_PER_IP)
}

const deviceKey = (ip: string, device: string | null) => (device ? `d:${device}` : `d:${ip}`)
const ipKey = (ip: string) => `ip:${ip}`

function noteFailure(ip: string, device: string | null = null) {
  for (const key of [deviceKey(ip, device), ipKey(ip)]) {
    const rec = attempts.get(key)
    if (!rec || rec.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + ATTEMPT_WINDOW })
    else rec.count += 1
  }
}

/** Сравнение хешей без утечки времени: одинаковая длина обязательна. */
function pinMatches(given: string, want: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(want)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function loginByPin(pin: unknown, ip: string, device: unknown = null) {
  const label = typeof device === 'string' && device.length <= 40 ? device : null
  const clean = String(pin ?? '').trim()
  if (!/^\d{4,8}$/.test(clean)) {
    noteFailure(ip, label)
    return null
  }
  const hash = hashPin(clean)
  const found = STAFF.find(s => s.active && pinMatches(hash, s.pinHash))
  if (!found) {
    noteFailure(ip, label)
    return null
  }
  // Успешный вход снимает счётчик и с устройства, и с адреса
  attempts.delete(deviceKey(ip, label))
  attempts.delete(ipKey(ip))
  const session = createSession(found, label)
  return { staff: publicStaff(found), token: session.token, sessionId: session.sessionId, device: label }
}
