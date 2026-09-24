import type { ReactNode } from 'react'
import { fmt } from '../../format'

/** Общие детали страниц кабинета: время, деньги, графики без библиотек. */

export const hm = (t: number | null | undefined) =>
  t ? new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'

export const dayLabel = (t: number) =>
  new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' })

export const METHOD_LABEL: Record<string, string> = { sbp: 'СБП', card: 'Карта', cash: 'Наличные', transfer: 'Перевод' }

const METHOD_COLOR: Record<string, string> = { sbp: '#1B1A17', card: '#8A847A', cash: '#C98A1B' }

/**
 * Выручка по часам: столбики с подписью часа. Сетка — минимум восемь часов
 * подряд, иначе одна оплата рисовалась бы сплошным чёрным блоком на всю ширину.
 */
export function HoursChart({ byHour }: { byHour: { hour: number; amount: number }[] }) {
  if (byHour.length === 0) return <div className="py-6 text-center text-[13px] text-c-mute">Оплат пока не было</div>
  // Ряд с сервера уже упорядочен по времени (смена может перейти полночь) —
  // только дополняем его следующими часами до восьми
  const MIN_SPAN = 8
  const lastHour = byHour[byHour.length - 1].hour
  const pad = Array.from({ length: Math.max(0, MIN_SPAN - byHour.length) }, (_, i) => ({ hour: (lastHour + i + 1) % 24, amount: 0 }))
  const hours = [...byHour, ...pad]
  const max = Math.max(...hours.map(h => h.amount), 1)
  return (
    <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Выручка по часам">
      {hours.map(h => (
        <div key={h.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${h.hour}:00 — ${fmt(h.amount)}`}>
          <div
            className="w-full max-w-9 rounded-t-md"
            style={{ height: `${Math.max(4, (h.amount / max) * 110)}px`, background: h.amount ? '#1B1A17' : '#E6E2DA' }}
          />
          <span className="c-num text-[11px] text-c-mute">{h.hour}</span>
        </div>
      ))}
    </div>
  )
}

/** Способы оплаты одной полосой + легенда. */
export function MethodSplit({ byMethod }: { byMethod: Record<string, number> }) {
  const total = Object.values(byMethod).reduce((s, x) => s + x, 0)
  const keys = Object.keys(byMethod).filter(k => byMethod[k] > 0)
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-c-line2">
        {total > 0 &&
          keys.map(k => (
            <div key={k} style={{ width: `${(byMethod[k] / total) * 100}%`, background: METHOD_COLOR[k] ?? '#6B665E' }} />
          ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
        {Object.keys(byMethod).map(k => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: METHOD_COLOR[k] ?? '#6B665E' }} />
            {METHOD_LABEL[k] ?? k}
            <b className="c-num">{fmt(byMethod[k])}</b>
            {total > 0 && <span className="text-c-mute">{Math.round((byMethod[k] / total) * 100)}%</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Горизонтальные полосы: официанты по выручке. */
export function Bars({ rows }: { rows: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(...rows.map(r => r.value), 1)
  return (
    <div className="flex flex-col gap-3">
      {rows.map(r => (
        <div key={r.label}>
          <div className="flex items-baseline gap-2 text-[14px]">
            <span className="flex-1 truncate">{r.label}</span>
            {r.hint && <span className="text-[12px] text-c-mute">{r.hint}</span>}
            <b className="c-num">{fmt(r.value)}</b>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-c-line2">
            <div className="h-2 rounded-full bg-c-ink" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Строка «подпись — значение» для Z-отчёта и деталей чека. */
export function Row({ label, value, strong = false, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'bad' | 'ok' }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-c-line2 py-2.5 text-[14px] last:border-0">
      <span className="flex-1 text-c-soft">{label}</span>
      <span
        className={`c-num ${strong ? 'text-[16px] font-bold' : ''} ${tone === 'bad' ? 'text-c-bad-ink' : tone === 'ok' ? 'text-c-ok-ink' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

export function Loading({ failed }: { failed: boolean }) {
  return (
    <div className="py-16 text-center text-[14px] text-c-mute">{failed ? 'Не удалось загрузить — проверьте связь' : 'Загружаем…'}</div>
  )
}

/** Статус-плашка чека: одинаковые цвета в реестре, карточке и очереди решений. */
export type CheckStatus = 'ok' | 'debt' | 'refund' | 'cancel' | 'open'

const CST: Record<CheckStatus, { label: string; bg: string; fg: string }> = {
  ok: { label: 'Оплачен', bg: '#E4F0E6', fg: '#22613D' },
  debt: { label: 'Долг', bg: '#FBE9E4', fg: '#9E2E17' },
  refund: { label: 'Возврат', bg: '#FBF1DC', fg: '#7A5306' },
  cancel: { label: 'Есть отмены', bg: '#F1EEE8', fg: '#4A463F' },
  open: { label: 'Открыт', bg: '#EEF3FA', fg: '#2D5A8A' }
}

export function StatusTag({ status, label }: { status: CheckStatus; label?: string }) {
  const s = CST[status]
  return (
    <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>
      {label ?? s.label}
    </span>
  )
}
