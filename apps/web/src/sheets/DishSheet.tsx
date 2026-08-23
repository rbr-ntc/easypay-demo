import { useEffect, useRef, useState } from 'react'
import { allergenAccusative } from '@easypay/domain/allergens'
import { allergenTags, defaultOptions, dietTags, dishEmoji, findDish, priceWithOptions } from '../data'
import type { Dish, LineOptions } from '../data'
import { BottomSheet, PrimaryButton, WarnBanner } from '../ui'
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

  return (
    <BottomSheet onClose={close}>
      <div className="ep-scroll px-5 pt-1 pb-4">
        {dish.photo ? (
          <img
            src={`./dishes/${dish.id}.jpg`}
            alt={dish.name}
            className="mb-4 h-48 w-full rounded-box bg-base-200 object-cover"
          />
        ) : (
          <div className="mb-4 flex h-38 w-full items-center justify-center rounded-box bg-base-200 text-5xl">
            {dishEmoji(dish)}
          </div>
        )}
        <div className="text-2xl font-bold tracking-tight">{dish.name}</div>
        <p className="mt-1.5 mb-2.5 leading-relaxed text-base-content/60">{dish.desc}</p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(dish.serving || dish.kcal) && (
            <span className="badge badge-ghost">
              {/* Порция обязана считаться от ВЫБРАННОГО модификатора: при
                  выбранной бутылке шапка продолжала обещать «150 мл» */}
              {[servingLabel(dish, opts), dish.kcal ? `${dish.kcal} ккал` : null].filter(Boolean).join(' · ')}
            </span>
          )}
          {dietTags(dish).map(t => (
            <span key={t} className={t === 'острое' ? 'badge badge-error badge-soft' : 'badge badge-success badge-soft'}>
              {t === 'острое' ? '🌶 острое' : t}
            </span>
          ))}
        </div>

        {allergenTags(dish, opts).length > 0 ? (
          <div className="mb-4 text-sm text-warning">
            Аллергены: {allergenTags(dish, opts).join(' · ')}
            {(dish.options ?? []).some(o => o.effects) ? ' · зависит от выбора ниже' : ''}
          </div>
        ) : (
          <div className="mb-4 text-sm text-success">Аллергенов из списка нет</div>
        )}

        {/* Кому блюдо — витрина УТП: привязка к персоне в момент заказа.
            В одиночку выбора нет: делить не с кем, и «÷1» только путает. */}
        {companyAtTable && (
          <>
            <div className="mb-2 font-semibold">Кому</div>
            <div className="join mb-4 w-full">
              <button
                className={`btn join-item flex-1 ${target === 'me' ? 'btn-active btn-primary' : ''}`}
                onClick={() => setTarget('me')}
              >
                {me ? me.name : 'Себе'}
              </button>
              <button
                className={`btn join-item flex-1 ${target === 'table' ? 'btn-active btn-primary' : ''}`}
                onClick={() => setTarget('table')}
              >
                Общее на стол ÷{totals.participants}
              </button>
            </div>
          </>
        )}

        {blocked && (
          <div role="alert" className="alert alert-error mb-4 flex-col items-stretch">
            <div>
              <div className="font-bold">Здесь есть {blocked.join(' и ')}</div>
              <div className="text-sm leading-snug">
                Вы указали это в аллергиях. Проверьте состав или спросите официанта — если уверены, можно заказать.
              </div>
            </div>
            {/* Приложение знает, какой модификатор снимает аллерген, — кухне оно
                это уже говорит. Гостю не сказать об этом было прямой потерей:
                переключатель «овсяное молоко» стоял на экране прямо под
                предупреждением, и гость про него не догадывался. */}
            {rescues(dish, blocked, me?.allergies ?? []).map(r => (
              <button
                key={`${r.optionId}-${r.choice}`}
                className="btn btn-outline btn-block justify-start"
                onClick={() => {
                  setOpts(prev => ({ ...prev, [r.optionId]: r.choice }))
                  setBlocked(null)
                }}
              >
                Взять «{r.choice}» — снимет {r.removes.map(allergenAccusative).join(' и ')}
              </button>
            ))}
            <div className="flex gap-2">
              <button className="btn btn-error flex-1" onClick={() => setBlocked(null)}>
                Не буду
              </button>
              <button className="btn flex-1" onClick={() => void addAnyway()}>
                Всё равно заказать
              </button>
            </div>
          </div>
        )}

        {target === 'table' && (snap?.lines ?? []).some(l => l.shared && l.dishId === dish.id) && (
          <div className="mb-4">
            <WarnBanner>
              <span className="text-sm leading-snug">
                {dish.name} уже есть в общих блюдах стола — вы добавите <b>ещё одну порцию</b>. Если хотели ту же —
                она уже заказана 😉
              </span>
            </WarnBanner>
          </div>
        )}

        {/* Модификаторы блюда — реальные: уходят на кухню вместе с позицией */}
        {(dish.options ?? []).map(opt => (
          <div key={opt.id}>
            <div className="mb-2.5 font-semibold">{opt.name}</div>
            <div className="mb-4 flex flex-wrap gap-2">
              {opt.choices.map(choice => (
                <button
                  key={choice}
                  className={`btn ${opts[opt.id] === choice ? 'btn-active btn-primary' : ''}`}
                  onClick={() => setOpts(prev => ({ ...prev, [opt.id]: choice }))}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3.5 border-t border-base-300 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="join">
          <button
            className="btn join-item size-11"
            aria-label="Меньше"
            disabled={qty <= 1}
            onClick={() => setQty(Math.max(1, qty - 1))}
          >
            −
          </button>
          <span className="btn join-item pointer-events-none size-11 font-semibold">{qty}</span>
          <button
            className="btn join-item size-11"
            aria-label="Больше"
            disabled={qty >= MAX_QTY}
            onClick={() => setQty(Math.min(MAX_QTY, qty + 1))}
          >
            +
          </button>
        </div>
        <PrimaryButton className="flex-1" onClick={() => void add()}>
          Добавить · {fmt(priceWithOptions(dish, opts) * qty)}
        </PrimaryButton>
      </div>
    </BottomSheet>
  )
}
