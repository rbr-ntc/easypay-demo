import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { wasSignedOut } from '../staff'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
const PIN_LENGTH = 4

/**
 * Вход в смену по PIN — как на станции официанта: цифровая клавиатура,
 * автоотправка на четвёртой цифре. Роль сотрудника определяет, что он увидит.
 */
export function StaffLogin() {
  const { signInStaff } = useStore()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || sending.current) return
    sending.current = true
    setBusy(true)
    void signInStaff(pin).then(status => {
      sending.current = false
      setBusy(false)
      if (status === 200) return
      setPin('')
      if (status === 429) setError('Слишком много попыток — подождите пару минут')
      else if (status === 0) setError('Нет связи с сервером')
      else setError('PIN не подошёл')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  const press = (key: string) => {
    if (busy) return
    setError('')
    if (key === '⌫') setPin(prev => prev.slice(0, -1))
    else if (key) setPin(prev => (prev.length >= PIN_LENGTH ? prev : prev + key))
  }

  return (
    <div className="ep-w-login">
      <div className="ep-w-login-card">
        <div className="ep-w-logo">e</div>
        <div className="ep-w-login-title">Вход в смену</div>
        <div className="ep-w-login-hint">
          {wasSignedOut() ? 'Вы вышли из смены. Введите PIN, чтобы зайти под другим сотрудником.' : 'Введите свой PIN — экран откроется по вашей роли.'}
        </div>

        <div className="ep-s-dots">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span key={i} className={i < pin.length ? 'ep-s-dot ep-s-dot--on' : 'ep-s-dot'} />
          ))}
        </div>

        {error && <div className="ep-w-error">{error}</div>}
        {busy && <div className="ep-w-login-hint">Проверяем…</div>}

        <div className="ep-s-pad">
          {KEYS.map((key, i) =>
            key ? (
              <button key={key} className="ep-s-key" onClick={() => press(key)} disabled={busy}>
                {key}
              </button>
            ) : (
              <span key={`gap-${i}`} />
            )
          )}
        </div>

        <div className="ep-s-demo">Демо: официант 1111 · повар 4444 · менеджер 9999</div>
      </div>
    </div>
  )
}
