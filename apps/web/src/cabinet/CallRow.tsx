import { useState } from 'react'
import { CALL_LABEL } from '@easypay/domain/hall'
import type { ServerCall } from '../api'
import { fmtDur } from '../waiter/duration'

/** Быстрые ответы: одно нажатие — и гость знает, чего ждать. */
const QUICK: { label: string; reply: string | null }[] = [
  { label: 'Иду', reply: null },
  { label: 'Через 2 мин', reply: 'Подойду через 2 минуты' },
  { label: 'Уточню на кухне', reply: 'Уточню на кухне и вернусь' }
]

/** Готовые фразы в форме ответа — чтобы не печатать на бегу. */
const PHRASES = ['Уже несу', 'Через 5 минут', 'Горячее будет через 10 минут', 'Сейчас подойду с терминалом']

export interface CallGroup {
  personaId: string
  name: string
  /** Все открытые вызовы гостя: у старых столов их могло быть несколько. */
  ids: string[]
  reason: string
  note: string | null
  at: number
  repeats: number
}

/** Один гость — одна строка, сколько бы раз он ни нажал (смена №6, В1). */
export function groupCalls(calls: ServerCall[], nameOf: (id: string) => string): CallGroup[] {
  const groups = new Map<string, CallGroup>()
  for (const c of calls) {
    const prev = groups.get(c.personaId)
    const repeats = c.repeats ?? 1
    groups.set(
      c.personaId,
      prev
        ? {
            ...prev,
            ids: c.id ? [...prev.ids, c.id] : prev.ids,
            reason: c.reason === 'bill' ? 'bill' : prev.reason,
            note: c.note ?? prev.note,
            at: Math.min(prev.at, c.at),
            repeats: prev.repeats + repeats
          }
        : {
            personaId: c.personaId,
            name: c.name ?? nameOf(c.personaId),
            ids: c.id ? [c.id] : [],
            reason: c.reason,
            note: c.note ?? null,
            at: c.at,
            repeats
          }
    )
  }
  return [...groups.values()].sort((a, b) => a.at - b.at)
}

/**
 * Строка вызова в столе. «Ответить…» раскрывает форму прямо здесь — раньше
 * это было системное окно браузера, чужое и блокирующее страницу (смена №6, В2).
 */
export function CallRow({
  group,
  now,
  canAck,
  busy,
  onAck
}: {
  group: CallGroup
  now: number
  canAck: boolean
  busy: boolean
  onAck: (reply: string | null) => Promise<boolean>
}) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')

  const send = async (reply: string | null) => {
    const done = await onAck(reply)
    if (done) {
      setWriting(false)
      setText('')
    }
  }

  return (
    <div className="rounded-2xl border border-c-bad-line bg-c-bad-bg px-4.5 py-3.5">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="size-2.5 rounded-full bg-c-bad" />
        <span className="min-w-0 flex-1 text-[15px]">
          <b>{group.name}</b> {group.note ? `: ${group.note}` : (CALL_LABEL[group.reason] ?? CALL_LABEL.help)}
          {group.repeats > 1 && <span className="ml-2 rounded-full bg-c-bad px-2 py-0.5 text-[12px] font-bold text-white">×{group.repeats}</span>}
        </span>
        <span className="c-num text-[13px] font-bold text-c-bad-ink">{fmtDur(now - group.at)}</span>
        {canAck && !writing && (
          <span className="flex flex-wrap justify-end gap-1.5">
            {QUICK.map(q => (
              <button
                key={q.label}
                disabled={busy}
                onClick={() => void send(q.reply)}
                className={`h-10 rounded-xl px-3.5 text-[14px] disabled:opacity-50 ${q.reply ? 'border border-c-line bg-c-card' : 'bg-c-ink font-bold text-white'}`}
              >
                {q.label}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => setWriting(true)}
              className="h-10 rounded-xl border border-c-line bg-c-card px-3.5 text-[14px] disabled:opacity-50"
            >
              Ответить…
            </button>
          </span>
        )}
      </div>

      {canAck && writing && (
        <form
          className="mt-3"
          onSubmit={e => {
            e.preventDefault()
            if (text.trim()) void send(text.trim())
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            {PHRASES.map(p => (
              <button key={p} type="button" onClick={() => setText(p)} className="h-8 rounded-full border border-c-line bg-c-card px-3 text-[13px]">
                {p}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              value={text}
              maxLength={120}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setWriting(false)}
              placeholder={`Ответ для ${group.name}`}
              aria-label={`Ответ для ${group.name}`}
              className="h-10 min-w-0 flex-1 rounded-xl border border-c-line bg-c-card px-3 text-[14px] outline-none focus:border-c-ink"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="h-10 rounded-xl bg-c-ink px-4 text-[14px] font-bold text-white disabled:opacity-50"
            >
              Отправить
            </button>
            <button type="button" onClick={() => setWriting(false)} className="h-10 rounded-xl px-3 text-[14px] text-c-mute">
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
