import { useEffect, useState } from 'react'
import { findDish, optionsLabel, WAITER_NAME } from '../data'
import { tableId } from '../api'
import type { ServerLine } from '../api'
import { Avatar } from '../avatars'
import { useStore } from '../store'
import { fmt, listNames, plural } from '../format'
import { fmtDur } from '../waiter/duration'
import { lineStage } from '../lineStage'
import { sharersOf, splitRounded } from '@easypay/domain/money'
import { artSet, dishPhoto, dishThumb } from '../guest/showcase'
import { AvatarStack, Slideshow } from '../guest/parts'

/**
 * «Стол» — что у вас, что на кухне, кто сколько должен.
 *
 * Черновик отделён от отправленного: черновик — единственное, что ещё в руках
 * гостя, его можно убрать; отправленное живёт плитками с прогрессом кухни.
 */

/** Подпись стадии словами — та же, что видит персонал. */
function caption(line: ServerLine, now: number): string {
  const stage = lineStage(line)
  if (stage === 'cancelled') return `Снято: ${line.cancelReason ?? 'отменено'} · в счёт не входит`
  if (stage === 'served') return line.servedAt ? `Подано ${fmtDur(now - line.servedAt)} назад` : 'Подано'
  if (stage === 'ready') return 'Готово — несут к вам'
  if (stage === 'cooking') return line.startedAt ? `Готовится · ${fmtDur(now - line.startedAt)}` : 'Готовится'
  return line.sentAt ? `В очереди на кухне · ${fmtDur(now - line.sentAt)}` : 'В очереди на кухне'
}

