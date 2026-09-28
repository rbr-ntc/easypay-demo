import { useEffect, useRef, type ReactNode } from 'react'

/** Фильтр-чип: зоны зала, фильтры чеков, вкладки журнала. */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-9 rounded-full px-3.5 text-[13px] whitespace-nowrap ${
        on ? 'bg-c-ink text-white' : 'border border-c-line bg-c-card text-c-ink'
      }`}
    >
      {children}
    </button>
  )
}

/** Тумблер: стоп-лист, настройки. Зелёный — «включено». */
export function Toggle({
  on,
  onClick,
  label,
  danger = false,
  disabled = false
}: {
  on: boolean
  onClick: () => void
  label: string
  /** Для стоп-листа «включено» значит «в стопе» — красный. */
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{ background: on ? (danger ? '#B03A1E' : '#2E8A55') : '#D8D3CA' }}
    >
      <span
        className="absolute top-0.75 size-4.5 rounded-full bg-white transition-[left]"
        style={{ left: on ? 19 : 3, boxShadow: '0 1px 2px rgba(0,0,0,.2)' }}
      />
    </button>
  )
}

/** Окно подтверждения: закрыть стол с оговорками, списать долг. */
export function Confirm({
  title,
  body,
  ok,
  danger = false,
  busy = false,
  onOk,
  onCancel
}: {
  title: string
  body: ReactNode
  ok: string
  danger?: boolean
  busy?: boolean
  onOk: () => void
  onCancel: () => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)
  // Колбэк — через ref: окно с полем ввода перерисовывается на каждую букву,
  // и эффект с зависимостью от стрелки уводил бы фокус из поля на кнопку
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    const dialog = okRef.current?.closest('[role="alertdialog"]')
    const field = dialog?.querySelector<HTMLElement>('textarea, input')
    ;(field ?? okRef.current)?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <div onClick={onCancel} className="fixed inset-0 z-30" style={{ background: 'rgba(27,26,23,.35)' }} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="c-fade fixed top-1/2 left-1/2 z-31 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[20px] bg-c-card p-6"
        style={{ boxShadow: '0 30px 60px -20px rgba(0,0,0,.4)' }}
      >
        <div className="text-[20px] font-bold">{title}</div>
        <div className="mt-2 text-[15px] leading-normal text-c-soft">{body}</div>
        <div className="mt-5 flex gap-2">
          <button onClick={onCancel} className="h-11 flex-1 rounded-xl border border-c-line bg-c-card text-[15px]">
            Отмена
          </button>
          <button
            ref={okRef}
            onClick={onOk}
            disabled={busy}
            className="h-11 flex-1 rounded-xl text-[15px] font-bold text-white disabled:opacity-50"
            style={{ background: danger ? '#B03A1E' : '#1B1A17' }}
          >
            {busy ? 'Секунду…' : ok}
          </button>
        </div>
      </div>
    </>
  )
}

export function CToast({ msg }: { msg: string }) {
  return (
    <div
      role="status"
      className="c-fade fixed top-5 left-1/2 z-40 max-w-[92vw] -translate-x-1/2 rounded-2xl bg-c-ink px-4.5 py-3 text-[15px] text-white"
      style={{ boxShadow: '0 16px 40px -16px rgba(0,0,0,.5)' }}
    >
      {msg}
    </div>
  )
}

/** Карточка-блок: белая, с тонкой рамкой. */
export function Panel({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`c-card overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex h-11 items-center gap-3 border-b border-c-line2 px-4.5">
          <span className="flex-1 text-[13px] font-bold text-c-mute">{title}</span>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'bad' | 'ok' }) {
  return (
    <div className="rounded-[14px] bg-c-chip p-3.5">
      <div className="text-[12px] text-c-mute">{label}</div>
      <div
        className={`c-num mt-1 text-[20px] font-bold ${tone === 'bad' ? 'text-c-bad-ink' : tone === 'ok' ? 'text-c-ok-ink' : ''}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-c-mute">{hint}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-c-off px-4 py-8 text-center text-[13px] text-c-mute">
      {children}
    </div>
  )
}
