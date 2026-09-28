import { useEffect, useRef, useState } from 'react'
import type { DishOption } from '../../../data'
import { useStore } from '../../../store'
import { Confirm } from '../../ui'
import { MENU_ERRORS, uploadPhoto, type EditDish } from './menuApi'

/**
 * Карточка блюда в конструкторе: фото, название, описание, цена, аллергены,
 * модификаторы. Сохраняет в черновик — гости увидят после «Опубликовать».
 *
 * Аллергены — обязательный вопрос: «не отмечено» и «аллергенов нет» — разные
 * ответы, и без ответа блюдо не опубликовать. Гость-аллергик верит этому списку.
 */

interface Props {
  dish: EditDish | null
  category: string
  categories: string[]
  allergens: string[]
  takenIds: Set<string>
  onSave: (dish: EditDish, category: string) => void
  onDelete: (() => void) | null
  onClose: () => void
}

interface OptDraft {
  id: string
  name: string
  choices: string
  keep: Pick<DishOption, 'effects' | 'priceDelta'>
}

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

/** Код блюда из названия: «Тост с авокадо» → tost-s-avokado. Код не меняется после создания. */
export function slugOf(name: string, taken: Set<string>): string {
  const base =
    [...name.toLowerCase()]
      .map(ch => RU[ch] ?? ch)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'dish'
  let id = /^[a-z0-9]/.test(base) && base.length >= 2 ? base : `d-${base}`
  for (let i = 2; taken.has(id); i++) id = `${base.slice(0, 26)}-${i}`
  return id
}

const optionsOf = (dish: EditDish | null): OptDraft[] =>
  (dish?.options ?? []).map(o => ({ id: o.id, name: o.name, choices: o.choices.join(', '), keep: { effects: o.effects, priceDelta: o.priceDelta } }))