export function Table() {
  const { ui, patch, me, snap, totals, removeLine, cancelMine, forgetMe, sendWave, toast } = useStore()
  const [moreOpen, setMoreOpen] = useState(false)
  const [sending, setSending] = useState(false)
  // Подтверждение «отправить и соседей»: их черновики — чужой выбор
  const [confirmAll, setConfirmAll] = useState(false)
  // Секундный тик нужен только таймерам стадий на этом экране — раньше он
  // жил в корне гостя и перерисовывал всё меню каждую секунду
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!me || !snap) return null

  const personaIds = snap.personas.map(p => p.id)
  /**
   * «Моё» среди ОТПРАВЛЕННОГО — свои позиции и общие, в которых я участвую.
   * Доля общего фиксируется в момент отправки (`sharedWith`), поэтому до
   * отправки общего «моего» не существует.
   */
  const isMineSent = (l: ServerLine) =>
    l.personaId === me.id || (l.shared && sharersOf(l as any, personaIds).includes(me.id))

  // В одиночку выбора нет: «моё» и «стол» — одно и то же
  const company = snap.personas.length > 1
  const scope: 'mine' | 'all' = company ? ui.tableTab : 'mine'

  /**
   * Черновик «моё» — только собственные позиции. У неотправленной общей
   * позиции `sharedWith` пуст, и `sharersOf` считает участниками весь стол:
   * чужой общий стейк попадал ко мне в черновик целой ценой.
   */
  const draft = snap.lines.filter(l => !l.sent && !l.cancelled && (scope === 'all' || l.personaId === me.id))
  const sent = snap.lines.filter(l => (l.sent || l.cancelled) && (scope === 'all' || isMineSent(l)))
  // Сумму черновика считает сервер: клиент её только показывает
  const draftSum = scope === 'all' ? totals.draftTotal : totals.myDraft

  const nameOf = (pid: string) => snap.personas.find(p => p.id === pid)?.name ?? 'гость'
  const who = (l: ServerLine): string => {
    if (l.shared) {
      // До отправки доля не зафиксирована: делят те, кто за столом В МОМЕНТ
      // отправки. После — «ваша доля» только тем, кто в sharedWith, и той же
      // функцией, что у сервера: иначе подсевший позже видел «ваша доля»
      // за стейк, за который не платит, а 490 на троих давали 489,99
      if (!l.sent) return 'на всех · поделим при отправке'
      const sharers = sharersOf(l as any, personaIds)
      const k = sharers.indexOf(me.id)
      if (k < 0) return `на всех ÷${sharers.length}`
      const total = l.price * l.qty
      const part = splitRounded(sharers.map(() => total / sharers.length), total)[k]
      return `на всех ÷${sharers.length} · ваша доля ${fmt(part)}`
    }
    // Имя — как есть, без склонения: «Лизау» из приклеенной «у» мы уже видели
    return l.personaId === me.id ? 'вам' : nameOf(l.personaId)
  }
  const meta = (l: ServerLine) => [optionsLabel(l.options), who(l)].filter(Boolean).join(' · ')

  // Кто за столом ещё выбирает: у них есть неотправленное
  const othersDrafting = snap.personas.filter(
    p => p.id !== me.id && snap.lines.some(l => l.personaId === p.id && !l.sent && !l.cancelled)
  )
  const send = async (which: 'mine' | 'all') => {
    if (sending) return
    // Отправить чужой черновик — решить за соседа, что он выбрал. Это
    // предупреждение жило в шторке отправки 3.0 и пропало вместе с ней
    if (which === 'all' && othersDrafting.length > 0 && !confirmAll) {
      setConfirmAll(true)
      return
    }
    setSending(true)
    const ok = await sendWave(which)
    setSending(false)
    setConfirmAll(false)
    if (ok) toast('Ушло на кухню')
  }

  const guests = snap.personas.length
  const waiter = snap.waiter?.name ?? WAITER_NAME
  const sub = [
    `${guests} ${plural(guests, 'гость', 'гостя', 'гостей')}`,
    snap.openedAt ? `сидите ${fmtDur(now - snap.openedAt)}` : null,
    waiter
  ]
    .filter(Boolean)
    .join(' · ')

  const payable = totals.myRemaining > 0.01 ? totals.myRemaining : totals.remaining
  // «Всё оплачено» — только когда платили: у нового гостя с одним черновиком
  // платить ещё нечего, и «оплачено» было бы неправдой
  const payLabel =
    totals.myRemaining > 0.01
      ? `Заплатить · ${fmt(totals.myRemaining)}`
      : totals.remaining > 0.01
        ? `Заплатить за стол · ${fmt(totals.remaining)}`
        : totals.paidTotal > 0.01
          ? 'Всё оплачено'
          : 'Оплата — после отправки на кухню'

  const people = [...snap.personas].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0))

  return (
    <div className="g-anim-fade absolute inset-0 flex flex-col">
      <div className="g-noscroll flex-1 overflow-y-auto pb-6">
        <div className="relative h-75 overflow-hidden">
          <Slideshow images={artSet('table')} position="50% 35%" offset={1} />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, rgba(14,13,12,.55) 0%, rgba(14,13,12,0) 30%, color-mix(in oklch, var(--g-paper) 60%, transparent) 70%, var(--g-paper) 100%)'
            }}
          />
          <div className="absolute top-3.5 right-4 left-4 z-[2] flex items-center gap-2.5">
            <button
              aria-label="Назад в меню"
              onClick={() => patch({ screen: 'menu' })}
              className="size-11 rounded-full text-lg text-g-fg backdrop-blur-md"
              style={{ background: 'rgba(14,13,12,.45)' }}
            >
              ←
            </button>
            <div className="flex-1" />
            <button
              aria-label="Ещё"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(x => !x)}
              className="size-11 rounded-full text-lg text-g-fg backdrop-blur-md"
              style={{ background: 'rgba(14,13,12,.45)' }}
            >
              ⋯
            </button>
          </div>
          {moreOpen && (
            <div
              className="g-anim-fade absolute top-16 right-4 z-[9] w-62.5 rounded-2xl bg-g-s1 p-1.5"
              style={{ boxShadow: '0 20px 40px -16px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.1)' }}
            >
              <button
                onClick={() => {
                  setMoreOpen(false)
                  if ((snap.calls ?? []).some(c => c.personaId === me.id)) return toast(`${waiter} уже идёт`)
                  patch({ sheet: 'call' })
                }}
                className="h-12 w-full px-3 text-left text-[15px] text-g-fg"
              >
                Позвать официанта
              </button>
              {/* Телефон передали соседу — он должен мочь стать собой */}
              <button
                onClick={() => {
                  setMoreOpen(false)
                  forgetMe()
                  toast('Выберите имя при первом блюде')
                }}
                className="h-12 w-full px-3 text-left text-[15px] text-g-fg"
              >
                Я другой гость
              </button>
            </div>
          )}
          <div className="absolute right-5 bottom-1.5 left-5 text-center">
            <div className="flex justify-center">
              <AvatarStack personas={people} size={40} overlap={12} ring="var(--g-paper)" max={6} />
            </div>
            <h1 className="g-serif mt-2.5 text-[44px] text-g-fg">стол {tableId}</h1>
            <div className="mt-1 text-[13px] text-g-soft">{sub}</div>
          </div>
        </div>

        {company && (
          <div className="flex justify-center gap-6 px-5 pt-4.5 pb-1.5" role="tablist">
            {(
              [
                ['mine', `Моё · ${fmt(totals.myTotal + totals.myDraft)}`],
                ['all', `Стол · ${fmt(totals.tableTotal + totals.draftTotal)}`]
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={scope === k}
                onClick={() => patch({ tableTab: k })}
                className={`g-num py-1.5 text-[15px] ${scope === k ? 'font-bold text-g-fg' : 'text-g-dim'}`}
                style={scope === k ? { boxShadow: 'inset 0 -2px 0 #F3F0EA' } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {draft.length > 0 && (
          <div className="mx-4 mt-4 rounded-3xl bg-g-s1 p-4">
            <div className="flex items-baseline gap-2.5">
              <span className="flex-1 text-[17px] font-bold">Ещё не на кухне</span>
              <span className="text-[13px] text-g-mute">можно убрать</span>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {draft.map(l => {
                const d = findDish(l.dishId)
                return (
                  <div key={l.uid} className="flex items-center gap-3">
                    <div className="size-14 shrink-0 overflow-hidden rounded-2xl bg-g-sand">
                      <img src={dishThumb(l.dishId)} alt="" loading="lazy" className="size-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-bold">
                        {d?.name ?? l.name ?? l.dishId}
                        {l.qty > 1 ? ` ×${l.qty}` : ''}
                      </div>
                      <div className="g-num truncate text-[13px] text-g-mute">
                        {fmt(l.price * l.qty)} · {meta(l)}
                      </div>
                    </div>
                    {l.personaId === me.id && (
                      <button
                        aria-label={`Убрать ${d?.name ?? ''}`}
                        onClick={() => void removeLine(l.uid)}
                        className="size-11 shrink-0 rounded-full bg-g-sand text-[13px] text-g-mute"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {confirmAll ? (
              <div className="mt-3.5 rounded-[20px] p-3.5" style={{ border: '1px solid rgba(232,201,168,.4)' }}>
                <div className="text-[15px] font-bold text-g-tan">
                  {listNames(othersDrafting.map(p => p.name))} ещё {othersDrafting.length === 1 ? 'выбирает' : 'выбирают'}
                </div>
                <div className="mt-1 text-[13px] text-g-mute">Отправить и их черновики тоже — или только ваше?</div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void send('mine')}
                    disabled={sending}
                    className="h-12 flex-1 rounded-full bg-g-sand text-[15px] text-g-fg disabled:opacity-50"
                  >
                    Только моё
                  </button>
                  <button
                    onClick={() => void send('all')}
                    disabled={sending}
                    className="g-cta h-12 flex-1 rounded-full text-[15px] disabled:opacity-50"
                  >
                    Всё со стола
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => void send(scope)}
                disabled={sending}
                className="g-cta g-num mt-3.5 h-13 w-full rounded-full text-[15px] disabled:opacity-50"
              >
                {sending
                  ? 'Отправляем…'
                  : scope === 'all'
                    ? `Отправить всё со стола · ${fmt(draftSum)}`
                    : `Отправить на кухню · ${fmt(draftSum)}`}
              </button>
            )}
          </div>
        )}

        {sent.length > 0 && (
          <div className="px-4 pt-5.5">
            <h2 className="g-serif mx-1 mb-3.5 text-[28px]">на столе</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {sent.map(l => (
                <SentTile
                  key={l.uid}
                  line={l}
                  name={findDish(l.dishId)?.name ?? l.name ?? l.dishId}
                  meta={meta(l)}
                  caption={caption(l, now)}
                  canCancel={l.personaId === me.id && lineStage(l) === 'queued'}
                  onCancel={() => void cancelMine(l.uid)}
                />
              ))}
            </div>
          </div>
        )}

        {scope === 'all' && company && (
          <div className="px-4 pt-6.5">
            <h2 className="g-serif mx-1 mb-3.5 text-[28px]">кто сколько</h2>
            <div className="flex flex-col gap-2">
              {people.map(p => {
                const left = totals.personaRemaining(p.id)
                const paid = totals.personaPaid(p.id)
                const took = snap.lines
                  .filter(l => l.personaId === p.id && !l.cancelled)
                  .map(l => findDish(l.dishId)?.name ?? '?')
                const settled = paid > 0 && left <= 0.01
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-[20px] bg-g-s1 px-3.5 py-3">
                    <Avatar animal={p.animal} size={40} label={p.name} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-bold">
                        {p.name}
                        {p.id === me.id ? ' · вы' : ''}
                      </div>
                      <div className="truncate text-[13px] text-g-mute">
                        {took.length ? took.join(', ') : 'ещё выбирает'}
                      </div>
                    </div>
                    <span className={`g-num text-[15px] font-bold ${settled ? 'text-g-ok' : 'text-g-fg'}`}>
                      {settled ? 'оплачено' : fmt(left)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {draft.length === 0 && sent.length === 0 && (
          <div className="px-5 py-14 text-center">
            <div className="g-serif text-[28px]">пока пусто</div>
            <div className="mt-2 text-[15px] text-g-mute">Добавьте что-нибудь из меню</div>
          </div>
        )}
      </div>

      <div
        className="flex shrink-0 gap-2.5 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        style={{ background: 'linear-gradient(to top, var(--g-paper) 70%, transparent)' }}
      >
        <button
          aria-label="В меню"
          onClick={() => patch({ screen: 'menu' })}
          className="size-14 shrink-0 rounded-full bg-g-s1 text-2xl text-g-fg"
        >
          +
        </button>
        <button
          disabled={payable <= 0.01}
          // Своё оплачено, а по столу остаток: открываем оплату сразу за стол,
          // иначе гость упирается в неактивную кнопку «Оплатить · 0 ₽»
          onClick={() =>
            patch({ screen: 'payment', payStage: 'form', payScope: totals.myRemaining > 0.01 ? 'own' : 'full' })
          }
          className="g-cta g-num h-14 flex-1 rounded-full text-[17px] disabled:opacity-40"
        >
          {payLabel}
        </button>
      </div>
    </div>
  )
}

function SentTile({
  line,
  name,
  meta,
  caption,
  canCancel,
  onCancel
}: {
  line: ServerLine
  name: string
  meta: string
  caption: string
  canCancel: boolean
  onCancel: () => void
}) {
  const stage = lineStage(line)
  const cancelled = stage === 'cancelled'
  const served = stage === 'served'
  const live = !served && !cancelled
  const lit = stage === 'ready' ? 3 : stage === 'cooking' ? 2 : 1
  const strike = cancelled ? 'line-through' : undefined

  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-g-s1">
      <img
        src={dishPhoto(line.dishId)}
        alt=""
        loading="lazy"
        className="absolute inset-0 size-full object-cover"
        style={{ opacity: cancelled || served ? 0.55 : 1 }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(10,9,8,.9) 0%, rgba(10,9,8,.35) 45%, rgba(10,9,8,0) 70%)' }}
      />
      <span
        className="g-num absolute top-2.5 right-2.5 flex h-7 items-center rounded-full px-2.5 text-[13px] font-bold text-g-fg backdrop-blur-md"
        style={{ background: 'rgba(14,13,12,.78)', textDecoration: strike }}
      >
        {fmt(line.price * line.qty)}
      </span>
      <div className="absolute right-3 bottom-3 left-3">
        <div
          className="text-[15px] leading-tight font-bold"
          style={{ color: cancelled || served ? '#A8A298' : '#F3F0EA', textDecoration: strike }}
        >
          {name}
          {line.qty > 1 ? ` ×${line.qty}` : ''}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-g-soft">{meta}</div>
        {live && (
          <div className="mt-2 flex gap-0.75" aria-hidden>
            {[0, 1, 2].map(k => (
              <span
                key={k}
                className="h-0.75 flex-1 rounded-sm transition-colors duration-500"
                style={{ background: k < lit ? 'var(--g-acc)' : 'rgba(255,255,255,.1)' }}
              />
            ))}
          </div>
        )}
        <div
          className="mt-1.5 text-[12px] font-bold"
          style={{ color: cancelled ? '#FF9A7A' : served ? '#A8A298' : 'var(--g-ink)' }}
        >
          {caption}
        </div>
        {canCancel && (
          <button onClick={onCancel} className="mt-0.5 py-1 text-[12px] text-g-soft underline">
            отменить
          </button>
        )}
      </div>
    </div>
  )
}
