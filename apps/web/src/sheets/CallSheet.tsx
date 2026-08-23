import { useState } from 'react'
import { BottomSheet, PrimaryButton } from '../ui'
import { useStore } from '../store'

/**
 * Зачем позвали официанта. Сервер различает «нужна помощь», «счёт» и «воды»
 * и принимает текст — а у гостя была одна кнопка на всё, поэтому официант
 * приходил вслепую и тратил второй заход. Плюс это единственный способ
 * сказать «у меня аллергия» до того, как еда приехала.
 */
const REASONS: { id: 'help' | 'bill' | 'water'; label: string; hint: string }[] = [
  { id: 'help', label: 'Нужна помощь', hint: 'подойдите, есть вопрос' },
  { id: 'bill', label: 'Принесите счёт', hint: 'мы готовы рассчитаться' },
  { id: 'water', label: 'Воды, пожалуйста', hint: 'графин на стол' }
]

const NOTE_MAX = 200

export function CallSheet() {
  const { patch, callWaiter, snap } = useStore()
  const [reason, setReason] = useState<'help' | 'bill' | 'water'>('help')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => patch({ sheet: null })
  const send = async () => {
    if (busy) return
    setBusy(true)
    await callWaiter(reason, note.trim() || undefined)
    patch({ sheet: null })
  }

  const waiter = snap?.waiter?.name

  return (
    <BottomSheet onClose={close}>
      <div className="px-5 pb-[calc(1.625rem+env(safe-area-inset-bottom))]">
        <div className="mb-1.5 text-2xl font-bold tracking-tight">Позвать официанта</div>
        {waiter && <div className="mb-4 text-sm text-base-content/60">К вашему столу подойдёт {waiter}</div>}

        <div className="mb-4 flex flex-col gap-2.5">
          {REASONS.map(r => {
            const on = reason === r.id
            return (
              <label
                key={r.id}
                className={`flex cursor-pointer items-center gap-3 rounded-box border bg-base-100 p-3.5 ${
                  on ? 'border-primary border-2' : 'border-base-300'
                }`}
              >
                <input
                  type="radio"
                  name="call-reason"
                  className="radio radio-primary"
                  checked={on}
                  onChange={() => setReason(r.id)}
                />
                <div className="flex-1">
                  <div className="font-semibold">{r.label}</div>
                  <div className="text-xs text-base-content/60">{r.hint}</div>
                </div>
              </label>
            )
          })}
        </div>

        <textarea
          className="textarea mb-4 w-full"
          value={note}
          onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
          placeholder="Можно написать словами — например, про аллергию"
          rows={3}
        />

        <PrimaryButton className="mb-2" onClick={() => void send()} disabled={busy}>
          Позвать
        </PrimaryButton>
        <button className="btn btn-ghost btn-block" onClick={close}>
          Не сейчас
        </button>
      </div>
    </BottomSheet>
  )
}
