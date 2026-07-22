import { useState } from 'react'
import { NAVY } from '../data'
import { Avatar } from '../avatars'
import { BottomSheet, PrimaryButton, WarnBanner } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

export function SendSheet() {
  const { state, dispatch, totals } = useStore()
  const [sending, setSending] = useState(false)
  const me = state.me
  if (!me) return null

  const unsentCount = state.lines.filter(l => !l.sent).length
  const close = () => dispatch({ type: 'patch', patch: { sheet: null } })
  const scope = state.sendScope
  const checked = state.sendChecked
  const gated = scope === 'all' && !checked

  const send = () => {
    setSending(true)
    setTimeout(() => {
      dispatch({ type: 'sendWave' })
      dispatch({ type: 'patch', patch: { sheet: null, screen: 'status' } })
    }, 1400)
  }

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '13px 14px',
    borderRadius: 16,
    cursor: 'pointer',
    background: '#fff',
    border: active ? `2px solid ${NAVY}` : '1px solid #ECECEF'
  })
  const dotStyle = (active: boolean): React.CSSProperties => ({
    width: 20,
    height: 20,
    borderRadius: '50%',
    flexShrink: 0,
    border: active ? `6px solid ${NAVY}` : '2px solid #CFCFD6',
    background: '#fff',
    boxSizing: 'border-box'
  })

  if (sending) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(255,255,255,.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <div className="ep-spin" style={{ width: 56, height: 56, borderRadius: '50%', border: '5px solid #ECECEF', borderTopColor: NAVY }} />
        <div style={{ fontWeight: 600, fontSize: 18 }}>Передаём на кухню…</div>
      </div>
    )
  }

  return (
    <BottomSheet onClose={close}>
      <div style={{ padding: '0 22px', paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontWeight: 680, fontSize: 22, letterSpacing: '-0.5px', marginBottom: 16 }}>Отправить заказ на кухню?</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 14 }}>
          <div style={rowStyle(scope === 'mine')} onClick={() => dispatch({ type: 'patch', patch: { sendScope: 'mine' } })}>
            <div style={dotStyle(scope === 'mine')} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Отправить мой заказ</div>
              <div style={{ fontSize: 12, color: '#8A8A92', marginTop: 2 }}>
                {me.name} · {unsentCount} поз. · {fmt(totals.myOwn + totals.myShare)}
              </div>
            </div>
          </div>
          <div style={rowStyle(scope === 'all')} onClick={() => dispatch({ type: 'patch', patch: { sendScope: 'all' } })}>
            <div style={dotStyle(scope === 'all')} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Отправить за весь стол</div>
              <div style={{ fontSize: 12, color: '#8A8A92', marginTop: 2 }}>все позиции + общие · {fmt(totals.tableTotal)}</div>
            </div>
          </div>
        </div>

        {scope === 'all' && (
          <div style={{ marginBottom: 14 }}>
            <WarnBanner>
              <Avatar animal="bear" size={26} />
              <span style={{ fontSize: 13, color: '#7A5A12', lineHeight: 1.4 }}>
                <b style={{ fontWeight: 640 }}>Дима</b> ещё дозаказывает. Все точно выбрали?
              </span>
            </WarnBanner>
          </div>
        )}

        {scope === 'all' && (
          <div onClick={() => dispatch({ type: 'patch', patch: { sendChecked: !checked } })} style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18, cursor: 'pointer' }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                background: checked ? NAVY : '#fff',
                color: '#fff',
                border: checked ? 'none' : '2px solid #CFCFD6'
              }}
            >
              ✓
            </div>
            <span style={{ fontSize: 14.5 }}>Я всё выбрал(а), отправляем за всех</span>
          </div>
        )}

        <PrimaryButton onClick={send} disabled={gated} style={{ minHeight: 54, marginBottom: 8 }}>
          Отправить
        </PrimaryButton>
        <button onClick={close} style={{ width: '100%', minHeight: 44, border: 'none', background: 'transparent', color: '#8A8A92', fontWeight: 520, fontSize: 15, cursor: 'pointer' }}>
          Ещё подумаю
        </button>
      </div>
    </BottomSheet>
  )
}
