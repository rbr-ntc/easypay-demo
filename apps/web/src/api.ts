import type { Animal } from './data'
import { getStaffToken } from './staff'
import type { Staff } from '@easypay/domain/roles'

// Стол — только из ?t=... (его несёт QR со стола). Молчаливого дефолта нет:
// без параметра гость увидит экран выбора стола, а не чужой заказ.
const TABLE_RE = /^[A-Za-z0-9_-]{1,24}$/
const requested = new URLSearchParams(window.location.search).get('t')

export const tableId: string | null = requested && TABLE_RE.test(requested) ? requested : null
export const requestedTable = requested // как есть — чтобы показать «стол не найден»

const API = tableId ? `/api/t/${encodeURIComponent(tableId)}` : null

export class ApiError extends Error {
  readonly status: number
  /** Сырой код ошибки сервера: по нему клиент отличает «аллерген» от «нет связи». */
  readonly error: string
  /** Подробности отказа: список аллергенов, остаток, потолок чаевых. */
  readonly extra: Record<string, unknown>

  constructor(message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.error = message
    this.extra = extra
  }
}

export interface ServerPersona {
  id: string
  name: string
  animal: Animal
  joinedAt: number
}

export interface ServerLine {
  uid: number
  dishId: string
  name?: string
  qty: number
  price?: number
  options?: Record<string, string>
  shared: boolean
  sharedWith?: string[]
  cancelled?: boolean
  cancelReason?: string | null
  personaId: string
  sent: boolean
  served: boolean
  sentAt: number | null
  startedAt?: number | null
  servedAt: number | null
}

export interface ServerPayment {
  personaId: string
  amount: number
  scope: string
  at: number
}

export interface ServerTip {
  personaId: string
  amount: number
  at: number
}

export interface ServerCall {
  id?: string
  at: number
  personaId: string
  reason: string
  name?: string
}

/** Итоги считает сервер — гость видит ровно то, что спишется. */
export interface PersonaTotals {
  personaId: string
  own: number
  share: number
  total: number
  paid: number
  remaining: number
  draft: number
}

export interface ServerTotals {
  tableTotal: number
  paidTotal: number
  remaining: number
  sharedTotal: number
  draftTotal: number
  byPersona: PersonaTotals[]
}

export interface Snapshot {
  tableId: string
  sessionId: string | null
  status: 'open' | 'closed'
  openedAt: number | null
  closedAt: number | null
  personas: ServerPersona[]
  lines: ServerLine[]
  payments: ServerPayment[]
  tips: ServerTip[]
  call: ServerCall | null
  calls: ServerCall[]
  waiter: { id: string; name: string } | null
  seats: number
  totals: ServerTotals
}

async function post<T>(action: string, body: object, opts: { staff?: boolean; guest?: string } = {}): Promise<T> {
  if (!API) throw new ApiError('стол не выбран', 400)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = getStaffToken()
  if (opts.guest) headers['x-guest-token'] = opts.guest
  const res = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as Record<string, unknown>
    throw new ApiError(String(err.error ?? 'request failed'), res.status, err)
  }
  return res.json() as Promise<T>
}

// idemKey: повтор с тем же ключом не создаёт вторую персону / второй платёж
export const apiJoin = (name: string, animal: Animal, idemKey: string, allergies: string[] = []) =>
  post<{ personaId: string; guestToken: string; snapshot: Snapshot }>('join', {
    name,
    animal,
    // Аллергии гостя: дальше система предупреждает сама, а не ждёт комментария
    allergies,
    idemKey
  })

export const apiAddLine = (
  guest: string,
  dishId: string,
  qty: number,
  shared: boolean,
  options: Record<string, string>,
  idemKey: string,
  // Гость увидел предупреждение об аллергене и сознательно подтвердил заказ
  confirmAllergen = false
) =>
  post<{ ok: true; uid: number }>(
    'lines',
    { dishId, qty, shared, options, idemKey, confirmAllergen },
    { guest }
  )

/** Отменить своё блюдо, пока кухня не взяла его в работу. */
export const apiCancelMine = (guest: string, uid: number) =>
  post<{ ok: true }>('cancelMine', { uid }, { guest })

