import { BOTS, HALL_LABEL, NAVY, TABLE_LABEL, WAITER_NAME, findDish } from './data'
import { Avatar, SharedIcon } from './avatars'
import { useStore } from './store'
import { fmt } from './format'

// Вид официанта/планшета. Читает тот же стор (localStorage) — на одном
// устройстве отражает действия гостя; между устройствами синхронизации нет (демо).
export function Waiter() {
  const { state, totals } = useStore()
  const me = state.me
  const progress = totals.tableTotal > 0 ? Math.min(100, Math.round((state.paidAmount / totals.tableTotal) * 100)) : 0
  const guestSent = state.lines.some(l => l.sent)
  const guestPaid = state.paidAmount > 0.01

  const personas = [
    ...(me
      ? [{ id: 'me', name: me.name, animal: me.animal, sum: totals.myOwn, order: guestSent ? 'Готовится' : 'Выбирает', paid: guestPaid }]
      : []),
    { id: 'dima', name: BOTS[0].name, animal: BOTS[0].animal, sum: BOTS[0].sum, order: 'Готовится', paid: false },
    { id: 'lena', name: BOTS[1].name, animal: BOTS[1].animal, sum: BOTS[1].sum, order: 'Подан', paid: false }
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#F4F4F6' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 20, padding: '16px 24px', background: '#fff', borderBottom: '1px solid #ECECEF', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
            e
          </div>
          <div>
            <div style={{ fontWeight: 660, fontSize: 17, letterSpacing: '-0.3px' }}>
              {TABLE_LABEL} · {HALL_LABEL}
            </div>
            <div style={{ fontSize: 12.5, color: '#8A8A92' }}>официант {WAITER_NAME} · экран ресторана</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
            <span style={{ color: '#7A7A84' }}>Оплачено по столу</span>
            <span style={{ fontWeight: 620 }}>
              {fmt(state.paidAmount)} / {fmt(totals.tableTotal)}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 50, background: '#ECECEF', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#1F9D55', borderRadius: 50, transition: 'width 300ms' }} />
          </div>
        </div>
        <a href="#/" style={{ fontSize: 13, color: '#7A7A84' }}>
          ← гостевой экран
        </a>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', overflow: 'auto' }}>
        <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid #ECECEF', padding: 22, background: '#FAFAFB' }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#9A9AA4', marginBottom: 14 }}>
            План персон
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {personas.map(p => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  padding: '13px 15px',
                  borderRadius: 18,
                  background: '#fff',
                  border: p.id === 'me' ? '2px solid #EC6B4E' : '1px solid #ECECEF'
                }}
              >
                <Avatar animal={p.animal} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{p.name}</div>
                  <div style={{ fontSize: 12.5, color: '#8A8A92', marginTop: 2 }}>{fmt(p.sum)} своё</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, padding: '3px 8px', borderRadius: 50, background: '#EFEFF2', color: '#7A7A84' }}>{p.order}</span>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 9.5,
                      padding: '3px 8px',
                      borderRadius: 50,
                      background: p.paid ? '#E4F6EA' : '#FFF2DA',
                      color: p.paid ? '#1F9D55' : '#B07A12'
                    }}
                  >
                    {p.paid ? 'Оплачено' : 'Ожидает'}
                  </span>
                </div>
              </div>
            ))}
            {!me && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 15, borderRadius: 18, border: '1.5px dashed #CFCFD6' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#F0F0F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#9A9AA4' }}>
                  +
                </div>
                <span style={{ fontWeight: 540, fontSize: 15, color: '#7A7A84' }}>Гость сканирует QR…</span>
              </div>
            )}
          </div>
          <div style={{ height: 1, background: '#ECECEF', margin: '22px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, color: '#42424C' }}>Итого по столу</span>
            <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.5px' }}>{fmt(totals.tableTotal)}</span>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 300, padding: '26px 30px' }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#9A9AA4', marginBottom: 14 }}>
            Живая лента заказа
          </div>
          <div style={{ background: '#fff', border: '1px solid #ECECEF', borderRadius: 20, padding: '6px 20px', marginBottom: 18 }}>
            {state.lines.length === 0 && (
              <div style={{ padding: '18px 0', fontSize: 14, color: '#9A9AA4' }}>Гость ещё ничего не добавил — покажите QR со стола</div>
            )}
            {state.lines.map(l => {
              const d = findDish(l.dishId)!
              return (
                <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: '1px solid #F2F2F4' }}>
                  {l.shared ? <SharedIcon size={40} /> : me ? <Avatar animal={me.animal} size={40} /> : null}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15.5 }}>
                      {d.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#8A8A92' }}>{l.shared ? 'общее на стол' : `${me?.name ?? ''} · своё`}</div>
                  </div>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 10,
                      padding: '4px 9px',
                      borderRadius: 50,
                      background: l.sent ? '#FFF2DA' : '#EFEFF2',
                      color: l.sent ? '#B07A12' : '#7A7A84',
                      marginRight: 6
                    }}
                  >
                    {l.sent ? 'ГОТОВИТСЯ' : 'ЧЕРНОВИК'}
                  </span>
                  <span style={{ fontWeight: 620, fontSize: 15 }}>{fmt(d.price * l.qty)}</span>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 12.5, color: '#9A9AA4', lineHeight: 1.5 }}>
            Демо: экран читает то же локальное состояние, что и телефон гостя, — на одном устройстве.
            В реальном продукте здесь live-синхронизация со всеми телефонами стола и кассой.
          </div>
        </div>
      </div>
    </div>
  )
}
