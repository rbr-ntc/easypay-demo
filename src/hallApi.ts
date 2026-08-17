import { getStaffToken } from './staff'
import type { HallCard, HallShift, HallSummary } from '../shared/hall.js'

export interface HallPayload {
  restaurant: string
  zones: { id: string; name: string }[]
  tables: HallCard[]
  shift: HallShift & { startedAt: number }
  summary: HallSummary
  now: number
}

export async function fetchHall(): Promise<HallPayload | null> {
  try {
    const res = await fetch('/api/hall', { headers: { 'x-staff-token': getStaffToken() } })
    if (!res.ok) return null
    return (await res.json()) as HallPayload
  } catch (err) {
    console.error('hall fetch failed:', err)
    return null
  }
}

/**
 * Живой зал по SSE. EventSource не умеет заголовки, поэтому токен идёт в query —
 * компромисс демо (в проде — сессионная кука для персонала).
 */
export function subscribeHall(onData: (p: HallPayload) => void, onState: (ok: boolean) => void): () => void {
  const es = new EventSource(`/api/hall/stream?token=${encodeURIComponent(getStaffToken())}`)
  es.onmessage = e => {
    try {
      onData(JSON.parse(e.data) as HallPayload)
      onState(true)
    } catch (err) {
      console.error('bad hall payload:', err)
    }
  }
  es.onerror = () => onState(false)
  return () => es.close()
}
