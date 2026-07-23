import { useEffect, useState } from 'react'
import { NAVY, SBP_GRADIENT } from '../data'
import { Avatar } from '../avatars'
import { Mono, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore } from '../store'
import type { PayScope, PayMethod } from '../store'
import { fmt } from '../format'

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
        <button onClick={onBack} style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid var(--ep-border)', background: 'var(--ep-surface)', fontSize: 18, cursor: 'pointer' }}>
          ←
        </button>
        <div style={{ fontWeight: 640, fontSize: 18 }}>Оплата по СБП</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ width: 60, height: 24, borderRadius: 'var(--ep-r-xs)', background: SBP_GRADIENT, color: 'var(--ep-on-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, marginBottom: 18 }}>
          СБП
        </div>
        <div style={{ padding: 18, background: 'var(--ep-surface)', borderRadius: 'var(--ep-r-lg)', boxShadow: '0 10px 30px rgba(20,18,45,.12)', marginBottom: 18 }}>
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: 'var(--ep-r-sm)',
              backgroundImage: 'repeating-conic-gradient(var(--ep-ink) 0% 25%, #fff 0% 50%)',
              backgroundSize: '17px 17px',
              border: '8px solid #fff'
            }}
          />
        </div>
        <div style={{ fontWeight: 300, fontSize: 34, letterSpacing: '-1px', marginBottom: 6 }}>{fmt(amount)}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ep-muted)', marginBottom: 4 }}>Наведите камеру или откройте приложение банка</div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#B5249C' }}>
          Код действителен {mm}:{ss}
        </div>
      </div>
      <PrimaryButton onClick={onPaid} style={{ background: SBP_GRADIENT, color: '#fff', border: 'none' }}>
        Открыть приложение банка
      </PrimaryButton>
    </div>
  )
}

