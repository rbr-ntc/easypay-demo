import type { Animal } from './data'
import { getManagerToken } from './manager'

// Стол — только из ?t=... (его несёт QR со стола). Молчаливого дефолта нет:
// без параметра гость увидит экран выбора стола, а не чужой заказ.
const TABLE_RE = /^[A-Za-z0-9_-]{1,24}$/
const requested = new URLSearchParams(window.location.search).get('t')

export const tableId: string | null = requested && TABLE_RE.test(requested) ? requested : null
export const requestedTable = requested // как есть — чтобы показать «стол не найден»

const API = tableId ? `/api/t/${encodeURIComponent(tableId)}` : null

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
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
  qty: number
  options?: Record<string, string>
  shared: boolean
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
  at: number
  personaId: string
  reason: string
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
}

async function post<T>(action: string, body: object, opts: { manager?: boolean } = {}): Promise<T> {
  if (!API) throw new ApiError('стол не выбран', 400)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.manager) headers['x-manager-token'] = getManagerToken()
  const res = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError((err as { error?: string }).error || 'request failed', res.status)
  }
  return res.json() as Promise<T>
}

// idemKey: повтор с тем же ключом не создаёт вторую персону / второй платёж
export const apiJoin = (name: string, animal: Animal, idemKey: string) =>
  post<{ personaId: string; snapshot: Snapshot }>('join', { name, animal, idemKey })

export const apiAddLine = (
  personaId: string,
  dishId: string,
  qty: number,
  shared: boolean,
  options: Record<string, string>,
  idemKey: string
) => post<{ ok: true }>('lines', { personaId, dishId, qty, shared, options, idemKey })

export const apiRemoveLine = (personaId: string, uid: number) => post<{ ok: true }>('remove', { personaId, uid })

export const apiSend = (personaId: string, scope: 'mine' | 'all') => post<{ ok: true }>('send', { personaId, scope })

export const apiPay = (personaId: string, scope: 'own' | 'equal' | 'full', idemKey: string) =>
  post<{ ok: true; amount: number }>('pay', { personaId, scope, idemKey })

export const apiTip = (personaId: string, amount: number, idemKey: string) =>
  post<{ ok: true; amount: number }>('tip', { personaId, amount, idemKey })

export const apiCall = (personaId: string, reason: 'help' | 'bill' | 'water') =>
  post<{ ok: true }>('call', { personaId, reason })

// Менеджерские действия — только с токеном
export const apiServe = (uid: number) => post<{ ok: true }>('serve', { uid }, { manager: true })

export const apiAck = () => post<{ ok: true }>('ack', {}, { manager: true })

export const apiClose = () => post<{ ok: true }>('close', {}, { manager: true })

export const apiReset = () => post<{ ok: true }>('reset', {}, { manager: true })

export async function apiManagerCheck(token: string = getManagerToken()): Promise<boolean> {
  if (!token) return false
  try {
    const res = await fetch('/api/manager/check', { headers: { 'x-manager-token': token } })
    return res.ok
  } catch {
    return false
  }
}

export function subscribe(onSnapshot: (s: Snapshot) => void, onState: (ok: boolean) => void): () => void {
  if (!API) return () => {} // стол не выбран — подписываться не на что
  const es = new EventSource(`${API}/stream`)
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
