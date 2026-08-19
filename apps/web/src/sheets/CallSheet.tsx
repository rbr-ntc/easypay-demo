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
      <div style={{ padding: '0 22px', paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontWeight: 680, fontSize: 22, letterSpacing: '-0.5px', marginBottom: 6 }}>
          Позвать официанта
        </div>
        {waiter && (
          <div style={{ fontSize: 13.5, color: 'var(--ep-muted)', marginBottom: 16 }}>
            К вашему столу подойдёт {waiter}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
          {REASONS.map(r => {
            const on = reason === r.id
            return (
              <button
                key={r.id}
                onClick={() => setReason(r.id)}
                style={{
                  textAlign: 'left',
                  padding: '13px 14px',
                  borderRadius: 'var(--ep-r-card)',
                  background: 'var(--ep-surface)',
                  border: on ? '2px solid var(--ep-ink, #101828)' : '1px solid var(--ep-border)',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>{r.label}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ep-muted)', marginTop: 2 }}>{r.hint}</div>
              </button>
            )
          })}
        </div>

        <textarea
          value={note}
          onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
          placeholder="Можно написать словами — например, про аллергию"
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 14px',
            borderRadius: 'var(--ep-r-card)',
            border: '1px solid var(--ep-border)',
            background: 'var(--ep-surface)',
            fontSize: 15,
            fontFamily: 'inherit',
            resize: 'none',
            marginBottom: 16
          }}
        />

        <PrimaryButton onClick={() => void send()} disabled={busy} style={{ minHeight: 54, marginBottom: 8 }}>
          Позвать
        </PrimaryButton>
        <button
          onClick={close}
          style={{
            width: '100%',
            minHeight: 44,
            border: 'none',
            background: 'transparent',
            color: 'var(--ep-muted)',
            fontWeight: 520,
            fontSize: 15,
            cursor: 'pointer'
          }}
        >
          Не сейчас
        </button>
      </div>
    </BottomSheet>
  )
}
