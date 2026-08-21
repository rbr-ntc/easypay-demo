import { optionsLabel, WAITER_NAME } from '../data'
import { SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore, tipAmount } from '../store'
import { fmt } from '../format'

const CHIPS = ['Вкусно', 'Быстро', 'Уютно']

export function Done() {
  const { ui, patch, snap, totals } = useStore()
  const tip = tipAmount(ui)
  const receipt = ui.lastReceipt
  const remaining = totals.remaining

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '30px 22px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 22 }}>
          <div className="ep-pop" style={{ width: 74, height: 74, borderRadius: '50%', background: '#1F9D55', color: 'var(--ep-on-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, marginBottom: 16 }}>
            ✓
          </div>
          <div style={{ fontWeight: 300, fontSize: 18, color: 'var(--ep-text-2)' }}>Оплачено</div>
          <div style={{ fontWeight: 300, fontSize: 44, letterSpacing: '-1.6px', lineHeight: 1 }}>{fmt(ui.lastPaid)}</div>
          {tip > 0 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: 'var(--ep-accent-bg2)', color: 'var(--ep-accent)', borderRadius: 'var(--ep-r-pill)', padding: '6px 13px', fontSize: 13, fontWeight: 540 }}>
              + {fmt(tip)} чаевых официанту {snap?.waiter?.name ?? WAITER_NAME}
            </div>
          )}
        </div>

        {remaining > 0.01 && (
          <div style={{ marginBottom: 14 }}>
            <WarnBanner>
              <SharedIcon size={26} />
              <span style={{ flex: 1, fontSize: 13, color: '#7A5A12', lineHeight: 1.4 }}>
                Ваша часть оплачена. По столу осталось <b style={{ fontWeight: 640 }}>{fmt(remaining)}</b>
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ep-ink)', whiteSpace: 'nowrap', cursor: 'pointer' }}>Поделиться →</span>
            </WarnBanner>
          </div>
        )}

        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 40, height: 40, borderRadius: 'var(--ep-r-sm)', background: '#E4F6EA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>
              🧾
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                Чек {receipt ? `№ ${receipt.no}` : 'заказа'}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ep-muted)', marginTop: 1 }}>
                {receipt
                  ? `${new Date(receipt.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · стол №${receipt.table}`
                  : 'Сохраните номер операции'}
              </div>
            </div>
          </div>

          {/* Раньше здесь было «фискальный чек отправлен» и две кнопки, которые
              ничего не делали. Теперь показываем то, что действительно есть:
              за что именно списаны деньги. Фискальный чек придёт из кассы. */}
          {receipt && receipt.lines.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--ep-soft)', paddingTop: 12 }}>
              {receipt.lines.map((l, i) => (
                <div
                  key={`${l.name}-${i}`}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, padding: '4px 0' }}
                >
                  <span style={{ color: 'var(--ep-text-2)' }}>
                    {l.name}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                    {l.shared ? ' · общее' : ''}
                    {optionsLabel(l.options) && (
                      <span style={{ color: 'var(--ep-muted)' }}> · {optionsLabel(l.options)}</span>
                    )}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(l.shared && l.share !== null ? l.share : l.price * l.qty)}
                  </span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 640,
                  fontSize: 14.5,
                  borderTop: '1px solid var(--ep-soft)',
                  marginTop: 8,
                  paddingTop: 8
                }}
              >
                <span>Списано</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(receipt.amount)}</span>
              </div>
            </div>
          )}
        </Card>

        <Card style={{ padding: '18px 16px' }}>
          <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 16, marginBottom: 13 }}>Как всё прошло?</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => patch({ rating: n })}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 34, lineHeight: 1, color: n <= ui.rating ? '#F4B400' : 'var(--ep-border)' }}
              >
                ★
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            {CHIPS.map(ch => (
              <span key={ch} style={{ fontSize: 13, fontWeight: 520, padding: '8px 15px', borderRadius: 'var(--ep-r-pill)', background: 'var(--ep-soft)', color: 'var(--ep-text-2)', cursor: 'pointer' }}>
                {ch}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <StickyFooter>
        <div style={{ display: 'flex', gap: 10 }}>
          <GhostButton style={{ flex: 1 }} onClick={() => patch({ screen: 'menu' })}>
            Заказать ещё
          </GhostButton>
          <PrimaryButton style={{ flex: 1 }} onClick={() => patch({ screen: 'welcome' })}>
            Готово
          </PrimaryButton>
        </div>
      </StickyFooter>
    </div>
  )
}
