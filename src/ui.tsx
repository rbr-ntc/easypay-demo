import type { CSSProperties, ReactNode } from 'react'

export function PrimaryButton({
  children,
  onClick,
  style,
  disabled
}: {
  children: ReactNode
  onClick?: () => void
  style?: CSSProperties
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="ep-press"
      style={{
        width: '100%',
        minHeight: 56,
        border: 'var(--ep-btn-border)' as never,
        borderRadius: 'var(--ep-r-pill)',
        background: 'var(--ep-btn-bg)',
        color: 'var(--ep-btn-fg)',
        textTransform: 'var(--ep-btn-tt)' as never,
        letterSpacing: 'var(--ep-btn-ls)',
        fontWeight: 600,
        fontSize: 16,
        cursor: 'pointer',
        opacity: disabled ? 0.45 : 1,
        ...style
      }}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  style
}: {
  children: ReactNode
  onClick?: () => void
  style?: CSSProperties
}) {
  return (
    <button
      onClick={onClick}
      className="ep-press"
      style={{
        width: '100%',
        minHeight: 52,
        border: '1px solid var(--ep-ghost-border)',
        borderRadius: 'var(--ep-r-pill)',
        background: 'var(--ep-ghost-bg)',
        color: 'var(--ep-ink)',
        textTransform: 'var(--ep-btn-tt)' as never,
        letterSpacing: 'var(--ep-btn-ls)',
        fontWeight: 540,
        fontSize: 15,
        cursor: 'pointer',
        ...style
      }}
    >
      {children}
    </button>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: 'var(--ep-surface)', border: '1px solid var(--ep-border)', borderRadius: 'var(--ep-r-card)', ...style }}>{children}</div>
  )
}

export function Mono({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 10.5,
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
        color: 'var(--ep-muted)',
        ...style
      }}
    >
      {children}
    </div>
  )
}

export function WarnBanner({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: '#FFF6E6',
        border: '1px solid #F4E2BD',
        borderRadius: 'var(--ep-r-sm)',
        padding: '12px 14px'
      }}
    >
      {children}
    </div>
  )
}

export function BottomSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  // На десктопе шит не растягивается на весь экран, а держит ширину гостевой колонки
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,11,18,.45)' }} />
      <div
        className="ep-fade-in"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 480,
          background: 'var(--ep-opaque)',
          borderRadius: 'var(--ep-r-lg) var(--ep-r-lg) 0 0',
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}>
          <div style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--ep-border)' }} />
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toast({ msg }: { msg: string }) {
  // Центрирование — контейнером, а не transform: анимация ep-fade сама
  // управляет transform и перезаписала бы translateX(-50%)
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        top: 'calc(14px + env(safe-area-inset-top))',
        zIndex: 60,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none'
      }}
    >
      <div
        className="ep-fade-in"
        style={{
          width: 'min(calc(100% - 40px), 440px)',
          background: 'var(--ep-ink)',
          color: 'var(--ep-on-ink)',
          borderRadius: 'var(--ep-r-card)',
          padding: '13px 18px',
          fontSize: 14,
          fontWeight: 540,
          textAlign: 'center',
          boxShadow: '0 10px 30px rgba(20,18,45,.35)'
        }}
      >
        {msg}
      </div>
    </div>
  )
}

export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '12px 20px',
        paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        background: 'var(--ep-opaque)',
        borderTop: '1px solid var(--ep-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 9
      }}
    >
      {children}
    </div>
  )
}
