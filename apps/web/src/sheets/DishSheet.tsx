import { useEffect, useRef, useState } from 'react'
import { allergenAccusative } from '@easypay/domain/allergens'
import { allergenTags, defaultOptions, findDish, priceWithOptions } from '../data'
import type { Dish, LineOptions } from '../data'
import { useStore } from '../store'
import { newIdemKey } from '../keys'
import { fmt } from '../format'
import { dishTall } from '../guest/showcase'
import { allergyHits, rescues } from '../guest/allergy'

const MAX_QTY = 9 // столько же принимает сервер

/**
 * Что именно гость получит с учётом выбора. Модификатор объёма меняет порцию,
 * и подпись «150 мл» рядом с выбранной бутылкой — прямой обман.
 */
function servingLabel(dish: Dish, opts: LineOptions): string | null {
  const volume = dish.options?.find(o => /объ[её]м|порци|размер/i.test(o.name))
  const chosen = volume ? opts[volume.id] : null
  return chosen || dish.serving || null
}

/**
 * Карточка блюда — на весь экран, внизу цена одной кнопкой.
 *
 * Аллергия: предупреждение видно сразу, а не после нажатия, и кнопка
 * неактивна, пока гость не отметит «понимаю». Сервер проверяет то же самое
 * сам — если клиент чего-то не знал, ответ 409 покажет то же предупреждение.
 */
