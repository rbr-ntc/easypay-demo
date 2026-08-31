import { useEffect, useRef, useState } from 'react'
import { allergenAccusative } from '@easypay/domain/allergens'
import { allergenTags, defaultOptions, dietTags, findDish, priceWithOptions } from '../data'
import type { Dish, LineOptions } from '../data'
import { BottomSheet, WarnBanner } from '../ui'
import { Avatar } from '../avatars'
import { DishPhoto } from '../screens/Menu'
import { useStore } from '../store'
import { newIdemKey } from '../keys'
import { fmt } from '../format'

const MAX_QTY = 9 // столько же принимает сервер

/**
 * Варианты, которые снимают заявленный аллерген. Меню это уже описывает
 * (`effects.removes`) — кухня видит «Без сметаны — снимает лактозу», а гость
 * до сих пор нет.
 */
function rescues(dish: Dish, blocked: string[] | null, mine: string[]) {
  if (!blocked || blocked.length === 0) return []
  const hits: { optionId: string; choice: string; removes: string[] }[] = []
  for (const opt of dish.options ?? []) {
    for (const choice of opt.choices ?? []) {
      const removes = (opt.effects?.[choice]?.removes ?? []).filter(a => blocked.includes(a))
      const adds = opt.effects?.[choice]?.adds ?? []
      // Спасение — то, что снимает заявленный аллерген и не приносит другой
      // из СПИСКА ЭТОГО ГОСТЯ. Овсяное молоко добавляет глютен: человеку с
      // непереносимостью лактозы оно подходит, человеку с целиакией — нет.
      const dangerous = adds.some(a => mine.includes(a))
      if (removes.length > 0 && !dangerous) hits.push({ optionId: opt.id, choice, removes })
    }
  }
  return hits
}

/**
 * Что именно гость получит с учётом выбора. Модификатор объёма меняет порцию,
 * и подпись «150 мл» рядом с выбранной бутылкой — прямой обман.
 */
function servingLabel(dish: { serving?: string; options?: { id: string; name: string }[] }, opts: LineOptions): string | null {
  const volume = dish.options?.find(o => /объ[её]м|порци|размер/i.test(o.name))
  const chosen = volume ? opts[volume.id] : null
  return chosen || dish.serving || null
}

