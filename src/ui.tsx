import type { CSSProperties, ReactNode } from 'react'
import { NAVY } from './data'

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
        border: 'none',
        borderRadius: 50,
        background: NAVY,
        color: '#fff',
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
        border: '1px solid #DDDDE2',
        borderRadius: 50,
        background: '#fff',
        color: NAVY,
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
    <div style={{ background: '#fff', border: '1px solid #ECECEF', borderRadius: 18, ...style }}>{children}</div>
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
        color: '#9A9AA4',
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
        borderRadius: 14,
        padding: '12px 14px'
      }}
    >
      {children}
    </div>
  )
}

export function BottomSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,11,18,.45)' }} />
      <div
        className="ep-fade-in"
        style={{
          position: 'relative',
          background: '#fff',
          borderRadius: '28px 28px 0 0',
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}>
          <div style={{ width: 40, height: 4, borderRadius: 4, background: '#E0E0E4' }} />
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toast({ msg }: { msg: string }) {
  return (
    <div
      className="ep-fade-in"
      style={{
        position: 'fixed',
        left: 20,
        right: 20,
        bottom: 'calc(24px + env(safe-area-inset-bottom))',
        zIndex: 60,
        background: NAVY,
        color: '#fff',
        borderRadius: 16,
        padding: '13px 18px',
        fontSize: 14,
        fontWeight: 540,
        textAlign: 'center',
        boxShadow: '0 10px 30px rgba(20,18,45,.35)'
      }}
    >
      {msg}
    </div>
  )
}

export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '12px 20px',
        paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        background: '#fff',
        borderTop: '1px solid #F0F0F2',
        display: 'flex',
        flexDirection: 'column',
        gap: 9
      }}
    >
      {children}
    </div>
  )
}