export function DishSheet() {
  const { ui, patch, me, snap, addLine, toast } = useStore()
  const companyAtTable = (snap?.personas.length ?? 0) > 1
  const dish = ui.currentDishId ? findDish(ui.currentDishId) : undefined
  const [qty, setQty] = useState(1)
  const [shared, setShared] = useState(false)
  const [opts, setOpts] = useState<LineOptions>(() => (dish ? defaultOptions(dish) : {}))
  // Сервер остановил заказ: в блюде есть то, на что гость указал аллергию
  const [blocked, setBlocked] = useState<string[] | null>(ui.pendingAllergens)
  /**
   * Что именно гость подтвердил — НАБОР аллергенов, а не флаг. Флаг переживал
   * смену варианта: подтвердил лактозу в мороженом, выбрал «Фисташку» — и
   * орехи уходили на кухню как уже подтверждённые.
   */
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  // Одно открытие карточки — одно намерение заказать. Повторные нажатия
  // приходят на сервер с тем же ключом и не создают вторую порцию:
  // количество выбирается плюсиком, а не частотой тапов.
  // После обрыва в шторке имени карточку открывают заново с ТЕМ ЖЕ ключом:
  // если сервер успел добавить блюдо, повтор не создаст вторую порцию
  const addKey = useRef(ui.resumeKey ?? newIdemKey())
  const [busy, setBusy] = useState(false)
  // Защёлка синхронная: setState применяется к следующему рендеру, и семь
  // тапов внутри одного тика проскакивали мимо флага busy все семь раз
  const sending = useRef(false)

  // Карточка переиспользуется под разные блюда, и состояние обязано ехать за
  // блюдом — сбрасываем СИНХРОННО, а не эффектом: эффект отставал на рендер,
  // и первый кадр нового блюда считал цену по опциям предыдущего.
  const [shownDish, setShownDish] = useState<string | null>(dish?.id ?? null)
  if (dish && shownDish !== dish.id) {
    setShownDish(dish.id)
    addKey.current = ui.resumeKey ?? newIdemKey()
    setOpts(defaultOptions(dish))
    setQty(1)
    setShared(false)
    setBlocked(ui.pendingAllergens)
    setConfirmedFor(null)
    setDetails(false)
  }
  // Предупреждение, доставшееся от шторки с именем, показано — гасим его в UI
  useEffect(() => {
    if (ui.pendingAllergens || ui.resumeKey) patch({ pendingAllergens: null, resumeKey: null })
  }, [ui.pendingAllergens, ui.resumeKey])

  if (!dish) return null

  const mine = me?.allergies ?? []
  // Риск считаем по ТЕКУЩЕМУ выбору: «без сметаны» снимает лактозу — и
  // предупреждение уходит само, без галочки
  const risk = Array.from(new Set([...allergyHits(dish, mine, opts), ...(blocked ?? []).filter(a => allergenTags(dish, opts).includes(a))]))
  const fixes = rescues(dish, risk, mine)
  const riskKey = [...risk].sort().join('|')
  const confirmed = risk.length > 0 && confirmedFor === riskKey
  const needOk = risk.length > 0 && !confirmed
  const price = priceWithOptions(dish, opts) * qty
  const allAllergens = allergenTags(dish, opts)

  const close = () => patch({ sheet: null, currentDishId: null, pendingAdd: null })

  const add = async () => {
    if (sending.current || dish.stop || needOk) return
    const asShared = companyAtTable && shared
    if (!me) {
      // Имя спрашиваем ровно в момент первой надобности; блюдо НЕ теряется
      patch({ sheet: 'name', pendingAdd: { dishId: dish.id, qty, shared: asShared, options: opts, idemKey: addKey.current } })
      return
    }
    sending.current = true
    setBusy(true)
    const res = await addLine(dish.id, qty, asShared, opts, undefined, confirmed, addKey.current)
    sending.current = false
    setBusy(false)
    if (res.allergens && res.allergens.length > 0) {
      // Сервер знает то, чего не знал клиент: показываем, а не проглатываем
      setBlocked(res.allergens)
      setConfirmedFor(null)
      return
    }
    // Сервер отказал — карточка остаётся открытой, тоста об успехе нет
    if (!res.ok) return
    patch({ sheet: null, currentDishId: null })
    toast(asShared ? `${dish.name} — на всех` : `${dish.name} — добавлено`)
  }

  const stats: [string, string][] = [
    [dish.kcal ? String(dish.kcal) : '—', 'ккал'],
    [servingLabel(dish, opts) ?? '—', 'порция'],
    [allAllergens.length ? String(allAllergens.length) : 'нет', 'аллергены']
  ]
  const alreadyShared = shared && (snap?.lines ?? []).some(l => l.shared && l.dishId === dish.id && !l.cancelled)

  return (
    <div className="g-anim-up absolute inset-0 z-[21] bg-g-paper" role="dialog" aria-modal="true" aria-label={dish.name}>
      <div className="g-noscroll absolute inset-0 overflow-y-auto pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
        <div className="relative h-145 bg-g-s1">
          <img src={dishTall(dish.id)} alt="" className="size-full object-cover object-top" />
          <div className="g-photo-fade absolute inset-0" />
        </div>

        <div className="relative -mt-37.5 px-5 text-center">
          <h2 className="g-serif text-[44px] text-balance text-g-fg">{dish.name}</h2>
          <div className="mt-4.5 grid grid-cols-3">
            {stats.map(([v, l]) => (
              <div key={l}>
                <div className="text-[17px] font-bold text-g-fg">{v}</div>
                <div className="text-[13px] text-g-mute">{l}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setDetails(x => !x)}
            aria-expanded={details}
            className="mt-3.5 h-9 rounded-full bg-g-s1 px-4 text-[13px] text-g-fg"
          >
            {details ? 'скрыть' : 'подробнее'}
          </button>
          {details && (
            <div className="mt-3.5 rounded-[20px] bg-g-s1 p-4 text-left">
              <div className="text-[15px] leading-normal text-g-body">{dish.desc}</div>
              <div className="mt-3 text-[13px] font-bold text-g-mute">аллергены</div>
              <div className="mt-0.5 text-[15px] text-g-fg">
                {allAllergens.length ? allAllergens.join(' · ') : 'нет'}
                {(dish.options ?? []).some(o => o.effects) ? ' · зависит от выбора ниже' : ''}
              </div>
            </div>
          )}
        </div>

        <div className="px-5">
          {dish.stop && (
            <div className="mt-4 rounded-[20px] bg-g-s1 px-4 py-3.5 text-[15px] text-g-body">
              Закончилось на сегодня — кухня не сможет его приготовить.
            </div>
          )}

          {risk.length > 0 && (
            <div className="mt-4 rounded-[20px] px-4 py-3.5" style={{ border: '1.5px solid #FF9A7A' }}>
              <div className="text-[15px] font-bold text-g-warn">Есть {risk.join(', ')} — у вас аллергия</div>
              <div className="mt-1 text-[13px] text-g-body">Кухня увидит ваш выбор как запрет, а не как пожелание.</div>
              {/* Приложение знает, какой вариант снимает аллерген, — кухне оно
                  это говорит. Гостю не сказать было прямой потерей. */}
              {fixes.map(f => (
                <button
                  key={`${f.optionId}-${f.choice}`}
                  onClick={() => setOpts(prev => ({ ...prev, [f.optionId]: f.choice }))}
                  className="mt-2.5 flex min-h-11 w-full items-center rounded-2xl px-3.5 text-left text-[14px] font-bold text-g-ok"
                  style={{ border: '1px solid rgba(143,212,164,.45)' }}
                >
                  Взять «{f.choice}» — снимет {f.removes.map(allergenAccusative).join(' и ')}
                </button>
              ))}
              <button
                onClick={() => setConfirmedFor(confirmed ? null : riskKey)}
                aria-pressed={confirmed}
                className="mt-2.5 flex min-h-11 items-center gap-2.5 text-[15px] text-g-fg"
              >
                <span
                  className="flex size-6 items-center justify-center rounded-md text-[15px] text-g-on-acc"
                  style={confirmed ? { background: '#FF9A7A' } : { border: '1.5px solid #FF9A7A' }}
                >
                  {confirmed ? '✓' : ''}
                </span>
                понимаю, всё равно заказать
              </button>
            </div>
          )}

          {(dish.options ?? []).map(opt => {
            const chosen = opts[opt.id]
            const removes = chosen ? opt.effects?.[chosen]?.removes ?? [] : []
            return (
              <div key={opt.id} className="mt-5">
                <div className="text-[13px] text-g-mute">{opt.name}</div>
                <div className="g-noscroll mt-2 flex gap-2 overflow-x-auto">
                  {opt.choices.map(choice => {
                    const on = chosen === choice
                    return (
                      <button
                        key={choice}
                        onClick={() => setOpts(prev => ({ ...prev, [opt.id]: choice }))}
                        aria-pressed={on}
                        className="h-18 min-w-24 shrink-0 rounded-[20px] px-3.5 text-[15px]"
                        style={
                          on
                            ? { background: '#F3F0EA', color: '#1A1612', border: '1px solid #F3F0EA' }
                            : { background: 'var(--g-s1)', color: '#F3F0EA', border: '1px solid rgba(255,255,255,.1)' }
                        }
                      >
                        {choice}
                      </button>
                    )
                  })}
                </div>
                {removes.length > 0 && (
                  <div className="mt-2 text-[13px] font-bold text-g-ok">
                    {chosen} — снимает {removes.map(allergenAccusative).join(' и ')}
                  </div>
                )}
              </div>
            )
          })}

          {/* Общее блюдо — только когда за столом есть с кем делить */}
          {companyAtTable && (
            <button
              onClick={() => setShared(x => !x)}
              aria-pressed={shared}
              className="mt-5 flex w-full items-center gap-3 rounded-[20px] bg-g-s1 p-4 text-left text-g-fg"
            >
              <span className="flex-1">
                <span className="block text-[15px] font-bold">на всех за столом</span>
                <span className="block text-[13px] text-g-mute">разделим на тех, кто за столом при отправке</span>
              </span>
              <span
                className="relative h-8 w-13 shrink-0 rounded-full transition-colors"
                style={{ background: shared ? 'var(--g-acc)' : 'rgba(255,255,255,.1)' }}
              >
                <span
                  className="absolute top-0.75 size-6.5 rounded-full bg-white transition-[left]"
                  style={{ left: shared ? 23 : 3 }}
                />
              </span>
            </button>
          )}
          {alreadyShared && (
            <div className="mt-2 px-1 text-[13px] text-g-tan">
              {dish.name} уже есть в общих блюдах стола — это будет ещё одна порция.
            </div>
          )}
        </div>
      </div>

      <div className="absolute top-4 left-4 z-[2]">
        <button aria-label="Закрыть" onClick={close} className="g-glass size-11 rounded-full text-[17px]">
          ✕
        </button>
      </div>

      <div className="g-dock absolute right-3 bottom-[calc(0.875rem+env(safe-area-inset-bottom))] left-3 flex gap-2 rounded-[32px] p-2">
        <div className="flex h-14 items-center rounded-full bg-g-s1">
          <button
            aria-label="Меньше"
            disabled={qty <= 1}
            onClick={() => setQty(q => Math.max(1, q - 1))}
            className="h-14 w-12 text-xl text-g-fg disabled:opacity-35"
          >
            −
          </button>
          <span className="g-num min-w-4.5 text-center text-[17px] font-bold text-g-fg">{qty}</span>
          <button
            aria-label="Больше"
            disabled={qty >= MAX_QTY}
            onClick={() => setQty(q => Math.min(MAX_QTY, q + 1))}
            className="h-14 w-12 text-xl text-g-fg disabled:opacity-35"
          >
            +
          </button>
        </div>
        <button
          onClick={() => void add()}
          disabled={busy || dish.stop || needOk}
          className="g-cta g-num h-14 flex-1 rounded-full text-[20px] disabled:opacity-40"
        >
          {dish.stop ? 'Закончилось' : busy ? 'Секунду…' : `+ ${fmt(price)}`}
        </button>
      </div>
    </div>
  )
}