export function DishSheet() {
  const { ui, patch, me, snap, totals, addLine, toast } = useStore()
  // За столом есть кто-то ещё — только тогда есть смысл в общем блюде
  const companyAtTable = (snap?.personas.length ?? 0) > 1
  const dish = ui.currentDishId ? findDish(ui.currentDishId) : undefined
  const [qty, setQty] = useState(1)
  const [target, setTarget] = useState<'me' | 'table'>('me')
  const [opts, setOpts] = useState<LineOptions>(() => (dish ? defaultOptions(dish) : {}))
  // Сервер остановил заказ: в блюде есть то, на что гость указал аллергию
  const [blocked, setBlocked] = useState<string[] | null>(ui.pendingAllergens)
  // Одно открытие карточки — одно намерение заказать. Повторные нажатия
  // «Добавить» приходят на сервер с тем же ключом и не создают вторую порцию:
  // количество выбирается плюсиком, а не частотой тапов.
  const addKey = useRef(newIdemKey())
  const [busy, setBusy] = useState(false)
  // Защёлка синхронная: setState применяется к следующему рендеру, и семь
  // тапов внутри одного тика проскакивали мимо флага busy все семь раз
  const sending = useRef(false)

  // Карточка переиспользуется под разные блюда, и состояние обязано ехать за
  // блюдом. Раньше модификаторы и ключ намерения создавались один раз на
  // монтирование: капучино уходил с «volume» от вина и получал 400, а второе
  // блюдо наследовало чужой ключ идемпотентности.
  const [shownDish, setShownDish] = useState<string | null>(dish?.id ?? null)
  if (dish && shownDish !== dish.id) {
    // Сбрасываем СИНХРОННО, а не эффектом: эффект отставал на один рендер, и
    // первый кадр нового блюда считал цену, порцию и «спасательные» варианты
    // по опциям предыдущего. Пока шторка размонтируется между блюдами, это
    // было только миганием цены, но держаться на этом нельзя.
    setShownDish(dish.id)
    addKey.current = newIdemKey()
    setOpts(defaultOptions(dish))
    setQty(1)
    setTarget('me')
    setBlocked(ui.pendingAllergens)
  }
  // Предупреждение, доставшееся от шторки с именем, показано — гасим его в UI
  useEffect(() => {
    if (ui.pendingAllergens) patch({ pendingAllergens: null })
  }, [ui.pendingAllergens])

  if (!dish) return null

  const close = () => patch({ sheet: null, currentDishId: null, pendingAdd: null })

  const add = async () => {
    if (sending.current) return
    const shared = companyAtTable && target === 'table'
    if (!me) {
      // Имя спрашиваем ровно в момент первой надобности; блюдо НЕ теряется
      patch({ sheet: 'name', pendingAdd: { dishId: dish.id, qty, shared, options: opts } })
      return
    }
    sending.current = true
    setBusy(true)
    const res = await addLine(dish.id, qty, shared, opts, undefined, false, addKey.current)
    sending.current = false
    setBusy(false)
    if (res.allergens && res.allergens.length > 0) {
      // Не добавляем молча и не прячем за тостом: это здоровье, а не удобство
      setBlocked(res.allergens)
      return
    }
    // Сервер отказал — карточка остаётся открытой, а тоста об успехе нет:
    // «Капучино → Глеб» при пустом заказе врал гостю в лицо
    if (!res.ok) return
    patch({ sheet: null, currentDishId: null })
    toast(shared ? `${dish.name} → общее на стол` : `${dish.name} → ${me.name}`)
  }

  /** Гость увидел предупреждение и всё равно заказывает — это его осознанный выбор. */
  const addAnyway = async () => {
    const shared = companyAtTable && target === 'table'
    setBlocked(null)
    const res = await addLine(dish.id, qty, shared, opts, undefined, true, addKey.current)
    if (!res.ok) return
    patch({ sheet: null, currentDishId: null })
    toast(`${dish.name} → ${me?.name ?? 'вам'}`)
  }

  const bad = allergenTags(dish, opts).filter(a => (me?.allergies ?? []).includes(a))

  return (
    <BottomSheet onClose={close}>
      <div className="ep-scroll">
        {/* Фото во всю ширину, название и чипы поверх него — карточка блюда
            начинается с еды, а не с заголовка */}
        <div className="relative h-90">
          <DishPhoto dish={dish} />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to top, rgba(6,33,25,.7) 0%, rgba(6,33,25,0) 50%)' }}
          />
          <button
            aria-label="Назад"
            onClick={close}
            className="ep-glass absolute top-4 left-4 size-11 rounded-full text-lg font-extrabold"
            style={{ color: '#FAF5EA' }}
          >
            ←
          </button>
          <div className="absolute right-5 bottom-4.5 left-5">
            <div className="text-[30px] leading-[1.1] font-extrabold tracking-tight text-white">{dish.name}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[servingLabel(dish, opts), dish.kcal ? `${dish.kcal} ккал` : null]
                .filter(Boolean)
                .map(chip => (
                  <span
                    key={chip as string}
                    className="ep-glass inline-flex h-8 items-center rounded-full px-3 text-[13px] font-bold text-white"
                  >
                    {chip}
                  </span>
                ))}
              {dietTags(dish).map(t => (
                <span
                  key={t}
                  className="ep-glass inline-flex h-8 items-center rounded-full px-3 text-[13px] font-bold text-white"
                >
                  {t === 'острое' ? '🌶 острое' : t}
                </span>
              ))}
              {(me?.allergies ?? []).length > 0 && (
                <span
                  className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-bold"
                  style={
                    bad.length > 0
                      ? { background: '#9E3517', color: '#FFF1EC' }
                      : { background: 'rgba(213,249,78,.9)', color: '#062119' }
                  }
                >
                  {bad.length > 0 ? `здесь есть ${bad.join(' и ')}` : 'без ваших аллергенов'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 pt-5">
          <p className="text-[15px] leading-relaxed font-medium text-muted">{dish.desc}</p>
        </div>

        {allergenTags(dish, opts).length > 0 && (
          <div className="px-5 pt-3">
            <div className="text-[13px] font-bold text-warning">
              Аллергены: {allergenTags(dish, opts).join(' · ')}
              {(dish.options ?? []).some(o => o.effects) ? ' · зависит от выбора ниже' : ''}
            </div>
          </div>
        )}

        {/* Кому блюдо — витрина УТП: привязка к персоне в момент заказа.
            В одиночку выбора нет: делить не с кем, и «÷1» только путает. */}
        {companyAtTable && (
          <div className="px-5 pt-5">
            <div className="ep-brow mb-2.5">За кем записать</div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setTarget('me')}
                className="flex h-16 flex-1 items-center gap-2.5 rounded-[18px] px-3.5"
                style={target === 'me' ? { background: '#062119' } : { border: '1.5px solid #DFD6C3' }}
              >
                {me && <Avatar animal={me.animal} size={36} label={me.name} />}
                <span className="text-left">
                  <span
                    className="block text-[15px] font-extrabold"
                    style={{ color: target === 'me' ? '#FAF5EA' : '#062119' }}
                  >
                    Мне
                  </span>
                  <span
                    className="block text-[12px] font-semibold"
                    style={{ color: target === 'me' ? '#8CA396' : '#4A5B51' }}
                  >
                    {me?.name}
                  </span>
                </span>
              </button>
              <button
                onClick={() => setTarget('table')}
                className="flex h-16 flex-1 items-center gap-2 rounded-[18px] px-3.5"
                style={target === 'table' ? { background: '#062119' } : { border: '1.5px solid #DFD6C3' }}
              >
                <span className="flex">
                  {(snap?.personas ?? []).slice(0, 2).map((p, i) => (
                    <span
                      key={p.id}
                      className="flex size-7.5 items-center justify-center rounded-full"
                      style={{
                        border: `2px solid ${target === 'table' ? '#062119' : '#FAF5EA'}`,
                        marginLeft: i === 0 ? 0 : -10
                      }}
                    >
                      <Avatar animal={p.animal} size={26} label={p.name} />
                    </span>
                  ))}
                </span>
                <span className="text-left">
                  <span
                    className="block text-[15px] font-extrabold"
                    style={{ color: target === 'table' ? '#FAF5EA' : '#062119' }}
                  >
                    На всех
                  </span>
                  <span
                    className="block text-[12px] font-semibold"
                    style={{ color: target === 'table' ? '#8CA396' : '#4A5B51' }}
                  >
                    поровну ÷{totals.participants}
                  </span>
                </span>
              </button>
            </div>
          </div>
        )}

        {blocked && (
          <div className="px-5 pt-5">
            <div className="rounded-box p-4" style={{ background: '#F6E3DA' }}>
              <div className="text-[16px] font-extrabold" style={{ color: '#7A2A12' }}>
                Здесь есть {blocked.join(' и ')}
              </div>
              <div className="mt-1.5 text-[13px] leading-snug font-semibold" style={{ color: '#7A2A12' }}>
                Вы указали это в аллергиях. Кухня увидит выбор как запрет, а не как пожелание.
              </div>

              {/* Приложение знает, какой модификатор снимает аллерген, — кухне оно
                  это уже говорит. Гостю не сказать об этом было прямой потерей. */}
              {rescues(dish, blocked, me?.allergies ?? []).map(r => (
                <button
                  key={`${r.optionId}-${r.choice}`}
                  onClick={() => {
                    setOpts(prev => ({ ...prev, [r.optionId]: r.choice }))
                    setBlocked(null)
                  }}
                  className="mt-3 flex min-h-12 w-full items-center rounded-field px-3.5 py-2.5 text-left text-[13.5px] font-semibold"
                  style={{ border: '2px solid #15603F', background: '#FFFFFF', color: '#0E3F2B' }}
                >
                  Взять «{r.choice}» — снимет {r.removes.map(allergenAccusative).join(' и ')} · цена не меняется
                </button>
              ))}

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setBlocked(null)}
                  className="h-12 flex-1 rounded-field text-[15px] font-bold"
                  style={{ background: '#9E3517', color: '#FFF1EC' }}
                >
                  Не буду
                </button>
                <button
                  onClick={() => void addAnyway()}
                  className="h-12 flex-1 rounded-field text-[15px] font-bold"
                  style={{ border: '1.5px solid #DFD6C3' }}
                >
                  Всё равно заказать
                </button>
              </div>
            </div>
          </div>
        )}

        {target === 'table' && (snap?.lines ?? []).some(l => l.shared && l.dishId === dish.id) && (
          <div className="px-5 pt-4">
            <WarnBanner>
              <span className="text-sm leading-snug">
                {dish.name} уже есть в общих блюдах стола — вы добавите <b>ещё одну порцию</b>.
              </span>
            </WarnBanner>
          </div>
        )}

        {/* Модификаторы блюда — реальные: уходят на кухню вместе с позицией */}
        {(dish.options ?? []).map(opt => (
          <div key={opt.id} className="px-5 pt-5">
            <div className="ep-brow mb-2.5">{opt.name}</div>
            <div className="flex flex-wrap gap-2">
              {opt.choices.map(choice => {
                const on = opts[opt.id] === choice
                return (
                  <button
                    key={choice}
                    onClick={() => setOpts(prev => ({ ...prev, [opt.id]: choice }))}
                    className="h-11.5 rounded-[14px] px-4 text-[14px] font-bold"
                    style={
                      on
                        ? { background: '#D5F94E', color: '#062119' }
                        : { border: '1.5px solid #DFD6C3', color: '#26382F' }
                    }
                  >
                    {choice}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="h-5" />
      </div>

      <div
        className="flex shrink-0 items-center gap-3.5 px-5 pt-3 pb-[calc(1.375rem+env(safe-area-inset-bottom))]"
        style={{ borderTop: '1px solid #E3DCCB' }}
      >
        <div className="flex items-center gap-1" style={{ border: '1.5px solid #DFD6C3', borderRadius: 16, padding: 4 }}>
          <button
            aria-label="Меньше"
            disabled={qty <= 1}
            onClick={() => setQty(Math.max(1, qty - 1))}
            className="size-10 rounded-xl text-xl font-bold disabled:opacity-35"
          >
            −
          </button>
          <span className="ep-sum w-6 text-center text-[16px] font-extrabold">{qty}</span>
          <button
            aria-label="Больше"
            disabled={qty >= MAX_QTY}
            onClick={() => setQty(Math.min(MAX_QTY, qty + 1))}
            className="size-10 rounded-xl text-xl font-bold disabled:opacity-35"
          >
            +
          </button>
        </div>
        <button
          onClick={() => void add()}
          disabled={busy}
          className="ep-sum h-15 flex-1 rounded-field text-[16px] font-extrabold disabled:opacity-45"
          style={{ background: '#D5F94E', color: '#062119', boxShadow: '0 12px 26px -14px rgba(6,33,25,.9)' }}
        >
          Добавить · {fmt(priceWithOptions(dish, opts) * qty)}
        </button>
      </div>
    </BottomSheet>
  )
}
