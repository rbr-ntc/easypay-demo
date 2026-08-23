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
    <div className="flex min-h-full items-center justify-center bg-base-200 p-5">
      <div className="card w-full max-w-sm bg-base-100 shadow-lg">
        <div className="card-body items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-field bg-primary text-xl font-bold text-primary-content">
            e
          </div>
          <h2 className="card-title">Вход в смену</h2>
          <p className="text-sm text-base-content/60">
            {wasSignedOut()
              ? 'Вы вышли из смены. Введите PIN, чтобы зайти под другим сотрудником.'
              : 'Введите свой PIN — экран откроется по вашей роли.'}
          </p>

          <div className="my-2 flex gap-3">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span key={i} className={`status status-lg ${i < pin.length ? 'status-primary' : ''}`} />
            ))}
          </div>

          {error && (
            <div role="alert" className="alert alert-error alert-soft py-2 text-sm">
              <span>{error}</span>
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-base-content/60">
              <span className="loading loading-spinner loading-sm" /> Проверяем…
            </div>
          )}

          <div className="mt-2 grid w-full grid-cols-3 gap-2">
            {KEYS.map((key, i) =>
              key ? (
                <button key={key} className="btn h-14 text-xl" onClick={() => press(key)} disabled={busy}>
                  {key}
                </button>
              ) : (
                <span key={`gap-${i}`} />
              )
            )}
          </div>

          <div className="mt-2 text-xs text-base-content/60">
            Демо: официант 1111 · повар 4444 · менеджер 9999
          </div>
        </div>
      </div>
    </div>
  )
}
