import { getStaffToken } from './staff'
import type { KitchenSummary, KitchenTicket } from '../shared/kitchen.js'

export interface KitchenPayload {
  tickets: KitchenTicket[]
  cancelled: KitchenTicket[]
  summary: KitchenSummary & { bar: number; kitchen: number; cancelled: number }
  now: number
}

/** Кухня действует по любому столу, поэтому шлём запрос напрямую в нужный. */
async function tableAction(
  tableId: string,
  action: 'start' | 'serve',
  uid: number,
  sessionId: string
): Promise<boolean> {
  try {
    const res = await fetch(`/api/t/${encodeURIComponent(tableId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-token': getStaffToken() },
      // sessionId защищает от попадания в чужой заказ: uid переиспользуются после закрытия
      body: JSON.stringify({ uid, sessionId })
    })
    return res.ok
  } catch (err) {
    console.error('kitchen action failed:', err)
    return false
  }
}

export const takeToWork = (tableId: string, uid: number, sessionId: string) =>
  tableAction(tableId, 'start', uid, sessionId)
export const markReady = (tableId: string, uid: number, sessionId: string) =>
  tableAction(tableId, 'serve', uid, sessionId)

export function subscribeKitchen(
  onData: (p: KitchenPayload) => void,
  onState: (ok: boolean) => void
): () => void {
  const es = new EventSource(`/api/kitchen/stream?token=${encodeURIComponent(getStaffToken())}`)
  es.onmessage = e => {
    try {
      onData(JSON.parse(e.data) as KitchenPayload)
      onState(true)
    } catch (err) {
      console.error('bad kitchen payload:', err)
    }
  }
  es.onerror = () => onState(false)
  return () => es.close()
}
