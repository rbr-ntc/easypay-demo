import { findDish, MENU, optionsLabel } from '../data'
import { tableId } from '../api'
import type { ServerLine } from '../api'
import { Avatar } from '../avatars'
import { useStore } from '../store'
import { fmt } from '../format'
import { fmtDur } from '../waiter/duration'
import { lineStage } from '../lineStage'
import { sharersOf } from '@easypay/domain/money'
import { DishPhoto } from './Menu'

/**
 * Экран «Стол» — вместо корзины и статуса.
 *
 * Раньше ответ на вопрос «что уже ушло на кухню, а что нет» был размазан по
 * двум экранам: черновик жил в корзине, отправленное — в статусе, и гость
 * ходил между ними, чтобы собрать картинку. Здесь всё в одном месте и
 * разделено визуально: пунктирная рамка — ещё у вас, еловая карточка — уже
 * на кухне.
 */

/** Три сегмента пути блюда: принят → готовится → несут. */
function StageBar({ line }: { line: ServerLine }) {
  const stage = lineStage(line)
  const lit = stage === 'ready' ? 3 : stage === 'cooking' ? 2 : 1
  return (
    <div className="mt-2.5 flex items-center gap-1.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded-full"
          style={{
            background: i < lit ? '#D5F94E' : 'rgba(250,245,234,.16)',
            // Текущий сегмент приглушён: он ещё идёт, а не закончился
            opacity: i === lit - 1 && stage === 'cooking' ? 0.55 : 1
          }}
        />
      ))}
    </div>
  )
}

/** Подпись стадии словами — та же, что видит персонал. */
function stageCaption(line: ServerLine, now: number): string {
  const stage = lineStage(line)
  if (stage === 'cancelled') return `Отменено${line.cancelReason ? ` · ${line.cancelReason}` : ''}`
  if (stage === 'served') {
    return line.servedAt ? `Подано ${fmtDur(now - line.servedAt)} назад ✓` : 'Подано ✓'
  }
  if (stage === 'ready') return 'Готово — несут к вам'
  if (stage === 'cooking') {
    return line.startedAt ? `Готовится · прошло ${fmtDur(now - line.startedAt)}` : 'Готовится'
  }
  return line.sentAt ? `В очереди · ${fmtDur(now - line.sentAt)}` : 'В очереди'
}

