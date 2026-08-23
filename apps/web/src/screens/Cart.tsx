import { useState } from 'react'
import { findDish, optionsLabel } from '../data'
import { tableId } from '../api'
import { Avatar, SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'
import { lineStage, stageLabel, STAGE_BADGE } from '../lineStage'

/**
 * Бейдж называет ровно то состояние, в котором блюдо находится. Раньше здесь
 * было жёстко «Готовится» на всём отправленном — и корзина спорила с экраном
 * статуса, где та же позиция называлась «В очереди».
 */
function SentBadge({ line }: { line: Parameters<typeof stageLabel>[0] }) {
  return <span className={`badge badge-sm shrink-0 ${STAGE_BADGE[lineStage(line)]}`}>{stageLabel(line)}</span>
}

export function Cart() {
  const { patch, me, snap, totals, removeLine } = useStore()
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
      <div className="shrink-0 border-b border-base-300 bg-base-100 px-5 py-3.5">
        <div className="text-xl font-bold tracking-tight">Заказ · Стол №{tableId}</div>
      </div>

      <div className="ep-scroll flex flex-col gap-3 px-5 pt-3.5 pb-5">
        {/* Мой заказ */}
        <Card>
          <div className="card-body gap-0 p-4">
            <div className={`flex items-center gap-3 ${myLines.length ? 'mb-3.5' : ''}`}>
              <Avatar animal={me.animal} size={40} label={me.name} />
              <div>
                <div className="font-semibold">{me.name}</div>
                <div className="text-xs text-base-content/60">мой заказ</div>
              </div>
              <span className="ml-auto text-lg font-bold">{fmt(totals.myOwn + totals.myDraft)}</span>
            </div>
            {myLines.length === 0 && (
              <div className="py-1 text-sm text-base-content/60">Пока пусто — добавьте блюда из меню</div>
            )}
            {myLines.map(l => {
              const d = findDish(l.dishId)
              if (!d) return null
              return (
                <div key={l.uid} className="mb-2 flex items-center gap-3 rounded-field bg-base-200 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {d.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                    </div>
                    {optionsLabel(l.options) && (
                      <div className="mt-0.5 text-xs text-base-content/60">{optionsLabel(l.options)}</div>
                    )}
                  </div>
                  <span className="text-sm">{fmt((l.price ?? d.price) * l.qty)}</span>
                  {l.sent ? (
                    <SentBadge line={l} />
                  ) : (
                    // Раньше это был span 10×15 px — пальцем на телефоне не попасть
                    <button
                      className="btn btn-ghost btn-circle size-11"
                      aria-label={`Убрать ${d.name}`}
                      onClick={() => void removeLine(l.uid)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

        {/* Весь стол (реальные гости) */}
        {others.length > 0 && (
          <div className={`collapse-arrow collapse card-border bg-base-100 ${tableOpen ? 'collapse-open' : ''}`}>
            <div className="collapse-title flex items-center gap-2.5" onClick={() => setTableOpen(!tableOpen)}>
              <div className="avatar-group -space-x-2">
                {others.slice(0, 4).map(p => (
                  <div key={p.id} className="avatar">
                    <Avatar animal={p.animal} size={26} label={p.name} />
                  </div>
                ))}
              </div>
              <span className="font-semibold">Весь стол</span>
              <span className="text-sm text-base-content/60">
                · ещё {others.length} {others.length === 1 ? 'гость' : others.length < 5 ? 'гостя' : 'гостей'}
              </span>
            </div>
            <div className="collapse-content">
              {others.map(p => {
                const pl = lines.filter(l => !l.shared && l.personaId === p.id)
                return (
                  <div key={p.id} className="flex items-center gap-3 border-t border-base-200 py-2.5">
                    <Avatar animal={p.animal} size={30} label={p.name} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="truncate text-xs text-base-content/60">
                        {pl.length ? pl.map(l => findDish(l.dishId)?.name ?? '?').join(', ') : 'ещё выбирает'}
                      </div>
                    </div>
                    <span className="text-sm">{fmt(totals.personaOwn(p.id))}</span>
                  </div>
                )
              })}
              <div className="flex justify-between border-t border-base-200 py-2.5 text-sm text-base-content/60">
                <span>Итого по столу (с общими)</span>
                <span className="font-semibold text-base-content">{fmt(totals.tableTotal)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Общие блюда — только реально добавленные */}
        {sharedLines.length > 0 && (
          <div className="card card-dash overflow-hidden border-accent bg-base-100">
            <div className="flex items-center gap-2.5 bg-accent/10 px-3.5 py-3">
              <SharedIcon size={30} />
              <span className="font-semibold">Общие блюда</span>
              <span className="ml-auto font-semibold">{fmt(totals.sharedTotal)}</span>
            </div>
            <div className="px-3.5 py-1.5">
              {sharedLines.map(l => {
                const d = findDish(l.dishId)
                if (!d) return null
                const mineAdded = l.personaId === me.id
                return (
                  <div key={l.uid} className="flex items-center gap-2.5 border-b border-base-200 py-2">
                    <span className="flex-1 text-sm">
                      {d.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                      <span className="text-xs text-accent"> · добавил(а) {nameOf(l.personaId)}</span>
                    </span>
                    <span className="text-sm">{fmt((l.price ?? d.price) * l.qty)}</span>
                    {l.sent ? (
                      <SentBadge line={l} />
                    ) : mineAdded ? (
                      <button
                        className="btn btn-ghost btn-circle size-11"
                        aria-label={`Убрать ${d.name}`}
                        onClick={() => void removeLine(l.uid)}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="px-3.5 pt-1 pb-3.5 text-xs text-base-content/60">
              Делится поровну: по {fmt(totals.sharedTotal / totals.participants)} на {totals.participants}{' '}
              {totals.participants === 1 ? 'гостя' : 'гостей'}
            </div>
          </div>
        )}
      </div>

      <StickyFooter>
        <div className="flex items-baseline justify-between px-1">
          <div className="text-sm text-base-content/60">
            {totals.myDraft > 0 ? (
              <>Ещё не отправлено: {fmt(totals.myDraft)}</>
            ) : (
              <>
                В счёте: {fmt(totals.myOwn)} своё
                {totals.sharedTotal > 0 ? ` + ${fmt(totals.myShare)} доля общего` : ''}
              </>
            )}
          </div>
          <div className="text-xl font-bold tracking-tight">{fmt(totals.myTotal + totals.myDraft)}</div>
        </div>
        <div className="flex gap-2.5">
          <GhostButton className="flex-1" onClick={() => patch({ screen: 'menu' })}>
            Дозаказать
          </GhostButton>
          <PrimaryButton
            className="flex-[1.5]"
            onClick={() => {
              if (!hasUnsentAny) {
                patch({ screen: 'status' })
                return
              }
              patch({ sheet: 'send', sendChecked: false, sendScope: hasUnsentMine ? 'mine' : 'all' })
            }}
          >
            {hasUnsentAny ? 'На кухню' : 'Статус заказа →'}
          </PrimaryButton>
        </div>
      </StickyFooter>
    </div>
  )
}
