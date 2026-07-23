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
  const { ui, patch } = useStore()
  const paidNow = ui.lastPaid
  const tip = tipAmount(ui)

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '24px 24px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#E4F6EA', color: '#1F9D55', borderRadius: 'var(--ep-r-pill)', padding: '7px 14px', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--ep-surface)', border: '1px solid var(--ep-border)', borderRadius: 'var(--ep-r-pill)', padding: '5px 12px', marginBottom: 16 }}>
            <span style={{ color: '#F4B400', fontSize: 13 }}>★</span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>4.9</span>
            <span style={{ fontSize: 12.5, color: 'var(--ep-muted)' }}>· официант {WAITER_NAME}</span>
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
              onClick={() => patch({ tip: p.v })}
              style={{
                position: 'relative',
                flex: 1,
                textAlign: 'center',
                padding: '15px 6px',
                borderRadius: 'var(--ep-r-card)',
                cursor: 'pointer',
                fontWeight: ui.tip === p.v ? 600 : 480,
                fontSize: 16,
                background: ui.tip === p.v ? NAVY : 'var(--ep-soft)',
                color: ui.tip === p.v ? 'var(--ep-on-ink)' : 'var(--ep-text-2)',
                border: 'none'
              }}
            >
              {p.popular && (
                <span style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', fontFamily: 'ui-monospace, monospace', fontSize: 8, textTransform: 'uppercase', background: '#1F9D55', color: 'var(--ep-on-ink)', padding: '2px 7px', borderRadius: 'var(--ep-r-pill)', whiteSpace: 'nowrap' }}>
                  популярно
                </span>
              )}
              {p.label}
            </button>
          ))}
        </div>

        {ui.tip === 'custom' && (
          <div style={{ background: 'var(--ep-surface)', border: '1px solid var(--ep-border)', borderRadius: 'var(--ep-r-card)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <input
              placeholder="Введите сумму"
              inputMode="numeric"
              value={ui.tipCustom || ''}
              onChange={e => patch({ tipCustom: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 18, fontWeight: 540, color: 'var(--ep-ink)' }}
            />
            <span style={{ fontSize: 18, color: 'var(--ep-muted)' }}>₽</span>
          </div>
        )}

        {tip > 0 && <div style={{ textAlign: 'center', fontWeight: 300, fontSize: 42, letterSpacing: '-1.4px', margin: '6px 0 10px' }}>{fmt(tip)}</div>}

        <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ep-muted)' }}>Чаевые поступают напрямую официанту</div>
      </div>

      <StickyFooter>
        <PrimaryButton onClick={() => patch({ screen: 'done' })} style={{ fontSize: 17 }}>
          {tip > 0 ? `Оставить ${fmt(tip)}` : 'Оставить чаевые'}
        </PrimaryButton>
        <button
          onClick={() => patch({ tip: '0', screen: 'done' })}
          style={{ width: '100%', minHeight: 44, border: 'none', background: 'transparent', color: 'var(--ep-muted)', fontWeight: 520, fontSize: 15, cursor: 'pointer' }}
        >
          Пропустить
        </button>
      </StickyFooter>
    </div>
  )
}
