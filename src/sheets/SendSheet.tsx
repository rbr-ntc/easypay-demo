import { useState } from 'react'
import { NAVY, findDish } from '../data'
import { Avatar } from '../avatars'
import { BottomSheet, PrimaryButton, WarnBanner } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

export function SendSheet() {
  const { ui, patch, me, snap, sendWave } = useStore()
  const [sending, setSending] = useState(false)
  if (!me || !snap) return null

  const price = (l: { dishId: string; qty: number }) => (findDish(l.dishId)?.price ?? 0) * l.qty
  const unsentMine = snap.lines.filter(l => !l.sent && l.personaId === me.id)
  const alreadySent = snap.lines.filter(l => l.sent)
  const unsentAll = snap.lines.filter(l => !l.sent)
  const unsentOthers = unsentAll.filter(l => l.personaId !== me.id)
  // Кто ещё не отправил свои блюда (реальные гости, не боты)
  const stillChoosing = snap.personas.filter(p => p.id !== me.id && unsentOthers.some(l => l.personaId === p.id))

  const close = () => patch({ sheet: null })
  const scope = ui.sendScope
  const checked = ui.sendChecked
  const gated = scope === 'all' && stillChoosing.length > 0 && !checked

  const send = async () => {
    setSending(true)
    await sendWave(scope)
    setTimeout(() => {
      patch({ sheet: null, screen: 'status' })
    }, 1200)
  }

  const rowStyle = (active: boolean, disabled = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '13px 14px',
    borderRadius: 16,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
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
          <div
            style={rowStyle(scope === 'mine', unsentMine.length === 0)}
            onClick={() => unsentMine.length > 0 && patch({ sendScope: 'mine' })}
          >
            <div style={dotStyle(scope === 'mine')} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Отправить мой заказ</div>
              <div style={{ fontSize: 12, color: '#8A8A92', marginTop: 2 }}>
                {me.name} · {unsentMine.length} поз. · {fmt(unsentMine.reduce((s, l) => s + price(l), 0))}
              </div>
            </div>
          </div>
          <div style={rowStyle(scope === 'all')} onClick={() => patch({ sendScope: 'all' })}>
            <div style={dotStyle(scope === 'all')} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Отправить за весь стол</div>
              <div style={{ fontSize: 12, color: '#8A8A92', marginTop: 2 }}>
                {unsentAll.length} поз. · {fmt(unsentAll.reduce((s, l) => s + price(l), 0))}
              </div>
            </div>
          </div>
        </div>

        {scope === 'all' && stillChoosing.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <WarnBanner>
              <Avatar animal={stillChoosing[0].animal} size={26} />
              <span style={{ fontSize: 13, color: '#7A5A12', lineHeight: 1.4 }}>
                <b style={{ fontWeight: 640 }}>{stillChoosing.map(p => p.name).join(', ')}</b> ещё{' '}
                {stillChoosing.length === 1 ? 'выбирает' : 'выбирают'}. Все точно готовы?
              </span>
            </WarnBanner>
          </div>
        )}

        {scope === 'all' && stillChoosing.length > 0 && (
          <div onClick={() => patch({ sendChecked: !checked })} style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18, cursor: 'pointer' }}>
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

        {alreadySent.length > 0 && (
          <div style={{ fontSize: 12.5, color: '#9A9AA4', marginBottom: 14 }}>
            Уже на кухне (не отправится повторно):{' '}
            {alreadySent.map(l => findDish(l.dishId)?.name ?? '?').join(', ')}
          </div>
        )}

        <PrimaryButton onClick={() => void send()} disabled={gated || unsentAll.length === 0} style={{ minHeight: 54, marginBottom: 8 }}>
          Отправить
        </PrimaryButton>
        <button onClick={close} style={{ width: '100%', minHeight: 44, border: 'none', background: 'transparent', color: '#8A8A92', fontWeight: 520, fontSize: 15, cursor: 'pointer' }}>
          Ещё подумаю
        </button>
      </div>
    </BottomSheet>
  )
}
