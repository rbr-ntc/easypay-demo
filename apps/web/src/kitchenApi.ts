import { getStaffToken } from './staff'
import { openStream } from './liveStream'
import type { KitchenSummary, KitchenTicket } from '@easypay/domain/kitchen'

export interface KitchenPayload {
  tickets: KitchenTicket[]
  cancelled: KitchenTicket[]
  summary: KitchenSummary & { bar: number; kitchen: number; cancelled: number; warn: number; ready: number }
  /** Что сейчас в стопе — с учётом тумблеров кухни, а не только menu.json. */
  stop?: string[]
  stopInfo?: Record<string, { by: string | null; at: number | null; byMenu: boolean }>
  menuVersion?: number
  settingsVersion?: number
  /** Открыта ли смена — повару /api/shift недоступен. */
  shiftOpen?: boolean
  now: number
}

/** Кухня действует по любому столу, поэтому шлём запрос напрямую в нужный. */
/** Дольше этого повар ждать не станет — он вернётся к плите. */
const ACTION_TIMEOUT_MS = 8000

async function tableAction(
  tableId: string,
  action: 'start' | 'ready' | 'serve' | 'dismiss',
  uid: number,
  sessionId: string
): Promise<boolean> {
  // Без таймаута повисший запрос оставлял кнопку в disabled навсегда: тикет
  // нельзя было ни отдать, ни вернуть, и экран молчал о том, что случилось
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), ACTION_TIMEOUT_MS)
  try {
    const res = await fetch(`/api/t/${encodeURIComponent(tableId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-token': getStaffToken() },
      // sessionId защищает от попадания в чужой заказ: uid переиспользуются после закрытия
      body: JSON.stringify({ uid, sessionId }),
      signal: abort.signal
    })
    return res.ok
  } catch (err) {
    console.error('kitchen action failed:', err)
    return false
  } finally {
    clearTimeout(timer)
  }
}

export const takeToWork = (tableId: string, uid: number, sessionId: string) =>
  tableAction(tableId, 'start', uid, sessionId)
/** Повар закончил: блюдо на раздаче и ждёт официанта. */
export const markReady = (tableId: string, uid: number, sessionId: string) =>
  tableAction(tableId, 'ready', uid, sessionId)

/** Официант унёс с раздачи и поставил гостю. */
export const handOver = (tableId: string, uid: number, sessionId: string) =>
  tableAction(tableId, 'serve', uid, sessionId)
/** Повар подтверждает отмену: пока не подтвердил, карточка висит на экране. */
export const dismissCancelled = (tableId: string, uid: number, sessionId: string) =>
  tableAction(tableId, 'dismiss', uid, sessionId)

export function subscribeKitchen(
  onData: (p: KitchenPayload) => void,
  onState: (ok: boolean) => void
): () => void {
  return openStream(() => `/api/kitchen/stream?token=${encodeURIComponent(getStaffToken())}`, onData, onState, 'кухня')
}