export function Payment() {
  const { ui, patch, me, snap, totals, pay } = useStore()
  if (!me || !snap) return null
  const amount = totals.scopeAmount(ui.payScope)
  const sbp = ui.payMethod === 'sbp'

  // Кто уже оплатил (реальные платежи других гостей)
  const otherPayments = snap.payments.filter(p => p.personaId !== me.id)

  const alone = totals.participants <= 1
  const SCOPES: { id: PayScope; label: string; sub: string; disabled?: boolean }[] = alone
    ? [
        {
          id: 'own',
          label: 'Ваш заказ',
          sub: totals.sharedTotal > 0 ? `${fmt(totals.myOwn)} блюда + ${fmt(totals.myShare)} общие` : 'вы один за столом',
          disabled: totals.scopeAmount('own') <= 0
        }
      ]
    : [
        {
          id: 'own',
          label: 'Оплатить своё',
          sub: `${fmt(totals.myOwn)} ваше + ${fmt(totals.myShare)} доля общего`,
          disabled: totals.scopeAmount('own') <= 0
        },
        { id: 'equal', label: 'Разделить поровну', sub: `${fmt(totals.tableTotal)} на ${totals.participants} гостей` },
        { id: 'full', label: 'Оплатить весь стол', sub: 'весь неоплаченный остаток' }
      ]

  const doPay = async () => {
    patch({ payStage: 'processing' })
    const paid = await pay(ui.payScope)
    if (paid > 0) {
      setTimeout(() => patch({ payStage: 'form', screen: 'tips' }), 1400)
    } else {
      patch({ payStage: 'form' })
    }
  }

  if (ui.payStage === 'processing') {
    return (
      <div className="ep-screen" style={{ alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <div className="ep-spin" style={{ width: 62, height: 62, borderRadius: '50%', border: `5px solid var(--ep-border)`, borderTopColor: NAVY }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 19, marginBottom: 5 }}>Проводим оплату…</div>
          <div style={{ fontSize: 14, color: 'var(--ep-muted)' }}>Не закрывайте экран</div>
        </div>
      </div>
    )
  }

  if (ui.payStage === 'qr') {
    return (
      <div className="ep-screen">
        <QrStage amount={amount} onBack={() => patch({ payStage: 'form' })} onPaid={() => void doPay()} />
      </div>
    )
  }

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '14px 20px 20px' }}>
        <div style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-0.6px', marginBottom: 16 }}>Оплата</div>

        {otherPayments.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <WarnBanner>
              <Avatar animal={snap.personas.find(p => p.id === otherPayments[0].personaId)?.animal ?? 'fox'} size={26} />
              <span style={{ fontSize: 13, lineHeight: 1.45, color: '#7A5A12' }}>
                {otherPayments
                  .map(p => `${snap.personas.find(x => x.id === p.personaId)?.name ?? '?'} — ${fmt(p.amount)}`)
                  .join(', ')}{' '}
                уже оплачено. Осталось <b style={{ fontWeight: 640 }}>{fmt(totals.remaining)}</b>
              </span>
            </WarnBanner>
          </div>
        )}

        <Mono style={{ marginBottom: 9 }}>Что оплачиваем</Mono>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
          {SCOPES.map(o => {
            const active = o.id === ui.payScope
            const amt = totals.scopeAmount(o.id)
            return (
              <div
                key={o.id}
                onClick={() => !o.disabled && patch({ payScope: o.id })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 14px',
                  borderRadius: 'var(--ep-r-card)',
                  cursor: o.disabled ? 'not-allowed' : 'pointer',
                  opacity: o.disabled ? 0.45 : 1,
                  background: 'var(--ep-surface)',
                  border: active ? `2px solid ${NAVY}` : '1px solid var(--ep-border)'
                }}
              >
                <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: active ? `6px solid ${NAVY}` : '2px solid var(--ep-border)', background: 'var(--ep-surface)', boxSizing: 'border-box' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{o.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--ep-muted)', marginTop: 2 }}>{o.disabled ? 'уже оплачено' : o.sub}</div>
                </div>
                <span style={{ fontWeight: 660, fontSize: 16 }}>{fmt(amt)}</span>
              </div>
            )
          })}
        </div>

        <Mono style={{ marginBottom: 9 }}>Способ оплаты</Mono>
        <div
          onClick={() => patch({ payMethod: 'sbp' })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderRadius: 'var(--ep-r-card)',
            cursor: 'pointer',
            background: sbp ? 'linear-gradient(118deg,#FBF0F8,#F4ECFB)' : 'var(--ep-surface)',
            border: sbp ? '2px solid #B5249C' : '1px solid var(--ep-border)'
          }}
        >
          <div style={{ width: 46, height: 46, borderRadius: 'var(--ep-r-sm)', background: SBP_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--ep-on-ink)', fontWeight: 700, fontSize: 15 }}>
            СБП
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontWeight: 620, fontSize: 15.5 }}>СБП</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9, textTransform: 'uppercase', background: SBP_GRADIENT, color: 'var(--ep-on-ink)', padding: '3px 8px', borderRadius: 'var(--ep-r-pill)' }}>
                Рекомендуем
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ep-muted)', marginTop: 2 }}>Оплата по QR или кнопке банка</div>
          </div>
          {sbp && (
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#B5249C', color: 'var(--ep-on-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              ✓
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
          {METHODS.map(m => (
            <div
              key={m.id}
              onClick={() => patch({ payMethod: m.id })}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 'var(--ep-r-card)', background: 'var(--ep-surface)', border: '1px solid var(--ep-border)', cursor: 'pointer' }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 'var(--ep-r-xs)', background: 'var(--ep-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, color: 'var(--ep-text-2)', flexShrink: 0 }}>
                {m.glyph}
              </div>
              <span style={{ flex: 1, fontWeight: 520, fontSize: 14.5 }}>{m.label}</span>
              <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: ui.payMethod === m.id ? `5px solid ${NAVY}` : '2px solid var(--ep-border)', background: 'var(--ep-surface)', boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
      </div>

      <StickyFooter>
        <PrimaryButton
          disabled={amount <= 0}
          onClick={() => (sbp ? patch({ payStage: 'qr' }) : void doPay())}
          style={ sbp ? { background: SBP_GRADIENT, color: '#fff', border: 'none', fontSize: 17 } : { fontSize: 17 } }
        >
          {sbp ? `Оплатить по СБП · ${fmt(amount)}` : `Оплатить ${fmt(amount)}`}
        </PrimaryButton>
      </StickyFooter>
    </div>
  )
}
