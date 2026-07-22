import { useState } from 'react'
import { findDish } from '../data'
import { tableId } from '../api'
import { Avatar, SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

function SentBadge() {
  return (
    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 50, background: '#FFF2DA', color: '#B07A12', flexShrink: 0 }}>
      Готовится
    </span>
  )
}

export function Cart() {
  const { patch, me, snap, totals, removeLine, toast } = useStore()
  const [tableOpen, setTableOpen] = useState(false)
  if (!me || !snap) return null

  const lines = snap.lines
  const myLines = lines.filter(l => !l.shared && l.personaId === me.id)
  const sharedLines = lines.filter(l => l.shared)
  const others = snap.personas.filter(p => p.id !== me.id)
  const hasUnsentMine = lines.some(l => !l.sent && l.personaId === me.id)
  const hasUnsentAny = lines.some(l => !l.sent)
  const nameOf = (pid: string) => snap.personas.find(p => p.id === pid)?.name ?? '?'

  return (
    <div className="ep-screen">
      <div style={{ flexShrink: 0, padding: '14px 20px', background: '#fff', borderBottom: '1px solid #ECECEF' }}>
        <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.5px' }}>Заказ · Стол №{tableId}</div>
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
            const d = findDish(l.dishId)
            if (!d) return null
            return (
              <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 13, background: '#FAFAFB', borderRadius: 14, marginBottom: 8 }}>
                <span style={{ flex: 1, fontWeight: 520, fontSize: 15 }}>
                  {d.name}
                  {l.qty > 1 ? ` ×${l.qty}` : ''}
                </span>
                <span style={{ fontSize: 14.5, color: '#42424C' }}>{fmt(d.price * l.qty)}</span>
                {l.sent ? (
                  <SentBadge />
                ) : (
                  <span style={{ cursor: 'pointer', fontSize: 13, color: '#9A9AA4' }} onClick={() => void removeLine(l.uid)}>
                    ✕
                  </span>
                )}
              </div>
            )
          })}
        </Card>

        {/* Весь стол (реальные гости) */}
        {others.length > 0 && (
          <Card style={{ overflow: 'hidden' }}>
            <div onClick={() => setTableOpen(!tableOpen)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer' }}>
              <div style={{ display: 'flex' }}>
                {others.slice(0, 4).map((p, i) => (
                  <div key={p.id} style={{ marginLeft: i === 0 ? 0 : -7 }}>
                    <Avatar animal={p.animal} size={26} />
                  </div>
                ))}
              </div>
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>Весь стол</span>
              <span style={{ fontSize: 13, color: '#8A8A92' }}>
                · ещё {others.length} {others.length === 1 ? 'гость' : others.length < 5 ? 'гостя' : 'гостей'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#8A8A92', transform: tableOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}>▾</span>
            </div>
            {tableOpen && (
              <div style={{ padding: '0 16px 8px' }}>
                {others.map(p => {
                  const pl = lines.filter(l => !l.shared && l.personaId === p.id)
                  const sum = totals.personaOwn(p.id)
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: '1px solid #F2F2F4' }}>
                      <Avatar animal={p.animal} size={30} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 520, fontSize: 14 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: '#9A9AA4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pl.length ? pl.map(l => findDish(l.dishId)?.name ?? '?').join(', ') : 'ещё выбирает'}
                        </div>
                      </div>
                      <span style={{ fontSize: 14, color: '#42424C' }}>{fmt(sum)}</span>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0', borderTop: '1px solid #F2F2F4', fontSize: 13.5, color: '#7A7A84' }}>
                  <span>Итого по столу (с общими)</span>
                  <span style={{ fontWeight: 620, color: '#1F1D3D' }}>{fmt(totals.tableTotal)}</span>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Общие блюда — только реально добавленные */}
        {sharedLines.length > 0 && (
          <div style={{ background: '#fff', border: '1px dashed #C9C4E8', borderRadius: 18, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', background: '#F4F1FE' }}>
              <SharedIcon size={30} />
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>Общие блюда</span>
              <span style={{ marginLeft: 'auto', fontWeight: 620, fontSize: 15 }}>{fmt(totals.sharedTotal)}</span>
            </div>
            <div style={{ padding: '6px 14px' }}>
              {sharedLines.map(l => {
                const d = findDish(l.dishId)
                if (!d) return null
                const mineAdded = l.personaId === me.id
                return (
                  <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #F2F2F4' }}>
                    <span style={{ flex: 1, fontSize: 14 }}>
                      {d.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                      <span style={{ color: '#7C5CFC', fontSize: 12 }}> · добавил(а) {nameOf(l.personaId)}</span>
                    </span>
                    <span style={{ fontSize: 14, color: '#42424C' }}>{fmt(d.price * l.qty)}</span>
                    {l.sent ? (
                      <SentBadge />
                    ) : mineAdded ? (
                      <span style={{ cursor: 'pointer', fontSize: 13, color: '#9A9AA4' }} onClick={() => void removeLine(l.uid)}>
                        ✕
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '4px 14px 14px', fontSize: 12.5, color: '#7A7A84' }}>
              Делится поровну: по {fmt(totals.sharedTotal / totals.participants)} на {totals.participants}{' '}
              {totals.participants === 1 ? 'гостя' : 'гостей'}
            </div>
          </div>
        )}
      </div>

      <StickyFooter>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px' }}>
          <div style={{ fontSize: 13, color: '#7A7A84' }}>
            Мой итог: {fmt(totals.myOwn)} своё{totals.sharedTotal > 0 ? ` + ${fmt(totals.myShare)} доля общего` : ''}
          </div>
          <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.5px' }}>{fmt(totals.myTotal)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <GhostButton style={{ flex: 1 }} onClick={() => patch({ screen: 'menu' })}>
            Дозаказать
          </GhostButton>
          <PrimaryButton
            style={{ flex: 1.5, minHeight: 54, fontSize: 15.5 }}
            onClick={() => {
              if (!hasUnsentMine && !hasUnsentAny) {
                toast('Все блюда уже на кухне')
                return
              }
              patch({ sheet: 'send', sendChecked: false, sendScope: hasUnsentMine ? 'mine' : 'all' })
            }}
          >
            На кухню
          </PrimaryButton>
        </div>
      </StickyFooter>
    </div>
  )
}
