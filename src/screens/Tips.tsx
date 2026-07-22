import { NAVY, WAITER_NAME } from '../data'
import { PrimaryButton, StickyFooter } from '../ui'
import { useStore, tipAmount } from '../store'
import { fmt } from '../format'

const PRESETS: { v: '0' | '5' | '10' | '15' | 'custom'; label: string; popular?: boolean }[] = [
  { v: '5', label: '5%' },
  { v: '10', label: '10%', popular: true },
  { v: '15', label: '15%' },
  { v: 'custom', label: 'Своя' }
]

export function Tips() {
  const { state, dispatch } = useStore()
  const paidNow = state.paidAmount
  const tip = tipAmount(state, paidNow)

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '24px 24px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#E4F6EA', color: '#1F9D55', borderRadius: 50, padding: '7px 14px', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
            ✓ Оплачено · {fmt(paidNow)}
          </div>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: '50%',
              marginBottom: 14,
              background: 'linear-gradient(135deg,#E7EFFD,#C9D8F4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 38
            }}
          >
            👨‍🍳
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #ECECEF', borderRadius: 50, padding: '5px 12px', marginBottom: 16 }}>
            <span style={{ color: '#F4B400', fontSize: 13 }}>★</span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>4.9</span>
            <span style={{ fontSize: 12.5, color: '#9A9AA4' }}>· официант {WAITER_NAME}</span>
          </div>
          <div style={{ fontWeight: 300, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.9px' }}>
            Поблагодарить
            <br />
            официанта?
          </div>
        </div>

        <div style={{ display: 'flex', gap: 9, marginBottom: 16 }}>
          {PRESETS.map(p => (
            <button
              key={p.v}
              onClick={() => dispatch({ type: 'patch', patch: { tip: p.v } })}
              style={{
                position: 'relative',
                flex: 1,
                textAlign: 'center',
                padding: '15px 6px',
                borderRadius: 16,
                cursor: 'pointer',
                fontWeight: state.tip === p.v ? 600 : 480,
                fontSize: 16,
                background: state.tip === p.v ? NAVY : '#F2F2F4',
                color: state.tip === p.v ? '#fff' : '#3A3A42',
                border: 'none'
              }}
            >
              {p.popular && (
                <span style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', fontFamily: 'ui-monospace, monospace', fontSize: 8, textTransform: 'uppercase', background: '#1F9D55', color: '#fff', padding: '2px 7px', borderRadius: 50, whiteSpace: 'nowrap' }}>
                  популярно
                </span>
              )}
              {p.label}
            </button>
          ))}
        </div>

        {state.tip === 'custom' && (
          <div style={{ background: '#fff', border: '1px solid #ECECEF', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <input
              placeholder="Введите сумму"
              inputMode="numeric"
              value={state.tipCustom || ''}
              onChange={e => dispatch({ type: 'patch', patch: { tipCustom: Number(e.target.value.replace(/\D/g, '')) || 0 } })}
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 18, fontWeight: 540, color: '#1F1D3D' }}
            />
            <span style={{ fontSize: 18, color: '#9A9AA4' }}>₽</span>
          </div>
        )}

        {tip > 0 && <div style={{ textAlign: 'center', fontWeight: 300, fontSize: 42, letterSpacing: '-1.4px', margin: '6px 0 10px' }}>{fmt(tip)}</div>}

        <div style={{ textAlign: 'center', fontSize: 12.5, color: '#9A9AA4' }}>Чаевые поступают напрямую официанту</div>
      </div>

      <StickyFooter>
        <PrimaryButton onClick={() => dispatch({ type: 'patch', patch: { screen: 'done' } })} style={{ fontSize: 17 }}>
          {tip > 0 ? `Оставить ${fmt(tip)}` : 'Оставить чаевые'}
        </PrimaryButton>
        <button
          onClick={() => dispatch({ type: 'patch', patch: { tip: '0', screen: 'done' } })}
          style={{ width: '100%', minHeight: 44, border: 'none', background: 'transparent', color: '#8A8A92', fontWeight: 520, fontSize: 15, cursor: 'pointer' }}
        >
          Пропустить
        </button>
      </StickyFooter>
    </div>
  )
}
