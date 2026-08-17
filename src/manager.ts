// Токен менеджера для экрана официанта: подавать/закрыть стол/сбросить демо.
// Хранится в localStorage браузера ресторана. Удобный вход для показа демо —
// открыть ссылку `?mtoken=…`: токен осядет локально, а из адреса мы его уберём.
const KEY = 'easypay-manager-token'

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

export function getManagerToken(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setManagerToken(token: string): void {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    /* приватный режим — обойдёмся без запоминания */
  }
}

export function clearManagerToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* см. выше */
  }
}

const fromQuery = readQueryToken()
if (fromQuery) setManagerToken(fromQuery)
