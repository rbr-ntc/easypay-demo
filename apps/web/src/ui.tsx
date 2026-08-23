import type { CSSProperties, ReactNode } from 'react'

/**
 * Общие примитивы на daisyUI.
 *
 * Раньше каждый из них рисовал себя инлайн-стилями поверх токенов `--ep-*`.
 * Теперь внешний вид задают классы daisyUI, а тема (`light` / `dark`) решает,
 * какими они окажутся. Пропс `style` сохранён: экраны, которые ещё правят
 * отступы точечно, продолжают работать, пока их не перевели.
 */

export function PrimaryButton({
  children,
  onClick,
  style,
  className = '',
  disabled
}: {
  children: ReactNode
  onClick?: () => void
  style?: CSSProperties
  className?: string
  disabled?: boolean
}) {
  // Главное действие экрана — единственное место, где уместен primary
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-primary btn-block btn-lg ${className}`}
      style={style}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  style,
  className = ''
}: {
  children: ReactNode
  onClick?: () => void
  style?: CSSProperties
  className?: string
}) {
  return (
    <button onClick={onClick} className={`btn btn-block ${className}`} style={style}>
      {children}
    </button>
  )
}

export function Card({
  children,
  style,
  className = ''
}: {
  children: ReactNode
  style?: CSSProperties
  className?: string
}) {
  return (
    <div className={`card card-border bg-base-100 ${className}`} style={style}>
      {children}
    </div>
  )
}

/** Надпись-метка над блоком: капсом, разрядкой и приглушённым цветом. */
export function Mono({
  children,
  style,
  className = ''
}: {
  children: ReactNode
  style?: CSSProperties
  className?: string
}) {
  return (
    <div className={`font-mono text-xs uppercase tracking-widest text-base-content/60 ${className}`} style={style}>
      {children}
    </div>
  )
}

export function WarnBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="alert alert-warning alert-soft">
      {children}
    </div>
  )
}

export function BottomSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  // modal-bottom прижимает лист к низу экрана, а на широком экране daisyUI сам
  // держит его в разумной ширине — раньше это делал отдельный класс ep-sheet-panel
  return (
    <div className="modal modal-open modal-bottom" role="dialog">
      <div className="modal-box max-h-[90%] p-0 pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-center p-2.5">
          <div className="h-1 w-10 rounded-full bg-base-300" />
        </div>
        {children}
      </div>
      <form method="dialog" className="modal-backdrop" onClick={onClose}>
        <button type="button">Закрыть</button>
      </form>
    </div>
  )
}

export function Toast({ msg }: { msg: string }) {
  return (
    <div className="toast toast-top toast-center z-60 w-[min(calc(100%-2.5rem),27.5rem)]">
      <div className="alert alert-neutral justify-center text-center">
        <span>{msg}</span>
      </div>
    </div>
  )
}

export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-base-300 bg-base-100 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      {children}
    </div>
  )
}
