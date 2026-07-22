import { useEffect, useState } from 'react'
import { NAVY, PARTICIPANTS, SBP_GRADIENT } from '../data'
import { Mono, PrimaryButton, StickyFooter } from '../ui'
import { useStore } from '../store'
import type { PayScope, PayMethod } from '../store'
import { fmt } from '../format'

const SCOPES: { id: PayScope; label: string; subOf: (mine: string, table: string) => string }[] = [
  { id: 'own', label: 'Оплатить своё', subOf: mine => mine },
  { id: 'equal', label: 'Разделить поровну', subOf: (_m, table) => `остаток ${table} на ${PARTICIPANTS} гостей` },
  { id: 'full', label: 'Оплатить весь стол', subOf: (_m, table) => `весь неоплаченный остаток` }
]

const METHODS: { id: PayMethod; label: string; glyph: string }[] = [
  { id: 'card', label: 'Банковская карта', glyph: '▭' },
  { id: 'tpay', label: 'T-Pay', glyph: 'T' },
  { id: 'sber', label: 'SberPay', glyph: 'S' },
  { id: 'mir', label: 'Mir Pay', glyph: 'M' }
]

function QrStage({ amount, onBack, onPaid }: { amount: number; onBack: () => void; onPaid: () => void }) {
  const [ttl, setTtl] = useState(299)
  useEffect(() => {
    const t = setInterval(() => setTtl(x => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const mm = String(Math.floor(ttl / 60)).padStart(2, '0')
  const ss = String(ttl % 60).padStart(2, '0')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '18px 24px', paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button onClick={onBack} style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid #ECECEF', background: '#fff', fontSize: 18, cursor: 'pointer' }}>
          ←
        </button>
        <div style={{ fontWeight: 640, fontSize: 18 }}>Оплата по СБП</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ width: 60, height: 24, borderRadius: 7, background: SBP_GRADIENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, marginBottom: 18 }}>
          СБП
        </div>
        <div style={{ padding: 18, background: '#fff', borderRadius: 24, boxShadow: '0 10px 30px rgba(20,18,45,.12)', marginBottom: 18 }}>
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: 12,
              backgroundImage: 'repeating-conic-gradient(#1F1D3D 0% 25%, #fff 0% 50%)',
              backgroundSize: '17px 17px',
              border: '8px solid #fff'
            }}
          />
        </div>
        <div style={{ fontWeight: 300, fontSize: 34, letterSpacing: '-1px', marginBottom: 6 }}>{fmt(amount)}</div>
        <div style={{ fontSize: 13.5, color: '#7A7A84', marginBottom: 4 }}>Наведите камеру или откройте приложение банка</div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#B5249C' }}>
          Код действителен {mm}:{ss}
        </div>
      </div>
      <PrimaryButton onClick={onPaid} style={{ background: SBP_GRADIENT }}>
        Открыть приложение банка
      </PrimaryButton>
    </div>
  )
}

export function Payment() {
  const { state, dispatch, totals } = useStore()
  const amount = totals.scopeAmount(state.payScope)
  const sbp = state.payMethod === 'sbp'

  const pay = () => {
    dispatch({ type: 'patch', patch: { payStage: 'processing' } })
    setTimeout(() => {
      dispatch({ type: 'patch', patch: { paidAmount: state.paidAmount + amount, payStage: 'form', screen: 'tips' } })
    }, 1700)
  }

  if (state.payStage === 'processing') {
    return (
      <div className="ep-screen" style={{ alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <div className="ep-spin" style={{ width: 62, height: 62, borderRadius: '50%', border: `5px solid #ECECEF`, borderTopColor: NAVY }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 19, marginBottom: 5 }}>Проводим оплату…</div>
          <div style={{ fontSize: 14, color: '#7A7A84' }}>Не закрывайте экран</div>
        </div>
      </div>
    )
  }

  if (state.payStage === 'qr') {
    return (
      <div className="ep-screen">
        <QrStage amount={amount} onBack={() => dispatch({ type: 'patch', patch: { payStage: 'form' } })} onPaid={pay} />
      </div>
    )
  }

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '14px 20px 20px' }}>
        <div style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-0.6px', marginBottom: 16 }}>Оплата</div>

        <Mono style={{ marginBottom: 9 }}>Что оплачиваем</Mono>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
          {SCOPES.map(o => {
            const active = o.id === state.payScope
            const amt = totals.scopeAmount(o.id)
            return (
              <div
                key={o.id}
                onClick={() => dispatch({ type: 'patch', patch: { payScope: o.id } })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 14px',
                  borderRadius: 16,
                  cursor: 'pointer',
                  background: '#fff',
                  border: active ? `2px solid ${NAVY}` : '1px solid #ECECEF'
                }}
              >
                <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: active ? `6px solid ${NAVY}` : '2px solid #CFCFD6', background: '#fff', boxSizing: 'border-box' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{o.label}</div>
                  <div style={{ fontSize: 12, color: '#8A8A92', marginTop: 2 }}>
                    {o.id === 'own'
                      ? `${fmt(totals.myOwn)} ваше + ${fmt(totals.myShare)} доля общего`
                      : o.subOf(fmt(totals.myTotal), fmt(totals.remaining))}
                  </div>
                </div>
                <span style={{ fontWeight: 660, fontSize: 16 }}>{fmt(amt)}</span>
              </div>
            )
          })}
        </div>

        <Mono style={{ marginBottom: 9 }}>Способ оплаты</Mono>
        <div
          onClick={() => dispatch({ type: 'patch', patch: { payMethod: 'sbp' } })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderRadius: 18,
            cursor: 'pointer',
            background: sbp ? 'linear-gradient(118deg,#FBF0F8,#F4ECFB)' : '#fff',
            border: sbp ? '2px solid #B5249C' : '1px solid #ECECEF'
          }}
        >
          <div style={{ width: 46, height: 46, borderRadius: 13, background: SBP_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontWeight: 700, fontSize: 15 }}>
            СБП
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontWeight: 620, fontSize: 15.5 }}>СБП</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, textTransform: 'uppercase', background: SBP_GRADIENT, color: '#fff', padding: '3px 8px', borderRadius: 50 }}>
                Рекомендуем
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#7A7A84', marginTop: 2 }}>Оплата по QR или кнопке банка</div>
          </div>
          {sbp && (
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#B5249C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              ✓
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
          {METHODS.map(m => (
            <div
              key={m.id}
              onClick={() => dispatch({ type: 'patch', patch: { payMethod: m.id } })}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 16, background: '#fff', border: '1px solid #ECECEF', cursor: 'pointer' }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 9, background: '#F2F2F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, color: '#5C5C66', flexShrink: 0 }}>
                {m.glyph}
              </div>
              <span style={{ flex: 1, fontWeight: 520, fontSize: 14.5 }}>{m.label}</span>
              <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: state.payMethod === m.id ? `5px solid ${NAVY}` : '2px solid #CFCFD6', background: '#fff', boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
      </div>

      <StickyFooter>
        <PrimaryButton
          onClick={() => (sbp ? dispatch({ type: 'patch', patch: { payStage: 'qr' } }) : pay())}
          style={{ background: sbp ? SBP_GRADIENT : NAVY, fontSize: 17 }}
        >
          {sbp ? `Оплатить по СБП · ${fmt(amount)}` : `Оплатить ${fmt(amount)}`}
        </PrimaryButton>
      </StickyFooter>
    </div>
  )
}
