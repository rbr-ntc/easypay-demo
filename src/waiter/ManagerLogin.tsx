import { useState } from 'react'
import { useStore } from '../store'

/**
 * Экран ресторана закрыт токеном: без него нельзя подать блюдо, закрыть стол
 * или сбросить демо. Токен печатается в лог сервера при старте
 * (или задаётся через EASYPAY_MANAGER_TOKEN).
 */
export function ManagerLogin() {
  const { signInManager } = useStore()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (busy || !token.trim()) return
    setBusy(true)
    setError('')
    const ok = await signInManager(token)
    setBusy(false)
    if (!ok) setError('Токен не подошёл')
  }

  return (
    <div className="ep-w-login">
      <div className="ep-w-login-card">
        <div className="ep-w-logo">e</div>
        <div className="ep-w-login-title">Экран ресторана</div>
        <div className="ep-w-login-hint">
          Введите токен менеджера — он в логе сервера при старте или в переменной
          EASYPAY_MANAGER_TOKEN.
        </div>
        <input
          className="ep-w-input"
          type="password"
          placeholder="Токен менеджера"
          value={token}
          autoFocus
          onChange={e => setToken(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
        />
        {error && <div className="ep-w-error">{error}</div>}
        <button className="ep-w-btn ep-w-btn--primary" style={{ width: '100%' }} disabled={busy} onClick={() => void submit()}>
          {busy ? 'Проверяем…' : 'Войти'}
        </button>
        <div style={{ marginTop: 14 }}>
          <a className="ep-w-link" href="#/">
            ← гостевой экран
          </a>
        </div>
      </div>
    </div>
  )
}