export function Table({ now }: { now: number }) {
  const { ui, patch, me, snap, totals, removeLine, cancelMine, forgetMe } = useStore()
  if (!me || !snap) return null

  const mineTab = totals.myTotal + totals.myDraft
  const lines = snap.lines
  const personaIds = snap.personas.map(p => p.id)
  /**
   * «Моё» среди ОТПРАВЛЕННОГО — свои позиции и общие, в которых я участвую.
   * Доля общего фиксируется в момент отправки (`sharedWith`), поэтому до
   * отправки общего «моего» не существует.
   */
  const isMineSent = (l: ServerLine) =>
    l.personaId === me.id || (l.shared && sharersOf(l as any, personaIds).includes(me.id))

  // В одиночку выбора нет: «моё» и «стол» — одно и то же
  const scope: 'mine' | 'all' = snap.personas.length > 1 ? ui.tableTab : 'mine'
  const live = lines.filter(l => !l.cancelled)

  /**
   * Черновик «моё» — только собственные позиции. У неотправленной общей
   * позиции `sharedWith` пуст, и `sharersOf` считает участниками весь стол:
   * чужой общий стейк попадал ко мне в черновик целой ценой, а кнопка
   * «Отправить на кухню» его не отправляла — сервер шлёт только мои строки.
   */
  const draft = live.filter(l => !l.sent && (scope === 'all' || l.personaId === me.id))
  const sent = live.filter(l => l.sent && (scope === 'all' || isMineSent(l)))
  // Сумму черновика считает сервер: клиент её только показывает
  const draftSum = scope === 'all' ? totals.draftTotal : totals.myDraft

  // Отменённое не исчезает молча: гость должен узнать, что блюдо сняли и почему
  const dropped = lines.filter(l => l.cancelled && (scope === 'all' || l.personaId === me.id))

  const nameOf = (pid: string) => snap.personas.find(p => p.id === pid)?.name ?? '?'
  const openedFor = snap.openedAt ? fmtDur(now - snap.openedAt) : null

  return (
    <div className="ep-screen">
      <div className="ep-forest shrink-0 rounded-b-[26px] px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            aria-label="Назад в меню"
            onClick={() => patch({ screen: 'menu' })}
            className="size-11 shrink-0 rounded-full text-lg font-extrabold"
            style={{ border: '1px solid rgba(250,245,234,.22)' }}
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[21px] leading-tight font-extrabold tracking-tight">Стол {tableId}</div>
            <div className="truncate text-[13px] font-semibold" style={{ color: '#8CA396' }}>
              {snap.personas.length} {snap.personas.length === 1 ? 'гость' : snap.personas.length < 5 ? 'гостя' : 'гостей'}
              {openedFor ? ` · ${openedFor}` : ''}
            </div>
          </div>
          <div className="flex">
            {snap.personas.slice(0, 4).map((p, i) => (
              <span
                key={p.id}
                className="flex size-8.5 items-center justify-center rounded-full"
                style={{ border: '2px solid #062119', marginLeft: i === 0 ? 0 : -12 }}
              >
                <Avatar animal={p.animal} size={30} label={p.name} />
              </span>
            ))}
          </div>
        </div>

        {snap.personas.length > 1 && (
          <div className="mt-3.5 flex gap-1.5 rounded-field p-1.5" style={{ background: 'rgba(250,245,234,.1)' }}>
            <SegButton active={scope === 'mine'} onClick={() => patch({ tableTab: 'mine' })}>
              Моё · {fmt(mineTab)}
            </SegButton>
            <SegButton active={scope === 'all'} onClick={() => patch({ tableTab: 'all' })}>
              Стол · {fmt(totals.tableTotal + totals.draftTotal)}
            </SegButton>
          </div>
        )}
      </div>

      <div className="ep-scroll flex flex-col gap-4 px-5 pt-4 pb-5">
        {/* Черновик отделён пунктиром: это единственное, что ещё у гостя в руках */}
        {draft.length > 0 && (
          <div
            className="rounded-box bg-white p-4"
            style={{ border: '1.5px dashed #9E4225' }}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="ep-pulse size-2 rounded-full" style={{ background: '#9E4225' }} />
              <span className="text-[15px] font-extrabold" style={{ color: '#9E4225' }}>
                Ещё не отправлено на кухню
              </span>
              <span className="ep-sum ml-auto text-[15px] font-extrabold">{fmt(draftSum)}</span>
            </div>

            {draft.map(l => {
              const d = findDish(l.dishId)
              if (!d) return null
              return (
                <div key={l.uid} className="flex items-center gap-3 py-1">
                  <div className="relative size-13 shrink-0 overflow-hidden rounded-field">
                    <DishPhoto dish={d} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px] font-bold">
                      {d.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] font-semibold text-muted">
                      {[optionsLabel(l.options), l.shared ? 'на всех' : nameOf(l.personaId)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="ep-sum text-[15px] font-bold">{fmt(l.price * l.qty)}</div>
                  {l.personaId === me.id && (
                    <button
                      aria-label={`Убрать ${d.name}`}
                      onClick={() => void removeLine(l.uid)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-muted"
                      style={{ background: '#F1EBDD' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )
            })}

            <button
              onClick={() => patch({ sheet: 'send', sendChecked: false, sendScope: scope === 'all' ? 'all' : 'mine' })}
              className="ep-forest mt-3.5 h-13 w-full rounded-field text-[16px] font-extrabold"
              style={{ color: '#D5F94E' }}
            >
              Отправить на кухню · {fmt(draftSum)}
            </button>
          </div>
        )}

        {sent.length > 0 && (
          <div>
            <div className="ep-brow mb-2.5">На кухне и в зале</div>
            <div className="ep-forest overflow-hidden rounded-box">
              {sent.map((l, i) => {
                const d = findDish(l.dishId)
                if (!d) return null
                const stage = lineStage(l)
                const done = stage === 'served'
                const sharers = l.shared ? sharersOf(l as any, personaIds).length || snap.personas.length : 1
                return (
                  <div
                    key={l.uid}
                    className="flex items-start gap-3 p-4"
                    style={i < sent.length - 1 ? { borderBottom: '1px solid rgba(250,245,234,.1)' } : undefined}
                  >
                    <div
                      className="relative size-13 shrink-0 overflow-hidden rounded-field"
                      style={done ? { opacity: 0.6 } : undefined}
                    >
                      <DishPhoto dish={d} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-[16px] font-bold"
                          style={{ color: done ? '#B7C7BC' : '#FAF5EA' }}
                        >
                          {d.name}
                          {l.qty > 1 ? ` ×${l.qty}` : ''}
                        </span>
                        {l.shared && (
                          <span
                            className="inline-flex h-6.5 items-center rounded-full px-2.5 text-[12px] font-bold"
                            style={{ background: 'rgba(213,249,78,.16)', color: '#D5F94E' }}
                          >
                            на всех ÷{sharers}
                          </span>
                        )}
                      </div>
                      <div
                        className="mt-0.5 truncate text-[13px] font-semibold"
                        style={{ color: done ? '#7B8F83' : '#8CA396' }}
                      >
                        {[
                          optionsLabel(l.options),
                          l.shared
                            ? `добавил${l.personaId === me.id ? 'и вы' : ` ${nameOf(l.personaId)}`} · ваша доля ${fmt((l.price * l.qty) / sharers)}`
                            : l.personaId === me.id
                              ? 'вам'
                              : `${nameOf(l.personaId)}у`
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>

                      {!done && <StageBar line={l} />}
                      <div
                        className="mt-2 text-[13px] font-bold"
                        style={{ color: done ? '#7B8F83' : '#D5F94E' }}
                      >
                        {stageCaption(l, now)}
                      </div>

                      {/* Пока кухня не взялась, гость может передумать сам */}
                      {l.personaId === me.id && !l.served && !l.cancelled && !l.startedAt && (
                        <button
                          onClick={() => void cancelMine(l.uid)}
                          className="mt-1.5 text-[13px] font-semibold underline"
                          style={{ color: '#8CA396' }}
                        >
                          отменить
                        </button>
                      )}
                    </div>
                    <div
                      className="ep-sum text-[15px] font-bold"
                      style={{ color: done ? '#B7C7BC' : '#FAF5EA' }}
                    >
                      {fmt(l.price * l.qty)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Апселл — ТОЛЬКО после первой подачи и один раз: предлагать добавку
            человеку, который ещё ждёт свой заказ, — раздражать его. */}
        {!ui.upsellShown && sent.some(l => l.served) && <Upsell />}

        {dropped.length > 0 && (
          <div className="rounded-box bg-white p-4" style={{ border: '1.5px solid #DFD6C3' }}>
            <div className="ep-brow mb-2.5">Снято с заказа</div>
            {dropped.map(l => {
              const d = findDish(l.dishId)
              return (
                <div key={l.uid} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-[14px] font-semibold text-muted line-through">
                    {d?.name ?? l.dishId}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                  </span>
                  <span className="text-[13px] font-semibold text-muted-soft">
                    {l.cancelReason ?? 'отменено'}
                  </span>
                </div>
              )
            })}
            <div className="mt-2 text-[12px] font-semibold text-muted-soft">
              В счёт не входит — платить за это не нужно
            </div>
          </div>
        )}

        {snap.personas.length > 1 && (
          <div className="rounded-box bg-white p-4" style={{ border: '1px solid #E3DCCB' }}>
            <div className="ep-brow mb-3">Кто что должен</div>
            {snap.personas.map((p, i) => {
              const own = totals.personaTotal(p.id)
              const paid = totals.personaPaid(p.id)
              const left = totals.personaRemaining(p.id)
              const took = lines
                .filter(l => l.personaId === p.id && !l.cancelled)
                .map(l => findDish(l.dishId)?.name ?? '?')
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 py-3"
                  style={i < snap.personas.length - 1 ? { borderBottom: '1px solid #F0EADC' } : undefined}
                >
                  <Avatar animal={p.animal} size={36} label={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold">
                      {p.name}
                      {p.id === me.id ? ' · вы' : ''}
                    </div>
                    <div className="truncate text-[13px] font-semibold text-muted">
                      {paid > 0 && left <= 0.01
                        ? `оплатил${paid > 0 ? ` ${fmt(paid)}` : ''}`
                        : took.length
                          ? took.join(', ')
                          : 'ещё выбирает'}
                    </div>
                  </div>
                  <div className="ep-sum text-right">
                    <div
                      className="text-[15px] font-extrabold"
                      style={left <= 0.01 && own > 0 ? { color: '#15603F' } : undefined}
                    >
                      {fmt(left)}
                    </div>
                    {paid > 0 && left > 0.01 && (
                      <div className="text-[12px] font-semibold text-muted">внесено {fmt(paid)}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {draft.length === 0 && sent.length === 0 && (
          <div className="px-5 py-16 text-center">
            <div className="font-bold">Пока пусто</div>
            <div className="mt-1 text-sm text-muted">Добавьте что-нибудь из меню</div>
          </div>
        )}

        {/* Телефон передали соседу — он должен мочь стать собой. Раньше это
            жило на экране приветствия, а вместе с ним и пропало: новый гость
            навсегда оставался предыдущим и заказывал на его имя. */}
        <button
          onClick={forgetMe}
          className="mx-auto py-2 text-[13px] font-semibold underline text-muted-soft"
        >
          Я другой гость — начать со своим именем
        </button>
      </div>

      <div className="flex shrink-0 gap-2.5 px-5 pt-3 pb-[calc(1.375rem+env(safe-area-inset-bottom))]">
        <button
          onClick={() => patch({ screen: 'menu' })}
          className="h-14 shrink-0 rounded-field px-5 text-[15px] font-bold"
          style={{ border: '1px solid #DFD6C3' }}
        >
          + Ещё
        </button>
        <button
          disabled={totals.myRemaining <= 0.01 && totals.remaining <= 0.01}
          // Своё оплачено, а по столу остаток: открываем оплату сразу за стол,
          // иначе гость упирается в неактивную кнопку «Оплатить · 0 ₽»
          onClick={() =>
            patch({
              screen: 'payment',
              payStage: 'form',
              payScope: totals.myRemaining > 0.01 ? 'own' : 'full'
            })
          }
          className="h-14 flex-1 rounded-field text-[16px] font-extrabold disabled:opacity-45"
          style={{ background: '#D5F94E', color: '#062119', boxShadow: '0 12px 26px -14px rgba(6,33,25,.9)' }}
        >
          Заплатить · {fmt(totals.myRemaining > 0.01 ? totals.myRemaining : totals.remaining)}
        </button>
      </div>
    </div>
  )
}

/**
 * «Ещё по одной» — предложение добавки после того, как еду принесли.
 * Берём напитки и десерты: то, что заказывают вторым кругом, а не вместо ужина.
 */
function Upsell() {
  const { patch, snap } = useStore()
  const alreadyOrdered = new Set((snap?.lines ?? []).map(l => l.dishId))
  const picks = ['Напитки', 'Десерты']
    .flatMap(c => MENU[c] ?? [])
    .filter(d => !d.stop && !alreadyOrdered.has(d.id))
    .slice(0, 4)
  if (picks.length === 0) return null

  return (
    <div className="ep-forest rounded-box p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-extrabold">Ещё по одной?</div>
          <div className="mt-0.5 text-[13px] font-semibold" style={{ color: '#8CA396' }}>
            Пока не разошлись — добавка к столу
          </div>
        </div>
        <button
          aria-label="Скрыть предложение"
          onClick={() => patch({ upsellShown: true })}
          className="size-9 shrink-0 rounded-full text-[15px] font-bold"
          style={{ border: '1px solid rgba(250,245,234,.22)', color: '#8CA396' }}
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
        {picks.map(d => (
          <button
            key={d.id}
            onClick={() => patch({ sheet: 'dish', currentDishId: d.id, upsellShown: true })}
            className="w-32 shrink-0 rounded-field p-2.5 text-left"
            style={{ background: 'rgba(250,245,234,.08)' }}
          >
            <div className="relative mb-2 h-16 overflow-hidden rounded-field">
              <DishPhoto dish={d} />
            </div>
            <div className="truncate text-[13px] font-bold">{d.name}</div>
            <div className="ep-sum text-[13px] font-extrabold" style={{ color: '#D5F94E' }}>
              {fmt(d.price)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function SegButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="ep-sum h-11 flex-1 rounded-xl text-[15px]"
      style={
        active
          ? { background: '#D5F94E', color: '#062119', fontWeight: 800 }
          : { color: '#8CA396', fontWeight: 700 }
      }
    >
      {children}
    </button>
  )
}

