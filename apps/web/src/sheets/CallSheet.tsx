import { useState } from 'react'
import { useStore } from '../store'

/**
 * Зачем позвали официанта. Сервер различает «нужна помощь», «счёт» и «воды»
 * и принимает текст — с одной кнопкой на всё официант приходил вслепую и
 * тратил второй заход. Плюс это единственный способ сказать «у меня
 * аллергия» до того, как еда приехала.
 *
 * В 4.x шторку сначала убрали вслед за макетом, где «Официант» звал сразу, —
 * и причины с текстом стало не передать. Вернули в новом виде.
 */
const REASONS: { id: 'help' | 'bill' | 'water'; label: string; hint: string }[] = [
  { id: 'help', label: 'Подойдите, пожалуйста', hint: 'есть вопрос или просьба' },
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
    <>
      <div onClick={close} className="g-anim-fade absolute inset-0 z-20" style={{ background: 'rgba(20,14,8,.5)' }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Позвать официанта"
        className="g-anim-up absolute right-0 bottom-0 left-0 z-[21] max-h-[92%] overflow-y-auto rounded-t-[28px] bg-g-paper px-5 pt-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <h2 className="g-serif text-[34px] text-g-fg">позвать официанта</h2>
        {waiter && <p className="mt-2 text-[15px] text-g-mute">К вашему столу подойдёт {waiter}</p>}

        <div className="mt-4 overflow-hidden rounded-3xl bg-g-s1" role="radiogroup" aria-label="Зачем зовёте">
          {REASONS.map((r, i) => {
            const on = reason === r.id
            return (
              <button
                key={r.id}
                role="radio"
                aria-checked={on}
                onClick={() => setReason(r.id)}
                className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left text-g-fg"
                style={i ? { borderTop: '1px solid rgba(255,255,255,.1)' } : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{r.label}</span>
                  <span className="block text-[13px] text-g-mute">{r.hint}</span>
                </span>
                <span
                  className="size-5.5 shrink-0 rounded-full"
                  style={{ border: on ? '7px solid var(--g-acc)' : '1.5px solid #6E685F' }}
                />
              </button>
            )
          })}
        </div>

        <textarea
          value={note}
          onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
          placeholder="Можно написать словами — например, про аллергию"
          aria-label="Что передать официанту"
          rows={3}
          className="mt-3 w-full resize-none rounded-[20px] bg-g-s1 px-4 py-3 text-[15px] text-g-fg outline-none placeholder:text-g-mute focus:ring-2 focus:ring-g-acc"
          style={{ border: '1px solid rgba(255,255,255,.1)' }}
        />

        <button
          onClick={() => void send()}
          disabled={busy}
          className="g-cta mt-4 h-14 w-full rounded-full text-[17px] disabled:opacity-40"
        >
          {busy ? 'Зовём…' : 'Позвать'}
        </button>
        <button onClick={close} className="mt-1 h-12 w-full text-[15px] text-g-mute">
          Не сейчас
        </button>
      </div>
    </>
  )
}
