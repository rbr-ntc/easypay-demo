import type { Animal } from './data'

// Стол берём из ?t=..., по умолчанию 12
export const tableId = new URLSearchParams(window.location.search).get('t') || '12'
const API = `/api/t/${encodeURIComponent(tableId)}`

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
  shared: boolean
  personaId: string
  sent: boolean
  served: boolean
  sentAt: number | null
  servedAt: number | null
}

export interface ServerPayment {
  personaId: string
  amount: number
  scope: string
  at: number
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
}

async function post<T>(action: string, body: object): Promise<T> {
  const res = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error || 'request failed')
  }
  return res.json() as Promise<T>
}

export const apiJoin = (name: string, animal: Animal) =>
  post<{ personaId: string; snapshot: Snapshot }>('join', { name, animal })

export const apiAddLine = (personaId: string, dishId: string, qty: number, shared: boolean) =>
  post<{ ok: true }>('lines', { personaId, dishId, qty, shared })

export const apiRemoveLine = (personaId: string, uid: number) => post<{ ok: true }>('remove', { personaId, uid })

export const apiSend = (personaId: string, scope: 'mine' | 'all') => post<{ ok: true }>('send', { personaId, scope })

export const apiPay = (personaId: string, scope: 'own' | 'equal' | 'full') =>
  post<{ ok: true; amount: number }>('pay', { personaId, scope })

export const apiServe = (uid: number) => post<{ ok: true }>('serve', { uid })

export const apiClose = () => post<{ ok: true }>('close', {})

export const apiReset = () => post<{ ok: true }>('reset', {})

export function subscribe(onSnapshot: (s: Snapshot) => void, onState: (ok: boolean) => void): () => void {
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
