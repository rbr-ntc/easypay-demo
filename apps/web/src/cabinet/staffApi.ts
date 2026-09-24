import type { Snapshot } from '../api'
import { getStaffToken } from '../staff'
import { openStream } from '../liveStream'

/**
 * Действия персонала над ЛЮБЫМ столом. Гостевой клиент привязан к столу из
 * `?t=` в адресе, а зал открывает стол кликом — поэтому отдельный слой.
 */

const TIMEOUT_MS = 10_000

export interface StaffResult {
  ok: boolean
  status: number
  /** Код ошибки сервера (`unpaid`, `kitchen pending`, …) или `timeout` / `offline`. */
  error: string | null
  body: Record<string, unknown>
}

export async function staffPost(path: string, body: object = {}): Promise<StaffResult> {
  // Запрос обязан сдаться сам: иначе кнопка висит в «Секунду…» вечно,
  // и человек с деньгами в руке не знает, провелись они или нет
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-token': getStaffToken() },
      body: JSON.stringify(body),
      signal: stop.signal
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, status: res.status, error: res.ok ? null : String(data.error ?? res.statusText), body: data }
  } catch (err) {
    return { ok: false, status: 0, error: stop.signal.aborted ? 'timeout' : 'offline', body: {} }
  } finally {
    clearTimeout(timer)
  }
}

export const tableAction = (tableId: string, action: string, body: object = {}) =>
  staffPost(`/api/t/${encodeURIComponent(tableId)}/${action}`, body)

export const setStop = (dishId: string, stop: boolean) => staffPost('/api/menu/stop', { dishId, stop })

/** Живой снимок стола глазами персонала: полный состав и деньги. */
export function subscribeTable(
  tableId: string,
  onSnap: (s: Snapshot) => void,
  onState: (ok: boolean) => void
): () => void {
  return openStream(
    () => `/api/t/${encodeURIComponent(tableId)}/stream?token=${encodeURIComponent(getStaffToken())}`,
    onSnap,
    onState,
    `стол ${tableId}`
  )
}

/** Человеческие слова для кодов ошибок: персоналу нужно, что делать дальше. */
export function staffError(r: StaffResult): string {
  const map: Record<string, string> = {
    timeout: 'Сервер не ответил вовремя — проверьте, прежде чем повторять',
    offline: 'Нет связи с сервером — действие не прошло',
    unpaid: 'Стол не оплачен',
    'kitchen pending': 'На кухне ещё готовится еда этого стола',
    'already closed': 'Стол уже закрыт',
    'nothing to pay': 'Счёт уже закрыт — брать нечего',
    'role not allowed': 'Вашей роли это недоступно',
    'staff login required': 'Нужно войти в смену',
    'signed out elsewhere': 'Вы вошли на другом устройстве — войдите заново',
    'table closed': 'Стол уже закрыт',
    'unknown dish': 'Такого блюда нет в меню',
    'guest has orders': 'У гостя есть заказы — убрать нельзя',
    'guest has payments': 'Гость уже платил — убрать нельзя',
    'last guest': 'Это последний гость за столом',
    'guest not found': 'Гостя уже нет за столом'
  }
  return map[r.error ?? ''] ?? 'Не получилось — попробуйте ещё раз'
}
