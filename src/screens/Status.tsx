import { NAVY, findDish } from '../data'
import { Avatar, SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore } from '../store'

const STEP_LABELS = ['Принят', 'Готовится', 'Подано']

export function Status() {
  const { patch, me, snap } = useStore()
  if (!me || !snap) return null

  const sentOwn = snap.lines.filter(l => l.sent && !l.shared)
  const sentShared = snap.lines.filter(l => l.sent && l.shared)
  const allSent = snap.lines.filter(l => l.sent)
  const allServed = allSent.length > 0 && allSent.every(l => l.served)
  const steps = STEP_LABELS.map((label, i) => ({
    label,
    st: allServed ? ('done' as const) : i === 0 ? ('done' as const) : i === 1 ? ('active' as const) : ('todo' as const)
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
            {allServed ? 'Всё подано.' : 'Заказ принят.'}
            <br />
            Приятного аппетита!
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 22, padding: '0 6px' }}>
          {steps.map((x, i) => {
            const done = x.st === 'done'
            const active = x.st === 'active'
            return (
              <div key={x.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                {i > 0 && (
                  <div style={{ position: 'absolute', top: 17, right: '50%', width: '100%', height: 3, background: done || active ? '#1F9D55' : 'var(--ep-border)', zIndex: 0 }} />
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
                    background: done ? '#1F9D55' : active ? NAVY : 'var(--ep-surface)',
                    color: done || active ? 'var(--ep-on-ink)' : 'var(--ep-muted)',
                    border: x.st === 'todo' ? '2px solid var(--ep-border)' : 'none'
                  }}
                >
                  {done ? '✓' : ''}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: active ? 600 : 480, color: x.st === 'todo' ? 'var(--ep-muted)' : NAVY }}>{x.label}</div>
              </div>
            )
          })}
        </div>

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
                  </div>
                </div>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 'var(--ep-r-pill)', background: l.served ? '#E4F6EA' : '#FFF2DA', color: l.served ? '#1F9D55' : '#B07A12' }}>
                  {l.served ? 'Подано' : 'Готовится'}
                </span>
              </div>
            )
          })}
          {sentShared.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0' }}>
              <SharedIcon size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 540, fontSize: 14.5 }}>Общие блюда</div>
                <div style={{ fontSize: 12, color: 'var(--ep-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sentShared.map(l => findDish(l.dishId)?.name ?? '?').join(', ')}
                </div>
              </div>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 9.5, textTransform: 'uppercase', padding: '4px 9px', borderRadius: 'var(--ep-r-pill)', background: 'var(--ep-soft)', color: 'var(--ep-muted)' }}>
                Принято
              </span>
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
        <GhostButton onClick={() => patch({ screen: 'menu' })}>Дозаказать</GhostButton>
        <PrimaryButton onClick={() => patch({ screen: 'payment', payStage: 'form' })}>
          Оплатить, когда будете готовы
        </PrimaryButton>
      </StickyFooter>
    </div>
  )
}
