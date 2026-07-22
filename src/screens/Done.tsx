import { WAITER_NAME } from '../data'
import { Avatar } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore, tipAmount } from '../store'
import { fmt } from '../format'

const CHIPS = ['Вкусно', 'Быстро', 'Уютно']

export function Done() {
  const { state, dispatch, totals } = useStore()
  const tip = tipAmount(state, state.paidAmount)
  const remaining = totals.remaining

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '30px 22px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 22 }}>
          <div className="ep-pop" style={{ width: 74, height: 74, borderRadius: '50%', background: '#1F9D55', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, marginBottom: 16 }}>
            ✓
          </div>
          <div style={{ fontWeight: 300, fontSize: 18, color: '#5C5C66' }}>Оплачено</div>
          <div style={{ fontWeight: 300, fontSize: 44, letterSpacing: '-1.6px', lineHeight: 1 }}>{fmt(state.paidAmount)}</div>
          {tip > 0 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: '#EDE7FD', color: '#7C5CFC', borderRadius: 50, padding: '6px 13px', fontSize: 13, fontWeight: 540 }}>
              + {fmt(tip)} чаевых официанту {WAITER_NAME}у
            </div>
          )}
        </div>

        {remaining > 0.01 && state.me && (
          <div style={{ marginBottom: 14 }}>
            <WarnBanner>
              <Avatar animal={state.me.animal} size={26} />
              <span style={{ flex: 1, fontSize: 13, color: '#7A5A12', lineHeight: 1.4 }}>
                Ваша часть оплачена. По столу осталось <b style={{ fontWeight: 640 }}>{fmt(remaining)}</b>
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1F1D3D', whiteSpace: 'nowrap', cursor: 'pointer' }}>Поделиться →</span>
            </WarnBanner>
          </div>
        )}

        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: '#E4F6EA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>
              🧾
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>Фискальный чек отправлен</div>
              <div style={{ fontSize: 12.5, color: '#8A8A92', marginTop: 1 }}>На +7 ··· 45 и email</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, marginTop: 13 }}>
            <GhostButton style={{ minHeight: 44, fontSize: 13.5 }}>Открыть чек</GhostButton>
            <GhostButton style={{ minHeight: 44, fontSize: 13.5 }}>Мои чеки (ФНС)</GhostButton>
          </div>
        </Card>

        <Card style={{ padding: '18px 16px' }}>
          <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 16, marginBottom: 13 }}>Как всё прошло?</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => dispatch({ type: 'patch', patch: { rating: n } })}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 34, lineHeight: 1, color: n <= state.rating ? '#F4B400' : '#DADADE' }}
              >
                ★
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            {CHIPS.map(ch => (
              <span key={ch} style={{ fontSize: 13, fontWeight: 520, padding: '8px 15px', borderRadius: 50, background: '#F2F2F4', color: '#42424C', cursor: 'pointer' }}>
                {ch}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <StickyFooter>
        <div style={{ display: 'flex', gap: 10 }}>
          <GhostButton style={{ flex: 1 }} onClick={() => dispatch({ type: 'patch', patch: { screen: 'menu' } })}>
            Заказать ещё
          </GhostButton>
          <PrimaryButton style={{ flex: 1 }} onClick={() => dispatch({ type: 'reset' })}>
            Готово
          </PrimaryButton>
        </div>
      </StickyFooter>
    </div>
  )
}
