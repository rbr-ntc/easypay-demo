import type { Staff } from '../shared/roles.js'

// Сессия сотрудника в браузере планшета/станции: токен + кто вошёл.
// Раньше здесь лежал один общий токен менеджера на все экраны.
const TOKEN_KEY = 'easypay-staff-token'
const STAFF_KEY = 'easypay-staff'

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

const fromQuery = readQueryToken()
if (fromQuery) setStaffToken(fromQuery)
