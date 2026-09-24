import { useEffect, useMemo, useRef, useState } from 'react'
import { RESTAURANT, defaultOptions } from '../data'
import type { Dish } from '../data'
import { tableId } from '../api'
import type { ServerLine } from '../api'
import { Avatar } from '../avatars'
import { useStore } from '../store'
import { fmt, plural } from '../format'
import { newIdemKey } from '../keys'
import { sharersOf } from '@easypay/domain/money'
import { KITCHEN_UNTIL, collections, currentSeason, dishTall, dishThumb } from '../guest/showcase'
import type { Collection, ShowcaseSection } from '../guest/showcase'
import { allergyHits, allergyNote } from '../guest/allergy'
import { AddButton, AvatarStack } from '../guest/parts'

/**
 * Меню 4.x — «Времена года».
 *
 * Шапка на 2/3 экрана — заглавное блюдо подборки, кадры сменяются и медленно
 * наезжают. Прокрутка уводит в меню: фото растворяется в фоне, подборки
 * прилипают сверху. Крупные карточки листаются вбок, быстрые — плитками.
 *
 * Меню 3.0 было одной лентой в 10 000 px из карточек по 280 px; здесь
 * вертикаль — разделы, а блюда внутри раздела идут вбок.
 */

const HERO_H = 720
/** Высота прилипшей панели: подборки + якоря разделов. */
const STICK = 92
const SLIDE_MS = 5000

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function Menu() {
  const { patch, me, snap, totals, addLine, toast } = useStore()
  const season = useMemo(() => currentSeason(), [])
  const colls = useMemo(() => collections(season), [season])
  const [collId, setCollId] = useState(colls[0]?.id ?? 'all')
  const coll = colls.find(c => c.id === collId) ?? colls[0]

  const scrollRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [active, setActive] = useState(0)

  /**
   * Позиция раздела внутри прокрутки. Не `offsetTop`: он считается от
   * ближайшего позиционированного предка, а блок разделов нарочно `relative`
   * (иначе шапка перекрывает первый заголовок) — и якоря съезжали на раздел.
   */
  const sectionTops = (el: HTMLElement) => {
    const base = el.getBoundingClientRect().top - el.scrollTop
    return Array.from(el.querySelectorAll<HTMLElement>('[data-sec]')).map(s => s.getBoundingClientRect().top - base)
  }

  // Нажатый якорь держим подсвеченным, пока идёт прокрутка к нему: последние
  // разделы короткие и не доезжают до верха — иначе подсвечивался соседний
  const pinned = useRef<{ i: number; until: number } | null>(null)

  const scrollRaf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), [])
  // Скролл шлёт десятки событий в секунду, а спай разделов читает геометрию —
  // считаем не чаще одного раза за кадр
  const onScroll = () => {
    cancelAnimationFrame(scrollRaf.current)
    scrollRaf.current = requestAnimationFrame(spy)
  }

  const spy = () => {
    const el = scrollRef.current
    if (!el) return
    setCollapsed(el.scrollTop > HERO_H - 170)
    if (pinned.current && Date.now() < pinned.current.until) return
    pinned.current = null
    let idx = 0
    sectionTops(el).forEach((top, i) => {
      if (top - STICK - 30 <= el.scrollTop) idx = i
    })
    setActive(idx)
  }

  const goSection = (i: number) => {
    const el = scrollRef.current
    const top = el ? sectionTops(el)[i] : undefined
    if (!el || top === undefined) return
    setActive(i)
    pinned.current = { i, until: Date.now() + 900 }
    el.scrollTo({ top: top - STICK, behavior: 'smooth' })
  }

  const pickCollection = (id: string) => {
    setCollId(id)
    setActive(0)
    // Подборка сменилась — возвращаемся к её началу, но не к шапке:
    // человек уже листал меню и хочет видеть блюда, а не заглавное фото
    const el = scrollRef.current
    if (el && el.scrollTop > HERO_H - 340) el.scrollTo({ top: HERO_H - 340 })
  }

  // ── Сколько каждого блюда уже в МОЁМ черновике — «✓ 2» на кнопке ──
  const myDraftQty = useMemo(() => {
    const m = new Map<string, number>()
    if (!me || !snap) return m
    for (const l of snap.lines) {
      if (l.personaId === me.id && !l.sent && !l.cancelled) m.set(l.dishId, (m.get(l.dishId) ?? 0) + l.qty)
    }
    return m
  }, [me, snap])

  const quickAdd = async (dish: Dish, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const options = defaultOptions(dish)
    // Выбор или риск — только через карточку: быстрый плюс не должен молча
    // решать за гостя прожарку или аллерген
    if (dish.stop || (dish.options ?? []).length > 0 || (me && allergyHits(dish, me.allergies ?? []).length > 0)) {
      patch({ sheet: 'dish', currentDishId: dish.id })
      return
    }
    if (!me) {
      patch({ sheet: 'name', pendingAdd: { dishId: dish.id, qty: 1, shared: false, options, idemKey: newIdemKey() } })
      return
    }
    // Каждый тап плюса — осознанная порция: на кнопке сразу видно «✓ 2».
    // Защита от случайных дублей нужна в карточке блюда, где жмут «В стол».
    const res = await addLine(dish.id, 1, false, options, undefined, false, newIdemKey())
    if (res.allergens && res.allergens.length > 0) {
      patch({ sheet: 'dish', currentDishId: dish.id, pendingAllergens: res.allergens })
      return
    }
    if (res.ok) toast(`${dish.name} — добавлено`)
  }
  const openDish = (dish: Dish) => patch({ sheet: 'dish', currentDishId: dish.id })

  // ── Кто за столом: я первым, дальше остальные ──
  const people =
    snap?.status === 'open'
      ? [...snap.personas].sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : 0))
      : []
  const iCalled = !!me && (snap?.calls ?? []).some(c => c.personaId === me.id)
  const onCall = () => {
    if (iCalled) return
    // Звать официанта может только тот, кто представился: иначе он не знает,
    // к кому идти. После имени шторка вызова откроется сама — не обещаем впустую
    if (!me) {
      patch({ sheet: 'name', afterJoin: 'call' })
      return
    }
    patch({ sheet: 'call' })
  }

  // ── Футер «мой стол» ──
  const personaIds = (snap?.personas ?? []).map(p => p.id)
  const isMine = (l: ServerLine) =>
    !!me &&
    !l.cancelled &&
    (l.personaId === me.id || (l.sent && l.shared && sharersOf(l as any, personaIds).includes(me.id)))
  const myLines = (snap?.lines ?? []).filter(isMine)
  const count = myLines.reduce((a, l) => a + (l.personaId === me?.id ? l.qty : 1), 0)
  const draftCount = myLines.filter(l => !l.sent).reduce((a, l) => a + l.qty, 0)

  const mineAllergies = me?.allergies ?? []

  return (
    <div className="absolute inset-0">
      <div ref={scrollRef} onScroll={onScroll} className="g-noscroll absolute inset-0 overflow-y-auto">
        <Hero coll={coll} onOpen={openDish} />

        {/* Над шапкой: кто за столом, стол, официант */}
        <div className="absolute top-4.5 right-4 left-4 z-[3] flex items-center gap-2.5">
          {people.length > 0 && <AvatarStack personas={people} size={32} />}
          <div className="min-w-0 flex-1 pl-2.5 text-white" style={{ textShadow: '0 1px 8px rgba(0,0,0,.55)' }}>
            <div className="truncate text-[15px] font-bold">
              {RESTAURANT} · стол {tableId}
            </div>
            {KITCHEN_UNTIL && <div className="text-[13px] text-white">кухня до {KITCHEN_UNTIL}</div>}
          </div>
          <button onClick={onCall} className="g-glass h-11 shrink-0 rounded-full px-4 text-[13px] font-bold">
            {iCalled ? 'Идёт ✓' : 'Официант'}
          </button>
        </div>

        {/* Подборки и якоря — прилипают, фон проявляется, когда шапка ушла */}
        <nav className="sticky top-0 z-[4] -mt-40 pt-3">
          <div
            className="pointer-events-none absolute inset-0 bg-g-paper transition-opacity duration-200"
            style={{ opacity: collapsed ? 1 : 0, boxShadow: '0 1px 0 rgba(255,255,255,.1)' }}
          />
          <div className="g-noscroll relative flex gap-5.5 overflow-x-auto px-5">
            {colls.map(c => (
              <button
                key={c.id}
                onClick={() => pickCollection(c.id)}
                aria-pressed={c.id === coll.id}
                className={`h-11 shrink-0 text-[22px] ${c.id === coll.id ? 'text-g-fg' : 'text-g-fg/50'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="g-noscroll relative flex gap-4.5 overflow-x-auto px-5 pb-2">
            {coll.sections.map((s, i) => (
              <button
                key={s.title}
                onClick={() => goSection(i)}
                className={`h-8 shrink-0 text-[13px] ${i === active ? 'font-bold text-g-fg' : 'text-g-mute'}`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </nav>

        {/* relative — обязательно: шапка собрана из позиционированных слоёв и
            иначе рисуется ПОВЕРХ заголовка первого раздела, который заходит на
            её низ. В макете от заголовка «осень пришла» торчала одна чёрточка. */}
        <div className="relative pt-1 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
          {coll.sections.map(s => (
            <Section
              key={`${coll.id}-${s.title}`}
              section={s}
              qtyOf={id => myDraftQty.get(id) ?? 0}
              noteOf={d => allergyNote(d, mineAllergies)}
              onOpen={openDish}
              onAdd={quickAdd}
            />
          ))}
        </div>
      </div>

      {me && count > 0 && (
        <div className="g-anim-up absolute right-3 bottom-[calc(0.875rem+env(safe-area-inset-bottom))] left-3 z-[6]">
          <button
            onClick={() => patch({ screen: 'table' })}
            className="g-dock flex h-16 w-full items-center gap-3 rounded-full pr-2 pl-2.5 text-g-fg"
          >
            <Avatar animal={me.animal} size={44} label={me.name} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-bold">
                мой стол · {count} {plural(count, 'блюдо', 'блюда', 'блюд')}
              </span>
              <span className="block text-[13px] text-g-mute">
                {draftCount > 0 ? `${draftCount} ещё не на кухне` : 'всё на кухне'}
              </span>
            </span>
            <span className="g-cta g-num flex h-12 items-center rounded-full px-4.5 text-[15px]">
              {/* «0 ₽» после оплаты читается как «ничего не заказано» */}
              {totals.myRemaining + totals.myDraft <= 0.01 && totals.myPaid > 0
                ? 'оплачено'
                : fmt(totals.myRemaining + totals.myDraft)}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

/** Заглавное блюдо подборки: кадры сменяются, внизу — полоски прогресса. */
function Hero({ coll, onOpen }: { coll: Collection; onOpen: (d: Dish) => void }) {
  const slides = coll.hero
  const [i, setI] = useState(0)
  const [fill, setFill] = useState(false)

  // Подборка сменилась — начинаем с её первого блюда
  useEffect(() => setI(0), [coll.id])

  useEffect(() => {
    // «Меньше движения» — кадры не листаются сами: CSS гасит переходы, а смену
    // кадров делает JS, и без этой проверки карусель крутилась бы всё равно
    if (slides.length < 2 || prefersReducedMotion()) return
    setFill(false)
    // Полоска заполняется CSS-переходом: сброс в 0 и старт через кадр
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setFill(true))
    })
    const t = setTimeout(() => setI(x => (x + 1) % slides.length), SLIDE_MS)
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      clearTimeout(t)
    }
  }, [i, slides.length, coll.id])

  const d = slides[i % Math.max(1, slides.length)]
  if (!d) return <div style={{ height: HERO_H }} />

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${d.name} — открыть`}
      onClick={() => onOpen(d)}
      onKeyDown={e => e.key === 'Enter' && onOpen(d)}
      className="relative cursor-pointer overflow-hidden"
      style={{ height: HERO_H, background: '#0E0D0C' }}
    >
      {slides.map((s, k) => (
        <img
          key={s.id}
          src={dishTall(s.id)}
          alt=""
          loading={k === 0 ? 'eager' : 'lazy'}
          className="absolute inset-0 size-full object-cover"
          style={{
            opacity: k === i ? 1 : 0,
            transform: k === i ? 'scale(1.08)' : 'scale(1)',
            transition: 'opacity 1s ease, transform 6s linear'
          }}
        />
      ))}
      <div className="g-photo-fade absolute inset-0" />

      <div className="absolute right-6 bottom-47.5 left-6 z-[2] text-center text-white">
        <div className="g-serif text-[44px] text-balance" style={{ textShadow: '0 2px 24px rgba(0,0,0,.35)' }}>
          {d.name}
        </div>
        <div className="g-num mt-2.5 text-[13px] text-white/90">
          {[d.kcal ? `${d.kcal} ккал` : null, d.serving, fmt(d.price)].filter(Boolean).join(' · ')}
        </div>
        {slides.length > 1 && (
          <div className="mx-auto mt-3.5 flex justify-center gap-1">
            {slides.map((s, k) => (
              <span key={s.id} className="h-0.5 w-6 overflow-hidden rounded-[1px] bg-white/30">
                <span
                  className="block h-full bg-white"
                  style={{
                    width: k < i ? '100%' : k === i && fill ? '100%' : '0%',
                    transition: k === i && fill ? `width ${SLIDE_MS}ms linear` : 'none'
                  }}
                />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({
  section,
  qtyOf,
  noteOf,
  onOpen,
  onAdd
}: {
  section: ShowcaseSection
  qtyOf: (id: string) => number
  noteOf: (d: Dish) => string
  onOpen: (d: Dish) => void
  onAdd: (d: Dish, e?: React.MouseEvent) => void
}) {
  const live = section.dishes.filter(d => !d.stop)
  const stopped = section.dishes.filter(d => d.stop)

  return (
    <section data-sec className="pt-6.5">
      <h2 className="g-serif px-5 pb-3.5 text-[34px] text-g-fg">{section.title}</h2>

      {section.kind === 'small' ? (
        <div className="g-noscroll flex gap-2.5 overflow-x-auto px-5">
          {section.dishes.map(d => (
            <SmallTile key={d.id} dish={d} qty={qtyOf(d.id)} note={noteOf(d)} onOpen={onOpen} onAdd={onAdd} />
          ))}
        </div>
      ) : (
        live.length > 0 && (
          <div className="g-noscroll flex snap-x snap-mandatory gap-3 overflow-x-auto px-5">
            {live.map(d => (
              <TallCard key={d.id} dish={d} qty={qtyOf(d.id)} note={noteOf(d)} onOpen={onOpen} onAdd={onAdd} />
            ))}
          </div>
        )
      )}

      {/* Стоп-лист не прячем: гость искал это блюдо и должен узнать, что его нет сегодня */}
      {section.kind !== 'small' && stopped.length > 0 && (
        <div className="mx-5 mt-3 flex flex-col gap-2">
          {stopped.map(d => (
            <StopRow key={d.id} dish={d} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

interface CardProps {
  dish: Dish
  qty: number
  note: string
  onOpen: (d: Dish) => void
  onAdd: (d: Dish, e?: React.MouseEvent) => void
}

function TallCard({ dish, qty, note, onOpen, onAdd }: CardProps) {
  return (
    <div className="relative h-93 w-73 shrink-0 snap-start overflow-hidden rounded-[28px] bg-g-s1">
      <img src={dishTall(dish.id)} alt="" loading="lazy" className="size-full object-cover object-top" />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(10,9,8,.82) 0%, rgba(10,9,8,.3) 34%, rgba(10,9,8,0) 55%)' }}
      />
      <OpenOverlay dish={dish} onOpen={onOpen} />
      <div className="pointer-events-none absolute right-19 bottom-5 left-5 text-white">
        <div className="text-[17px] leading-tight font-bold">{dish.name}</div>
        {note && (
          <div
            className="mt-1.5 inline-block rounded-lg px-2 py-0.5 text-[13px] font-bold text-g-warn"
            style={{ background: 'rgba(20,18,16,.85)' }}
          >
            {note}
          </div>
        )}
        <div className="g-num mt-2 text-[15px]">{fmt(dish.price)}</div>
      </div>
      <div className="absolute right-4 bottom-4 z-[1]">
        <AddButton qty={qty} size={48} label={dish.name} onPhoto onClick={e => onAdd(dish, e)} />
      </div>
    </div>
  )
}

function SmallTile({ dish, qty, note, onOpen, onAdd }: CardProps) {
  return (
    <div className="relative flex w-68 shrink-0 items-center gap-3 rounded-[22px] bg-g-s1 p-3">
      <OpenOverlay dish={dish} onOpen={onOpen} />
      <div className="pointer-events-none size-19 shrink-0 overflow-hidden rounded-2xl bg-g-sand">
        <img src={dishThumb(dish.id)} alt="" loading="lazy" className="size-full object-cover" />
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="line-clamp-2 text-[15px] leading-snug text-g-fg">{dish.name}</div>
        {note && <div className="truncate text-[12px] font-bold text-g-warn">{note}</div>}
        {dish.stop ? (
          <div className="mt-1.5 text-[13px] text-g-mute">закончилось</div>
        ) : (
          <div className="g-num mt-1.5 text-[15px] text-g-fg">{fmt(dish.price)}</div>
        )}
      </div>
      {!dish.stop && (
        <span className="relative">
          <AddButton qty={qty} size={40} label={dish.name} onClick={e => onAdd(dish, e)} />
        </span>
      )}
    </div>
  )
}

/**
 * Открыть карточку — отдельная кнопка на всю плитку под текстом. Раньше это
 * был div с onClick: с клавиатуры блюдо не открывалось, стоп-лист был
 * недостижим. Вложить «+» в элемент с ролью кнопки нельзя — поэтому так.
 */
function OpenOverlay({ dish, onOpen }: { dish: Dish; onOpen: (d: Dish) => void }) {
  return (
    <button
      aria-label={`${dish.name}${dish.stop ? ', закончилось' : ''} — подробнее`}
      onClick={() => onOpen(dish)}
      className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-g-acc"
    />
  )
}

function StopRow({ dish, onOpen }: { dish: Dish; onOpen: (d: Dish) => void }) {
  return (
    <div className="relative flex items-center gap-3 rounded-[20px] bg-g-s1 p-3">
      <OpenOverlay dish={dish} onOpen={onOpen} />
      <div className="pointer-events-none size-16 shrink-0 overflow-hidden rounded-[14px] bg-g-sand opacity-50">
        <img src={dishThumb(dish.id)} alt="" loading="lazy" className="size-full object-cover grayscale" />
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="text-[15px] text-g-fg">{dish.name}</div>
        <div className="mt-0.5 truncate text-[13px] text-g-mute">{dish.desc}</div>
        <div className="mt-1 text-[13px] text-g-mute">закончилось на сегодня</div>
      </div>
    </div>
  )
}
