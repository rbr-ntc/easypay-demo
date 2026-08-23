import { findDish, optionsLabel } from '../data'
import { Avatar, SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore } from '../store'
import { sharersOf } from '@easypay/domain/money'
import { OrderProgress } from './OrderProgress'
import { lineStage, stageLabel, STAGE_BADGE } from '../lineStage'

const STEP_LABELS = ['Принят', 'Готовится', 'Подано']

export function Status() {
  const { patch, me, snap, cancelMine } = useStore()
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

  // Кухня взялась хотя бы за одно моё блюдо — только тогда «готовится».
  // Раньше кастрюля кипела на экране, пока заказ стоял в очереди нетронутым.
  const mineCooking = mineSent.some(l => l.startedAt && !l.served)

  const steps = STEP_LABELS.map((label, i) => {
    if (mineServed) return { label, st: 'done' as const }
    if (i === 0) return { label, st: mineCooking ? ('done' as const) : ('active' as const) }
    if (i === 1) return { label, st: mineCooking ? ('active' as const) : ('todo' as const) }
    return { label, st: 'todo' as const }
  })
  const nameOf = (pid: string) => snap.personas.find(p => p.id === pid)?.name ?? '?'
  const animalOf = (pid: string) => snap.personas.find(p => p.id === pid)?.animal ?? 'fox'
  const stillChoosing = snap.personas.filter(p => snap.lines.some(l => !l.sent && l.personaId === p.id))

  return (
    <div className="ep-screen">
      <div className="ep-scroll px-5 pt-6 pb-4">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="ep-pop mb-4 flex size-20 items-center justify-center rounded-full bg-success/20 text-4xl text-success">
            ✓
          </div>
          <div className="text-3xl leading-tight font-light tracking-tight">
            {mineServed ? 'Всё подано.' : mineCooking ? 'Уже готовим.' : 'Заказ принят.'}
            <br />
            Приятного аппетита!
          </div>
        </div>

        <OrderProgress steps={steps} />

        {mineServed && tableStillCooking.length > 0 && (
          <div className="mb-4 text-center text-sm text-base-content/60">
            Вам подали всё. За столом ещё готовится:{' '}
            {tableStillCooking.map(l => `${findDish(l.dishId)?.name ?? '?'} (${nameOf(l.personaId)})`).join(', ')}
          </div>
        )}

        <Card className="mb-3.5">
          <div className="card-body gap-0 px-4 py-1.5">
            {sentOwn.map(l => {
              const d = findDish(l.dishId)
              if (!d) return null
              const mine = l.personaId === me.id
              return (
                <div key={l.uid} className="flex items-center gap-3 border-b border-base-200 py-3">
                  <Avatar animal={animalOf(l.personaId)} size={32} label={nameOf(l.personaId)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {d.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                    </div>
                    <div className="text-xs text-base-content/60">
                      {nameOf(l.personaId)}
                      {mine ? ' · своё' : ''}
                      {optionsLabel(l.options) ? ` · ${optionsLabel(l.options)}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`badge badge-sm ${STAGE_BADGE[lineStage(l)]}`}>{stageLabel(l)}</span>
                    {/* Пока кухня не взялась, гость может передумать сам: раньше он
                        платил за капучино, который начали делать через восемь минут */}
                    {mine && !l.served && !l.cancelled && !l.startedAt && (
                      <button className="btn btn-ghost btn-xs" onClick={() => void cancelMine(l.uid)}>
                        отменить
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {sentShared.length > 0 && (
              <div className="flex items-center gap-3 py-3">
                <SharedIcon size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Общие блюда</div>
                  <div className="truncate text-xs text-base-content/60">
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
                    <span className={`badge badge-sm ${servedAll ? STAGE_BADGE.served : STAGE_BADGE.cooking}`}>
                      {label}
                    </span>
                  )
                })()}
              </div>
            )}
            {sentOwn.length === 0 && sentShared.length === 0 && (
              <div className="py-4 text-sm text-base-content/60">На кухню пока ничего не отправлено</div>
            )}
          </div>
        </Card>

        {stillChoosing.length > 0 && (
          <WarnBanner>
            <Avatar animal={stillChoosing[0].animal} size={26} label={stillChoosing[0].name} />
            <span className="text-sm">
              <b>{stillChoosing.map(p => p.name).join(', ')}</b> ещё{' '}
              {stillChoosing.length === 1 ? 'выбирает' : 'выбирают'} блюда
            </span>
          </WarnBanner>
        )}
      </div>

      <StickyFooter>
        <div className="flex gap-2.5">
          <GhostButton className="flex-1" onClick={() => patch({ screen: 'menu' })}>
            Дозаказать
          </GhostButton>
          <GhostButton
            className={snap.call ? 'flex-1 btn-disabled' : 'flex-1'}
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
