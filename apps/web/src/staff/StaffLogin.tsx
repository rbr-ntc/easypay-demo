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
    <div className="ep-forest flex min-h-full flex-col justify-center p-6">
      <div className="mx-auto w-full max-w-sm">
        <div className="text-center">
          <div
            className="mx-auto flex size-13 items-center justify-center rounded-[16px] text-[22px] font-extrabold"
            style={{ background: '#D5F94E', color: '#062119' }}
          >
            e
          </div>
          <div className="mt-4 text-[25px] font-extrabold tracking-tight">Вход в смену</div>
          <p className="mt-2 text-[15px] leading-snug font-medium" style={{ color: '#9FB5A8' }}>
            {wasSignedOut()
              ? 'Вы вышли из смены. Введите PIN, чтобы зайти под другим сотрудником.'
              : 'Введите свой PIN — экран откроется по вашей роли.'}
          </p>
        </div>

        <div className="mt-6.5 flex justify-center gap-3.5">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span
              key={i}
              className="size-4 rounded-full"
              style={{ background: i < pin.length ? '#D5F94E' : 'rgba(250,245,234,.18)' }}
            />
          ))}
        </div>
        <div className="mt-2.5 text-center text-[13px] font-semibold" style={{ color: '#9FB5A8' }}>
          {busy ? 'Проверяем…' : 'Отправим сами, как введёте четвёртую цифру'}
        </div>

        {error && (
          <div
            className="mt-4.5 rounded-field px-4 py-3.5 text-center"
            style={{ background: 'rgba(158,53,23,.28)', border: '1px solid rgba(255,227,216,.4)' }}
          >
            <div className="text-[14px] font-extrabold" style={{ color: '#FFE3D8' }}>
              {error}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-3">
          {KEYS.map((key, i) =>
            key ? (
              <button
                key={key}
                onClick={() => press(key)}
                disabled={busy}
                className="h-16 rounded-[18px] text-[24px] font-extrabold disabled:opacity-45"
                style={{ border: '1px solid rgba(250,245,234,.18)', background: 'rgba(250,245,234,.06)', color: '#FAF5EA' }}
              >
                {key}
              </button>
            ) : (
              <span key={`gap-${i}`} />
            )
          )}
        </div>

        <div className="mt-4 text-center text-[12px] font-semibold" style={{ color: '#9FB5A8' }}>
          Демо: официант 1111 · повар 4444 · менеджер 9999
        </div>
        <div className="mt-1 text-center text-[12px] font-semibold" style={{ color: '#6E8579' }}>
          Сессия живёт 12 часов
        </div>
      </div>
    </div>
  )
}
