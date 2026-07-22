import { NAVY, findDish } from '../data'
import { Avatar, SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore } from '../store'

const STEPS = [
  { label: 'Принят', st: 'done' as const },
  { label: 'Готовится', st: 'active' as const },
  { label: 'Подано', st: 'todo' as const }
]

export function Status() {
  const { state, dispatch } = useStore()
  const me = state.me
  if (!me) return null
  const sentLines = state.lines.filter(l => l.sent)

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '26px 22px 18px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 22 }}>
          <div className="ep-pop" style={{ width: 78, height: 78, borderRadius: '50%', background: '#DCEEB1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontSize: 34, color: '#3A6B12' }}>
            ✓
          </div>
          <div style={{ fontWeight: 300, fontSize: 28, lineHeight: 1.12, letterSpacing: '-0.9px' }}>
            Заказ принят.
            <br />
            Приятного аппетита!
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 22, padding: '0 6px' }}>
          {STEPS.map((x, i) => {
            const done = x.st === 'done'
            const active = x.st === 'active'
            return (
              <div key={x.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                {i > 0 && (
                  <div style={{ position: 'absolute', top: 17, right: '50%', width: '100%', height: 3, background: done || active ? '#1F9D55' : '#E4E4E8', zIndex: 0 }} />
                )}
                <div
                  className={active ? 'ep-pulse' : undefined}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 15,
                    fontWeight: 700,
                    marginBottom: 8,
                    background: done ? '#1F9D55' : active ? NAVY : '#fff',
                    color: done || active ? '#fff' : '#9A9AA4',
                    border: x.st === 'todo' ? '2px solid #E4E4E8' : 'none'
                  }}
                >
                  {done ? '✓' : ''}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: active ? 600 : 480, color: x.st === 'todo' ? '#9A9AA4' : NAVY }}>{x.label}</div>
              </div>
            )
          })}
        </div>

        <Card style={{ padding: '6px 16px', marginBottom: 14 }}>
          {sentLines.filter(l => !l.shared).map(l => {
            const d = findDish(l.dishId)!
            return (
              <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '1px solid #F2F2F4' }}>
                <Avatar animal={me.animal} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 540, fontSize: 14.5 }}>
                    {d.name}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#9A9AA4' }}>{me.name} · своё</div>
                </div>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 50, background: '#FFF2DA', color: '#B07A12' }}>
                  Готовится
                </span>
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0' }}>
            <SharedIcon size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 540, fontSize: 14.5 }}>Общие блюда</div>
              <div style={{ fontSize: 12, color: '#9A9AA4' }}>Спринг-роллы, лимонад, пицца</div>
            </div>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 50, background: '#F2F2F4', color: '#8A8A92' }}>
              Принято
            </span>
          </div>
        </Card>

        <WarnBanner>
          <Avatar animal="bear" size={26} />
          <span style={{ fontSize: 13, color: '#7A5A12' }}>
            <b style={{ fontWeight: 620 }}>Дима</b> ещё дозаказывает десерт
          </span>
        </WarnBanner>
      </div>

      <StickyFooter>
        <GhostButton onClick={() => dispatch({ type: 'patch', patch: { screen: 'menu' } })}>Дозаказать</GhostButton>
        <PrimaryButton onClick={() => dispatch({ type: 'patch', patch: { screen: 'payment', payStage: 'form' } })}>
          Оплатить, когда будете готовы
        </PrimaryButton>
      </StickyFooter>
    </div>
  )
}
