import { useEffect, useState } from 'react'
import { HALL_LABEL, NAVY, WAITER_NAME, findDish } from './data'
import { tableId } from './api'
import { Avatar, SharedIcon } from './avatars'
import { useStore } from './store'
import { fmt } from './format'

function fmtDur(ms: number | null): string {
  if (ms === null || ms < 0 || !isFinite(ms)) return '—'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} м`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div style={{ flex: '1 1 130px', minWidth: 130, background: '#fff', border: '1px solid #ECECEF', borderRadius: 16, padding: '12px 14px' }}>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#9A9AA4', marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontWeight: 680, fontSize: 21, letterSpacing: '-0.6px', color: accent ? '#1F9D55' : '#1F1D3D' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#A6A6AE', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

// Экран менеджера/официанта: живой снапшот стола со всех телефонов.
export function Waiter() {
  const { snap, connected, totals, closeTable, serveLine } = useStore()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const personas = snap?.personas ?? []
  const lines = snap?.lines ?? []
  const payments = snap?.payments ?? []
  const isOpen = snap?.status === 'open'
  const progress = totals.tableTotal > 0 ? Math.min(100, Math.round((totals.paidTotal / totals.tableTotal) * 100)) : 0
  const nameOf = (pid: string) => personas.find(p => p.id === pid)?.name ?? '?'
  const animalOf = (pid: string) => personas.find(p => p.id === pid)?.animal ?? 'fox'
  const fullyPaid = totals.tableTotal > 0 && totals.remaining < 0.01

  // ---- Метрики стола ----
  const openedAt = snap?.openedAt ?? null
  const endAt = snap?.status === 'closed' ? (snap?.closedAt ?? now) : now
  const tableDur = openedAt ? endAt - openedAt : null
  const sentAts = lines.filter(l => l.sentAt).map(l => l.sentAt as number)
  const firstSentAt = sentAts.length ? Math.min(...sentAts) : null
  const toFirstOrder = openedAt && firstSentAt ? firstSentAt - openedAt : null
  const kitchenDone = lines.filter(l => l.sentAt && l.servedAt)
  const kitchenAvg = kitchenDone.length
    ? kitchenDone.reduce((s, l) => s + ((l.servedAt as number) - (l.sentAt as number)), 0) / kitchenDone.length
    : null
  const servedAts = lines.filter(l => l.servedAt).map(l => l.servedAt as number)
  const lastServedAt = servedAts.length ? Math.max(...servedAts) : null
  const lastPayAt = payments.length ? Math.max(...payments.map(p => p.at)) : null
  const payWait = fullyPaid && lastServedAt && lastPayAt ? Math.max(0, lastPayAt - lastServedAt) : null
  // Темп выручки осмыслен только на подросшей сессии: иначе экстраполяция даёт дикие ₽/ч
  const revReady = tableDur !== null && (snap?.status === 'closed' || tableDur >= 10 * 60_000)
  const revPerHour = revReady && tableDur ? totals.paidTotal / (tableDur / 3_600_000) : null
  const perGuest = personas.length ? totals.tableTotal / personas.length : null

  const personaCards = personas.map(p => {
    const own = totals.personaOwn(p.id)
    const total = own + totals.sharedTotal / totals.participants
    const paid = totals.personaPaid(p.id)
    const hasUnsent = lines.some(l => !l.sent && l.personaId === p.id)
    const sentLines = lines.filter(l => l.sent && l.personaId === p.id)
    const allServed = sentLines.length > 0 && sentLines.every(l => l.served)
    const payLabel = paid >= total - 0.01 && total > 0 ? 'Оплачено' : paid > 0 ? 'Частично' : 'Ожидает'
    const orderLabel = hasUnsent ? 'Выбирает' : allServed ? 'Подано' : sentLines.length ? 'Готовится' : 'Смотрит меню'
    return { p, total, paid, payLabel, orderLabel }
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#F4F4F6' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 20, padding: '16px 24px', background: '#fff', borderBottom: '1px solid #ECECEF', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
            e
          </div>
          <div>
            <div style={{ fontWeight: 660, fontSize: 17, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
              Стол №{tableId} · {HALL_LABEL}
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 10,
                  padding: '3px 9px',
                  borderRadius: 50,
                  background: isOpen ? '#E4F6EA' : '#F2F2F4',
                  color: isOpen ? '#1F9D55' : '#8A8A92',
                  textTransform: 'uppercase'
                }}
              >
                {isOpen ? 'Открыт' : 'Закрыт'}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#8A8A92' }}>
              официант {WAITER_NAME} · экран ресторана {connected ? '' : '· нет связи…'}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
            <span style={{ color: '#7A7A84' }}>Оплачено по столу</span>
            <span style={{ fontWeight: 620 }}>
              {fmt(totals.paidTotal)} / {fmt(totals.tableTotal)}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 50, background: '#ECECEF', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#1F9D55', borderRadius: 50, transition: 'width 300ms' }} />
          </div>
        </div>
        {isOpen && (
          <button
            onClick={() => {
              if (window.confirm(fullyPaid ? 'Закрыть стол?' : `По столу осталось ${fmt(totals.remaining)}. Всё равно закрыть?`)) {
                void closeTable()
              }
            }}
            style={{
              minHeight: 42,
              padding: '0 18px',
              borderRadius: 50,
              border: fullyPaid ? 'none' : '1px solid #DDDDE2',
              background: fullyPaid ? '#1F9D55' : '#fff',
              color: fullyPaid ? '#fff' : '#1F1D3D',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer'
            }}
          >
            Закрыть стол
          </button>
        )}
        <a href="#/" style={{ fontSize: 13, color: '#7A7A84' }}>
          ← гостевой экран
        </a>
      </div>

      {(openedAt || snap?.status === 'closed') && (
        <div style={{ flexShrink: 0, display: 'flex', gap: 10, padding: '14px 24px 4px', flexWrap: 'wrap', background: '#F4F4F6' }}>
          <Metric
            label={snap?.status === 'closed' ? 'Стол обслужен за' : 'Стол открыт'}
            value={fmtDur(tableDur)}
            hint={snap?.status === 'closed' ? 'итог сессии' : 'идёт сейчас'}
            accent={snap?.status === 'closed'}
          />
          <Metric label="До первого заказа" value={fmtDur(toFirstOrder)} hint="сели → на кухню" />
          <Metric
            label="Кухня, среднее"
            value={fmtDur(kitchenAvg)}
            hint={kitchenDone.length ? `по ${kitchenDone.length} поз.` : 'ещё нет поданных'}
          />
          <Metric label="Подача → оплата" value={fmtDur(payWait)} hint={payWait === null ? 'после полной оплаты' : 'ожидание денег'} />
          <Metric
            label="Темп выручки"
            value={revPerHour ? `${Math.round(revPerHour).toLocaleString('ru-RU')} ₽/ч` : '—'}
            hint={revPerHour ? 'оплачено / время стола' : 'считаем после 10 минут'}
          />
          <Metric label="Чек на гостя" value={perGuest ? fmt(perGuest) : '—'} hint={`счёт / ${personas.length || 0} гост.`} />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', overflow: 'auto' }}>
        <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid #ECECEF', padding: 22, background: '#FAFAFB' }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#9A9AA4', marginBottom: 14 }}>
            Гости стола · {personas.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {personaCards.map(({ p, total, paid, payLabel, orderLabel }) => (
              <div
                key={p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', borderRadius: 18, background: '#fff', border: '1px solid #ECECEF' }}
              >
                <Avatar animal={p.animal} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{p.name}</div>
                  <div style={{ fontSize: 12.5, color: '#8A8A92', marginTop: 2 }}>
                    {fmt(total)} с долей общих{paid > 0 ? ` · внесено ${fmt(paid)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, padding: '3px 8px', borderRadius: 50, background: '#EFEFF2', color: '#7A7A84' }}>{orderLabel}</span>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 9.5,
                      padding: '3px 8px',
                      borderRadius: 50,
                      background: payLabel === 'Оплачено' ? '#E4F6EA' : payLabel === 'Частично' ? '#EDE7FD' : '#FFF2DA',
                      color: payLabel === 'Оплачено' ? '#1F9D55' : payLabel === 'Частично' ? '#7C5CFC' : '#B07A12'
                    }}
                  >
                    {payLabel}
                  </span>
                </div>
              </div>
            ))}
            {personas.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 15, borderRadius: 18, border: '1.5px dashed #CFCFD6' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#F0F0F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#9A9AA4' }}>
                  +
                </div>
                <span style={{ fontWeight: 540, fontSize: 15, color: '#7A7A84' }}>
                  {isOpen ? 'Ждём гостей…' : 'Стол свободен — гость откроет его, отсканировав QR'}
                </span>
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
            {lines.length === 0 && (
              <div style={{ padding: '18px 0', fontSize: 14, color: '#9A9AA4' }}>
                Пока пусто — гости ещё ничего не добавили
              </div>
            )}
            {lines.map(l => {
              const d = findDish(l.dishId)
              if (!d) return null
              return (
                <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: '1px solid #F2F2F4' }}>
                  {l.shared ? <SharedIcon size={40} /> : <Avatar animal={animalOf(l.personaId)} size={40} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15.5 }}>
                      {d.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#8A8A92' }}>
                      {l.shared ? `общее на стол · добавил(а) ${nameOf(l.personaId)}` : `${nameOf(l.personaId)} · своё`}
                    </div>
                  </div>
                  {l.served ? (
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '4px 9px', borderRadius: 50, background: '#E4F6EA', color: '#1F9D55', marginRight: 6 }}>
                      ПОДАНО{l.sentAt && l.servedAt ? ` · ${fmtDur(l.servedAt - l.sentAt)}` : ''}
                    </span>
                  ) : l.sent ? (
                    <button
                      onClick={() => void serveLine(l.uid)}
                      title="Отметить поданным"
                      style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '5px 10px', borderRadius: 50, background: '#FFF2DA', color: '#B07A12', border: '1px dashed #E8C87A', cursor: 'pointer', marginRight: 6 }}
                    >
                      ГОТОВИТСЯ {l.sentAt ? fmtDur(now - l.sentAt) : ''} → ПОДАТЬ ✓
                    </button>
                  ) : (
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '4px 9px', borderRadius: 50, background: '#EFEFF2', color: '#7A7A84', marginRight: 6 }}>
                      ЧЕРНОВИК
                    </span>
                  )}
                  <span style={{ fontWeight: 620, fontSize: 15 }}>{fmt(d.price * l.qty)}</span>
                </div>
              )
            })}
          </div>

          {payments.length > 0 && (
            <>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#9A9AA4', marginBottom: 14 }}>
                Оплаты
              </div>
              <div style={{ background: '#fff', border: '1px solid #ECECEF', borderRadius: 20, padding: '6px 20px' }}>
                {payments.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderBottom: '1px solid #F2F2F4' }}>
                    <Avatar animal={animalOf(p.personaId)} size={34} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 560, fontSize: 14.5 }}>{nameOf(p.personaId)}</div>
                      <div style={{ fontSize: 12, color: '#8A8A92' }}>
                        {p.scope === 'own' ? 'своя часть' : p.scope === 'equal' ? 'поровну' : 'весь стол'} · СБП
                      </div>
                    </div>
                    <span style={{ fontWeight: 660, fontSize: 15, color: '#1F9D55' }}>{fmt(p.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
