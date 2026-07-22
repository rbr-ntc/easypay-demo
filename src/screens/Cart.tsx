import { useState } from 'react'
import { BOTS, PARTICIPANTS, SHARED_SEED, TABLE_LABEL, findDish } from '../data'
import { Avatar, SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

export function Cart() {
  const { state, dispatch, totals, toast } = useStore()
  const [tableOpen, setTableOpen] = useState(false)
  const me = state.me
  if (!me) return null

  const myLines = state.lines.filter(l => !l.shared)
  const mySharedLines = state.lines.filter(l => l.shared)
  const hasUnsent = state.lines.some(l => !l.sent)

  return (
    <div className="ep-screen">
      <div style={{ flexShrink: 0, padding: '14px 20px', background: '#fff', borderBottom: '1px solid #ECECEF' }}>
        <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.5px' }}>Заказ · {TABLE_LABEL}</div>
      </div>

      <div className="ep-scroll" style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
        {/* Мой заказ */}
        <Card style={{ borderRadius: 20, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: myLines.length ? 14 : 0 }}>
            <Avatar animal={me.animal} size={40} />
            <div>
              <div style={{ fontWeight: 620, fontSize: 16 }}>{me.name}</div>
              <div style={{ fontSize: 12, color: '#8A8A92' }}>мой заказ</div>
            </div>
            <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 18 }}>{fmt(totals.myOwn)}</span>
          </div>
          {myLines.length === 0 && (
            <div style={{ fontSize: 13.5, color: '#9A9AA4', padding: '4px 0 2px' }}>Пока пусто — добавьте блюда из меню</div>
          )}
          {myLines.map(l => {
            const d = findDish(l.dishId)!
            return (
              <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 13, background: '#FAFAFB', borderRadius: 14, marginBottom: 8 }}>
                <span style={{ flex: 1, fontWeight: 520, fontSize: 15 }}>
                  {d.name}
                  {l.qty > 1 ? ` ×${l.qty}` : ''}
                </span>
                <span style={{ fontSize: 14.5, color: '#42424C' }}>{fmt(d.price * l.qty)}</span>
                {l.sent ? (
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 50, background: '#FFF2DA', color: '#B07A12' }}>
                    Готовится
                  </span>
                ) : (
                  <span style={{ cursor: 'pointer', fontSize: 13, color: '#9A9AA4' }} onClick={() => dispatch({ type: 'removeLine', uid: l.uid })}>
                    ✕
                  </span>
                )}
              </div>
            )
          })}
        </Card>

        {/* Весь стол (свёрнуто) */}
        <Card style={{ overflow: 'hidden' }}>
          <div onClick={() => setTableOpen(!tableOpen)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer' }}>
            <div style={{ display: 'flex' }}>
              <Avatar animal="bear" size={26} />
              <div style={{ marginLeft: -7 }}>
                <Avatar animal="panda" size={26} />
              </div>
            </div>
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>Весь стол</span>
            <span style={{ fontSize: 13, color: '#8A8A92' }}>· ещё {BOTS.length} гостя</span>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#8A8A92', transform: tableOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}>▾</span>
          </div>
          {tableOpen && (
            <div style={{ padding: '0 16px 8px' }}>
              {BOTS.map(b => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: '1px solid #F2F2F4' }}>
                  <Avatar animal={b.animal} size={30} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 520, fontSize: 14 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: '#9A9AA4' }}>{b.dishName}</div>
                  </div>
                  <span style={{ fontSize: 14, color: '#42424C' }}>{fmt(b.sum)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderTop: '1px solid #F2F2F4', fontSize: 13.5, color: '#7A7A84' }}>
                <span>Итого по столу (с общими)</span>
                <span style={{ fontWeight: 620, color: '#1F1D3D' }}>{fmt(totals.tableTotal)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* Общие блюда */}
        <div style={{ background: '#fff', border: '1px dashed #C9C4E8', borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', background: '#F4F1FE' }}>
            <SharedIcon size={30} />
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>Общие блюда</span>
            <span style={{ marginLeft: 'auto', fontWeight: 620, fontSize: 15 }}>{fmt(totals.sharedTotal)}</span>
          </div>
          <div style={{ padding: '6px 14px' }}>
            {SHARED_SEED.map(sh => (
              <div key={sh.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #F2F2F4' }}>
                <span style={{ flex: 1, fontSize: 14 }}>{sh.name}</span>
                <span style={{ fontSize: 14, color: '#42424C' }}>{fmt(sh.price)}</span>
              </div>
            ))}
            {mySharedLines.map(l => {
              const d = findDish(l.dishId)!
              return (
                <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #F2F2F4' }}>
                  <span style={{ flex: 1, fontSize: 14 }}>
                    {d.name}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                    <span style={{ color: '#7C5CFC', fontSize: 12 }}> · добавили вы</span>
                  </span>
                  <span style={{ fontSize: 14, color: '#42424C' }}>{fmt(d.price * l.qty)}</span>
                  {!l.sent && (
                    <span style={{ cursor: 'pointer', fontSize: 13, color: '#9A9AA4' }} onClick={() => dispatch({ type: 'removeLine', uid: l.uid })}>
                      ✕
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ padding: '4px 14px 14px', fontSize: 12.5, color: '#7A7A84' }}>
            Делится поровну: по {fmt(totals.sharedTotal / PARTICIPANTS)} на {PARTICIPANTS} гостей
          </div>
        </div>
      </div>

      <StickyFooter>
        <div style={{ display: 'flex', gap: 10 }}>
          <GhostButton style={{ flex: 1 }} onClick={() => dispatch({ type: 'patch', patch: { screen: 'menu' } })}>
            Дозаказать
          </GhostButton>
          <PrimaryButton
            style={{ flex: 1.5, minHeight: 54, fontSize: 15.5 }}
            onClick={() => {
              if (!hasUnsent) {
                toast('Все блюда уже на кухне')
                return
              }
              dispatch({ type: 'patch', patch: { sheet: 'send', sendChecked: false } })
            }}
          >
            На кухню
          </PrimaryButton>
        </div>
      </StickyFooter>
    </div>
  )
}
