import type { Staff } from '@easypay/domain/roles'

// Сессия сотрудника в браузере планшета/станции: токен + кто вошёл.
// Раньше здесь лежал один общий токен менеджера на все экраны.
const TOKEN_KEY = 'easypay-staff-token'
const STAFF_KEY = 'easypay-staff'
// Явный выход должен быть сильнее сервисной ссылки ?mtoken=: иначе перезагрузка
// страницы молча возвращала менеджера и «Выйти» выглядел неработающим.
const SIGNED_OUT_KEY = 'easypay-signed-out'

/** Мастер-токен менеджера ссылкой `?mtoken=…` — совместимость со старыми демо-ссылками. */
function readQueryToken(): string {
  try {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('mtoken')
    if (!token) return ''
    params.delete('mtoken')
    const rest = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
    return token
  } catch {
    return ''
  }
}

export function getStaffToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setStaffToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* приватный режим — живём без запоминания */
  }
}

export function getCachedStaff(): Staff | null {
  try {
    const raw = localStorage.getItem(STAFF_KEY)
    return raw ? (JSON.parse(raw) as Staff) : null
  } catch {
    return null
  }
}

export function setCachedStaff(staff: Staff | null): void {
  try {
    if (staff) localStorage.setItem(STAFF_KEY, JSON.stringify(staff))
    else localStorage.removeItem(STAFF_KEY)
  } catch {
    /* см. выше */
  }
}

export function clearStaff(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(STAFF_KEY)
  } catch {
    /* см. выше */
  }
}

export function markSignedOut(): void {
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, '1')
  } catch {
    /* приватный режим */
  }
}

export function clearSignedOut(): void {
  try {
    sessionStorage.removeItem(SIGNED_OUT_KEY)
  } catch {
    /* см. выше */
  }
}

export function wasSignedOut(): boolean {
  try {
    return sessionStorage.getItem(SIGNED_OUT_KEY) === '1'
  } catch {
    return false
  }
}

// Токен из ссылки применяем только если в этой вкладке не выходили руками.
// Параметр из адреса убираем в любом случае.
const fromQuery = readQueryToken()
if (fromQuery && !wasSignedOut()) setStaffToken(fromQuery)
