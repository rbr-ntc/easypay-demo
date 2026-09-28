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
  // На мониторе кабинета PIN набирают с клавиатуры, а не мышкой по кнопкам
  const pressRef = useRef(press)
  pressRef.current = press
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressRef.current(e.key)
      else if (e.key === 'Backspace') pressRef.current('⌫')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="cab flex min-h-full flex-col justify-center p-6">
      <div className="mx-auto w-full max-w-sm">
        <div className="text-center">
          <div className="mx-auto flex size-13 items-center justify-center rounded-[16px] bg-c-ink text-[22px] font-extrabold text-white">
            e
          </div>
          <div className="mt-4 text-[25px] font-bold tracking-tight">Вход в смену</div>
          <p className="mt-2 text-[15px] leading-snug text-c-mute">
            {wasSignedOut()
              ? 'Вы вышли из смены. Введите PIN, чтобы зайти под другим сотрудником.'
              : 'Введите свой PIN — откроется ваше рабочее место.'}
          </p>
        </div>

        <div className="mt-6.5 flex justify-center gap-3.5" aria-label={`Введено цифр: ${pin.length} из ${PIN_LENGTH}`}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span key={i} className={`size-4 rounded-full ${i < pin.length ? 'bg-c-ink' : 'bg-c-off'}`} />
          ))}
        </div>
        <div className="mt-2.5 text-center text-[13px] text-c-mute">
          {busy ? 'Проверяем…' : 'Можно с клавиатуры — отправим на четвёртой цифре'}
        </div>

        {error && (
          <div role="alert" className="mt-4.5 rounded-xl border border-c-bad-line bg-c-bad-bg px-4 py-3.5 text-center text-[14px] font-bold text-c-bad-ink">
            {error}
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-3">
          {KEYS.map((key, i) =>
            key ? (
              <button
                key={key}
                onClick={() => press(key)}
                disabled={busy}
                aria-label={key === '⌫' ? 'Стереть' : key}
                className="c-num h-16 rounded-[18px] border border-c-line bg-c-card text-[24px] font-bold active:bg-c-chip disabled:opacity-45"
              >
                {key}
              </button>
            ) : (
              <span key={`gap-${i}`} />
            )
          )}
        </div>

        {/* PIN-коды на экране входа раздавали менеджера любому прохожему (смена №6, Б1) */}
        <div className="mt-4 text-center text-[12px] text-c-mute">Сессия живёт 12 часов</div>
      </div>
    </div>
  )
}