export function DishEditor({ dish, category, categories, allergens, takenIds, onSave, onDelete, onClose }: Props) {
  const { toast } = useStore()
  const [name, setName] = useState(dish?.name ?? '')
  const [desc, setDesc] = useState(dish?.desc ?? '')
  const [price, setPrice] = useState(dish ? String(dish.price) : '')
  const [serving, setServing] = useState(dish?.serving ?? '')
  const [kcal, setKcal] = useState(dish?.kcal !== undefined ? String(dish.kcal) : '')
  const [cat, setCat] = useState(category)
  const [picked, setPicked] = useState<string[] | null>(dish?.allergens ?? null)
  const [opts, setOpts] = useState<OptDraft[]>(() => optionsOf(dish))
  const [photoUrl, setPhotoUrl] = useState(dish?.photoUrl)
  const [bundled, setBundled] = useState(!!dish?.photo)
  const [uploading, setUploading] = useState(false)
  const [asking, setAsking] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !asking && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asking, onClose])

  const preview = photoUrl ?? (bundled && dish ? `./dishes/${dish.id}.jpg` : null)
  const priceNum = Number(price.replace(',', '.'))

  const toggle = (a: string) => setPicked(prev => (prev?.includes(a) ? prev.filter(x => x !== a) : [...(prev ?? []), a]))

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    const r = await uploadPhoto(f)
    setUploading(false)
    if (!r.ok || !r.url) return toast(MENU_ERRORS[r.error ?? ''] ?? 'Фото не загрузилось — попробуйте ещё раз')
    setPhotoUrl(r.url)
  }

  const save = () => {
    if (!name.trim()) return toast('Назовите блюдо')
    if (!Number.isFinite(priceNum) || priceNum < 0) return toast('Проверьте цену')
    const options = opts
      .map(o => ({ ...o, list: [...new Set(o.choices.split(',').map(c => c.trim()).filter(Boolean))] }))
      .filter(o => o.name.trim() && o.list.length >= 2)
      .map((o, i) => {
        const prev = dish?.options?.find(x => x.id === o.id)
        return {
          ...o.keep,
          id: o.id || `opt-${i + 1}`,
          name: o.name.trim(),
          choices: o.list,
          default: prev?.default && o.list.includes(prev.default) ? prev.default : o.list[0]
        }
      })
    const next: EditDish = {
      ...(dish ?? {}),
      id: dish?.id ?? slugOf(name, takenIds),
      name: name.trim(),
      desc: desc.trim(),
      price: Math.round(priceNum * 100) / 100,
      serving: serving.trim() || undefined,
      kcal: kcal.trim() === '' ? undefined : Math.round(Number(kcal)),
      allergens: picked ?? undefined,
      photoUrl,
      photo: bundled || undefined,
      options: options.length ? options : undefined
    }
    onSave(next, cat)
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30" style={{ background: 'rgba(27,26,23,.3)' }} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={dish ? `Блюдо «${dish.name}»` : 'Новое блюдо'}
        className="c-fade fixed top-0 right-0 bottom-0 z-31 flex w-[min(520px,100vw)] flex-col bg-c-card"
        style={{ boxShadow: '-30px 0 60px -30px rgba(0,0,0,.35)' }}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-c-line2 px-5">
          <span className="flex-1 truncate text-[18px] font-bold">{dish ? dish.name : 'Новое блюдо'}</span>
          <button onClick={onClose} aria-label="Закрыть" className="size-9 rounded-lg text-[18px] text-c-mute hover:bg-c-chip">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex gap-4">
            <div className="relative h-35 w-28 shrink-0 overflow-hidden rounded-xl bg-c-chip">
              {preview ? (
                <img src={preview} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center text-[13px] text-c-mute">фото 4:5</span>
              )}
              {uploading && <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-[13px]">Загружаем…</span>}
            </div>
            <div className="text-[13px] leading-normal text-c-mute">
              Фото 4:5 — обрежем и сожмём сами до 300 КБ. Без фото гость увидит первую букву названия.
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => file.current?.click()} disabled={uploading} className="h-9 rounded-lg bg-c-ink px-3 text-[13px] font-bold text-white disabled:opacity-50">
                  {preview ? 'Заменить' : 'Загрузить'}
                </button>
                {preview && (
                  <button
                    onClick={() => {
                      setPhotoUrl(undefined)
                      setBundled(false)
                    }}
                    className="h-9 rounded-lg border border-c-line px-3 text-[13px] text-c-ink"
                  >
                    Убрать
                  </button>
                )}
              </div>
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => void onFile(e.target.files?.[0])} />
            </div>
          </div>

          <Field label="Название">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={80} className={INPUT} />
          </Field>
          <Field label="Описание для гостя">
            <textarea value={desc} onChange={e => setDesc(e.target.value)} maxLength={300} rows={3} className={`${INPUT} h-auto resize-none py-2.5`} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Цена, ₽">
              <input value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" className={`${INPUT} c-num`} />
            </Field>
            <Field label="Порция">
              <input value={serving} onChange={e => setServing(e.target.value)} maxLength={30} placeholder="250 г" className={INPUT} />
            </Field>
            <Field label="Ккал">
              <input value={kcal} onChange={e => setKcal(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={`${INPUT} c-num`} />
            </Field>
          </div>
          <Field label="Раздел меню">
            <select value={cat} onChange={e => setCat(e.target.value)} className={INPUT}>
              {categories.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>

          <div className="mt-4">
            <div className="mb-2 text-[13px] font-bold">Аллергены · обязательно</div>
            <div className="flex flex-wrap gap-1.5">
              <AllergenChip on={picked !== null && picked.length === 0} onClick={() => setPicked([])} label="Нет аллергенов" />
              {allergens.map(a => (
                <AllergenChip key={a} on={!!picked?.includes(a)} onClick={() => toggle(a)} label={a} />
              ))}
            </div>
            {picked === null && (
              <div className="mt-2 text-[12px] font-bold text-c-bad-ink">Отметьте аллергены или «нет аллергенов» — без этого не опубликовать</div>
            )}
          </div>

          <div className="mt-5">
            <div className="mb-2 text-[13px] font-bold">Модификаторы</div>
            {opts.map((o, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input
                  value={o.name}
                  onChange={e => setOpts(opts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Острота"
                  aria-label="Название модификатора"
                  className={`${INPUT} mt-0 w-32 shrink-0`}
                />
                <input
                  value={o.choices}
                  onChange={e => setOpts(opts.map((x, j) => (j === i ? { ...x, choices: e.target.value } : x)))}
                  placeholder="Не остро, Средне, Остро"
                  aria-label="Варианты через запятую"
                  className={`${INPUT} mt-0 min-w-0 flex-1`}
                />
                <button onClick={() => setOpts(opts.filter((_, j) => j !== i))} aria-label="Убрать модификатор" className="h-10 w-9 shrink-0 rounded-lg text-c-mute hover:bg-c-chip">
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => setOpts([...opts, { id: `opt-${Date.now().toString(36)}`, name: '', choices: '', keep: {} }])}
              className="h-9 rounded-lg border border-dashed border-c-off px-3 text-[13px]"
            >
              + Модификатор
            </button>
            <div className="mt-1.5 text-[12px] text-c-mute">Варианты — через запятую, первый выбран по умолчанию. Кухня видит выбор гостя.</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-c-line2 p-4">
          {onDelete && (
            <button onClick={() => setAsking(true)} className="h-11 rounded-xl px-3 text-[15px] text-c-bad-ink hover:bg-c-bad-bg">
              Убрать из меню
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="h-11 rounded-xl border border-c-line bg-c-card px-4 text-[15px]">
            Отмена
          </button>
          <button onClick={save} disabled={uploading} className="h-11 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold text-white disabled:opacity-50">
            В черновик
          </button>
        </div>
      </aside>
      {asking && onDelete && (
        <Confirm
          title={`Убрать «${dish?.name}» из меню?`}
          body="Блюдо пропадёт у гостей после публикации. Уже заказанное останется в счетах и на кухне."
          ok="Убрать"
          danger
          onOk={onDelete}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}

const INPUT = 'mt-1.5 h-10 w-full rounded-xl border border-c-line bg-c-bg px-3 text-[15px] outline-none focus:border-c-ink'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="text-[13px] font-bold">{label}</span>
      {children}
    </label>
  )
}

function AllergenChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-8 rounded-full px-3 text-[13px] ${on ? 'bg-c-ink text-white' : 'border border-c-line bg-c-card'}`}
    >
      {label}
    </button>
  )
}
