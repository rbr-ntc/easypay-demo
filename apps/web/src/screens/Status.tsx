import { NAVY, findDish, optionsLabel } from '../data'
import { Avatar, SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore } from '../store'
import { sharersOf } from '@easypay/domain/money'
import { OrderProgress } from './OrderProgress'

const STEP_LABELS = ['Принят', 'Готовится', 'Подано']

export function Status() {
  const { patch, me, snap, callWaiter, cancelMine } = useStore()
  if (!me || !snap) return null

  const sentOwn = snap.lines.filter(l => l.sent && !l.shared)
  const sentShared = snap.lines.filter(l => l.sent && l.shared)
  const allSent = snap.lines.filter(l => l.sent)

  // Полоска отвечает на вопрос гостя «где МОЯ еда», поэтому считается по его
  // позициям и общим блюдам, в которых он участвует. Чужой кофе её не держит.
  // Участники общего блюда берутся тем же правилом, что и в деньгах: пустой
  // список означает «делят все за столом», иначе блюдо выпадало из «моих»
  // и полоска рапортовала «всё подано», когда общее ещё готовилось.
  const personaIds = snap.personas.map(p => p.id)
  const mineSent = allSent.filter(
    l => l.personaId === me.id || (l.shared && sharersOf(l as any, personaIds).includes(me.id))
  )
  const mineServed = mineSent.length > 0 && mineSent.every(l => l.served || l.cancelled)
  const tableStillCooking = allSent.filter(l => !l.served && !l.cancelled)
  const allServed = allSent.length > 0 && allSent.every(l => l.served || l.cancelled)

  const steps = STEP_LABELS.map((label, i) => ({
    label,
    st: i === 0 ? ('done' as const) : mineServed ? ('done' as const) : i === 1 ? ('active' as const) : ('todo' as const)
  }))
  const nameOf = (pid: string) => snap.personas.find(p => p.id === pid)?.name ?? '?'
  const animalOf = (pid: string) => snap.personas.find(p => p.id === pid)?.animal ?? 'fox'
  const stillChoosing = snap.personas.filter(p => snap.lines.some(l => !l.sent && l.personaId === p.id))

  return (
    <div className="ep-screen">
      <div className="ep-scroll" style={{ padding: '26px 22px 18px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 22 }}>
          <div className="ep-pop" style={{ width: 78, height: 78, borderRadius: '50%', background: '#DCEEB1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontSize: 34, color: '#3A6B12' }}>
            ✓
          </div>
          <div style={{ fontWeight: 300, fontSize: 28, lineHeight: 1.12, letterSpacing: '-0.9px' }}>
            {mineServed ? 'Всё подано.' : 'Заказ принят.'}
            <br />
            Приятного аппетита!
          </div>
        </div>

        <OrderProgress steps={steps} />

        {mineServed && tableStillCooking.length > 0 && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ep-muted)', marginTop: -8, marginBottom: 18 }}>
            Вам подали всё. За столом ещё готовится:{' '}
            {tableStillCooking
              .map(l => `${findDish(l.dishId)?.name ?? '?'} (${nameOf(l.personaId)})`)
              .join(', ')}
          </div>
        )}

        <Card style={{ padding: '6px 16px', marginBottom: 14 }}>
          {sentOwn.map(l => {
            const d = findDish(l.dishId)
            if (!d) return null
            const mine = l.personaId === me.id
            return (
              <div key={l.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '1px solid var(--ep-soft)' }}>
                <Avatar animal={animalOf(l.personaId)} size={32} label={nameOf(l.personaId)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 540, fontSize: 14.5 }}>
                    {d.name}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ep-muted)' }}>
                    {nameOf(l.personaId)}
                    {mine ? ' · своё' : ''}
                    {optionsLabel(l.options) ? ` · ${optionsLabel(l.options)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 'var(--ep-r-pill)', background: l.served ? '#E4F6EA' : l.startedAt ? '#FFF2DA' : 'var(--ep-soft)', color: l.served ? '#1F9D55' : l.startedAt ? '#B07A12' : 'var(--ep-muted)' }}>
                    {l.served ? 'Подано' : l.readyAt ? 'Несут' : l.startedAt ? 'Готовится' : 'В очереди'}
                  </span>
                  {/* Пока кухня не взялась, гость может передумать сам: раньше он
                      платил за капучино, который начали делать через восемь минут */}
                  {mine && !l.served && !l.cancelled && !l.startedAt && (
                    <button
                      onClick={() => void cancelMine(l.uid)}
                      style={{ border: 'none', background: 'transparent', color: 'var(--ep-muted)', fontSize: 12, cursor: 'pointer', padding: 0 }}
                    >
                      отменить
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {sentShared.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0' }}>
              <SharedIcon size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 540, fontSize: 14.5 }}>Общие блюда</div>
                <div style={{ fontSize: 12, color: 'var(--ep-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sentShared.map(l => `${findDish(l.dishId)?.name ?? '?'}${l.served ? ' ✓' : ''}`).join(', ')}
                </div>
              </div>
              {(() => {
                // Общие блюда показывали вечное «Принято» независимо от кухни:
                // гость видел «готовится» там, где официант уже отчитался о подаче
                const servedAll = sentShared.every(l => l.served)
                const servedSome = sentShared.some(l => l.served)
                const label = servedAll ? 'Подано' : servedSome ? 'Частично' : 'Готовится'
                return (
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 'var(--ep-r-pill)', background: servedAll ? '#E4F6EA' : '#FFF2DA', color: servedAll ? '#1F9D55' : '#B07A12' }}>
                    {label}
                  </span>
                )
              })()}
            </div>
          )}
          {sentOwn.length === 0 && sentShared.length === 0 && (
            <div style={{ padding: '16px 0', fontSize: 14, color: 'var(--ep-muted)' }}>На кухню пока ничего не отправлено</div>
          )}
        </Card>

        {stillChoosing.length > 0 && (
          <WarnBanner>
            <Avatar animal={stillChoosing[0].animal} size={26} label={stillChoosing[0].name} />
            <span style={{ fontSize: 13, color: '#7A5A12' }}>
              <b style={{ fontWeight: 620 }}>{stillChoosing.map(p => p.name).join(', ')}</b> ещё{' '}
              {stillChoosing.length === 1 ? 'выбирает' : 'выбирают'} блюда
            </span>
          </WarnBanner>
        )}
      </div>

      <StickyFooter>
        <div style={{ display: 'flex', gap: 10 }}>
          <GhostButton style={{ flex: 1 }} onClick={() => patch({ screen: 'menu' })}>
            Дозаказать
          </GhostButton>
          <GhostButton
            style={{ flex: 1, opacity: snap.call ? 0.6 : 1 }}
            onClick={() => !snap.call && patch({ sheet: 'call' })}
          >
            {snap.call ? 'Официант идёт ✓' : 'Позвать официанта'}
          </GhostButton>
        </div>
        <PrimaryButton onClick={() => patch({ screen: 'payment', payStage: 'form' })}>
          Оплатить, когда будете готовы
        </PrimaryButton>
      </StickyFooter>
    </div>
  )
}