export const apiRemoveLine = (guest: string, uid: number) => post<{ ok: true }>('remove', { uid }, { guest })

export const apiSend = (guest: string, scope: 'mine' | 'all') => post<{ ok: true; sent: number }>('send', { scope }, { guest })

export interface Receipt {
  no: string
  at: number
  amount: number
  scope: string
  guest: string
  table: string
  lines: { name: string; qty: number; price: number; shared: boolean; share: number | null }[]
}

export const apiPay = (guest: string, scope: 'own' | 'equal' | 'full', idemKey: string) =>
  post<{ ok: true; amount: number; remaining: number ; receipt?: Receipt }>('pay', { scope, idemKey }, { guest })

export const apiTip = (guest: string, amount: number, idemKey: string) =>
  post<{ ok: true; amount: number }>('tip', { amount, idemKey }, { guest })

export const apiCall = (guest: string, reason: 'help' | 'bill' | 'water') =>
  post<{ ok: true }>('call', { reason }, { guest })

// Действия персонала — с сессией сотрудника и привязкой к сессии стола
export const apiStart = (uid: number, sessionId: string) =>
  post<{ ok: true; startedAt: number }>('start', { uid, sessionId }, { staff: true })

export const apiServe = (uid: number, sessionId: string) => post<{ ok: true }>('serve', { uid, sessionId }, { staff: true })

export const apiAck = (callId?: string) => post<{ ok: true; left: number }>('ack', { callId }, { staff: true })

/** force — осознанное закрытие стола с долгом. */
export const apiClose = (force = false) => post<{ ok: true }>('close', { force }, { staff: true })

export const apiReset = () => post<{ ok: true }>('reset', {}, { staff: true })

export interface Whoami {
  staff: Staff
  shiftTips: number
}

/** Кто сейчас в смене на этом устройстве. null — нужно войти. */
export async function apiWhoami(token: string = getStaffToken()): Promise<Whoami | null> {
  if (!token) return null
  try {
    const res = await fetch('/api/staff/me', { headers: { 'x-staff-token': token } })
    if (!res.ok) return null
    return (await res.json()) as Whoami
  } catch {
    return null
  }
}

export type LoginResult = { ok: true; token: string; staff: Staff } | { ok: false; status: number }

export async function apiStaffLogin(pin: string): Promise<LoginResult> {
  try {
    const res = await fetch('/api/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    })
    if (!res.ok) return { ok: false, status: res.status }
    const body = (await res.json()) as { token: string; staff: Staff }
    return { ok: true, ...body }
  } catch {
    return { ok: false, status: 0 } // связи нет
  }
}

export async function apiStaffLogout(token: string = getStaffToken()): Promise<void> {
  try {
    await fetch('/api/staff/logout', { method: 'POST', headers: { 'x-staff-token': token } })
  } catch {
    /* выходим локально в любом случае */
  }
}

export async function apiShiftLog(): Promise<{ entries: LogEntry[] } | null> {
  try {
    const res = await fetch('/api/log', { headers: { 'x-staff-token': getStaffToken() } })
    if (!res.ok) return null
    return (await res.json()) as { entries: LogEntry[] }
  } catch {
    return null
  }
}

export interface LogEntry {
  at: number
  staffId: string | null
  name: string
  role: string | null
  action: string
  tableId: string | null
  detail: string | null
}

export function subscribe(
  onSnapshot: (s: Snapshot) => void,
  onState: (ok: boolean) => void,
  guestToken?: string | null
): () => void {
  if (!API) return () => {} // стол не выбран — подписываться не на что
  // Состав стола и деньги видит только свой: EventSource не умеет заголовки,
  // поэтому личный секрет гостя передаётся параметром
  const url = guestToken ? `${API}/stream?g=${encodeURIComponent(guestToken)}` : `${API}/stream`
  const es = new EventSource(url)
  es.onmessage = e => {
    try {
      onSnapshot(JSON.parse(e.data) as Snapshot)
      onState(true)
    } catch (err) {
      console.error('bad snapshot:', err)
    }
  }
  es.onerror = () => onState(false) // EventSource переподключается сам
  return () => es.close()
}
