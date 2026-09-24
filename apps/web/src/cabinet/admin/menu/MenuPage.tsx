import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmt } from '../../../format'
import { HALL } from '../../../hallConfig'
import { useStore } from '../../../store'
import { setStop } from '../../staffApi'
import { Confirm, Empty, Toggle } from '../../ui'
import { Loading } from '../parts'
import { DishEditor } from './DishEditor'
import {
  MENU_ERRORS,
  discardDraft,
  fetchEditor,
  fetchStop,
  humanDetail,
  publishMenu,
  saveDraft,
  type EditDish,
  type EditorPayload,
  type MenuCat
} from './menuApi'

/**
 * Конструктор меню. Правки копятся в черновике (он живёт на сервере — можно
 * начать на ноутбуке и закончить на планшете), гости видят меню только после
 * «Опубликовать». Стоп-лист — не правка меню: тумблер действует сразу.
 */

type Status = 'new' | 'changed' | null
const SAVE_DELAY = 800

/** Сравнение без учёта порядка ключей: сервер нормализует блюдо по-своему. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter(k => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

export function MenuPage() {
  const { toast } = useStore()
  const [data, setData] = useState<EditorPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [cats, setCats] = useState<MenuCat[]>([])
  const [catIdx, setCatIdx] = useState(0)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<{ dish: EditDish | null; cat: string } | null>(null)
  const [stop, setStopList] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    const [ed, st] = await Promise.all([fetchEditor(), fetchStop()])
    if (!ed) return setFailed(true)
    setData(ed)
    setCats(structuredClone(ed.draft?.categories ?? ed.published.categories))
    setStopList(st)
    setSaving('idle')
  }, [])
  useEffect(() => {
    void load()
    return () => clearTimeout(timer.current)
  }, [load])

  const published = useMemo(() => {
    const map = new Map<string, EditDish>()
    for (const c of data?.published.categories ?? []) for (const d of c.dishes) map.set(d.id, d)
    return map
  }, [data])

  const statusOf = (d: EditDish): Status => {
    const was = published.get(d.id)
    if (!was) return 'new'
    return stable(was) === stable(d) ? null : 'changed'
  }
  const allDraft = cats.flatMap(c => c.dishes)
  const draftIds = new Set(allDraft.map(d => d.id))
  const removed = [...published.keys()].filter(id => !draftIds.has(id)).length
  const changed = allDraft.filter(d => statusOf(d) !== null).length
  const orderChanged =
    JSON.stringify(cats.map(c => [c.name, c.dishes.map(d => d.id)])) !==
    JSON.stringify((data?.published.categories ?? []).map(c => [c.name, c.dishes.map(d => d.id)]))
  const dirty = changed > 0 || removed > 0 || orderChanged

  /** Любая правка — сразу в локальный черновик и с задержкой на сервер. */
  const update = (next: MenuCat[]) => {
    setCats(next)
    setProblems([])
    setSaving('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const r = await saveDraft(next)
      setSaving(r.ok ? 'saved' : 'error')
      if (!r.ok) toast(MENU_ERRORS[r.error ?? ''] ?? 'Черновик не сохранился — проверьте связь')
    }, SAVE_DELAY)
  }

  if (!data) return <Loading failed={failed} />
  const cat = cats[Math.min(catIdx, cats.length - 1)]
  const needle = q.trim().toLowerCase()
  const dishes = needle
    ? cats.flatMap(c => c.dishes).filter(d => d.name.toLowerCase().includes(needle))
    : (cat?.dishes ?? [])

  const saveDish = (dish: EditDish, target: string) => {
    const without = cats.map(c => ({ ...c, dishes: c.dishes.filter(d => d.id !== dish.id) }))
    const wasIn = cats.find(c => c.dishes.some(d => d.id === dish.id))?.name
    const next = without.map(c => {
      if (c.name !== target) return c
      if (wasIn === target) return { ...c, dishes: cats.find(x => x.name === target)!.dishes.map(d => (d.id === dish.id ? dish : d)) }
      return { ...c, dishes: [...c.dishes, dish] }
    })
    update(next)
    setEditing(null)
  }
  const removeDish = (id: string) => {
    update(cats.map(c => ({ ...c, dishes: c.dishes.filter(d => d.id !== id) })))
    setEditing(null)
  }
  const moveCat = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= cats.length) return
    const next = [...cats]
    ;[next[i], next[j]] = [next[j], next[i]]
    update(next)
    if (catIdx === i) setCatIdx(j)
  }
  const addCat = () => {
    const name = window.prompt('Название раздела', '')?.trim()
    if (!name) return
    if (cats.some(c => c.name.toLowerCase() === name.toLowerCase())) return toast('Такой раздел уже есть')
    update([...cats, { name: name.slice(0, 40), dishes: [] }])
    setCatIdx(cats.length)
  }
  const renameCat = (i: number) => {
    const name = window.prompt('Новое название раздела', cats[i].name)?.trim()
    if (!name || name === cats[i].name) return
    if (cats.some(c => c.name.toLowerCase() === name.toLowerCase())) return toast('Такой раздел уже есть')
    update(cats.map((c, j) => (j === i ? { ...c, name: name.slice(0, 40) } : c)))
  }
  const dropCat = (i: number) => {
    if (cats[i].dishes.length) return toast('Сначала перенесите или уберите блюда раздела')
    update(cats.filter((_, j) => j !== i))
    setCatIdx(0)
  }

  const publish = async () => {
    clearTimeout(timer.current)
    setBusy(true)
    // Последние правки могли ещё не уйти на сервер — публикуем ровно то, что на экране
    const saved = await saveDraft(cats)
    const r = saved.ok ? await publishMenu() : saved
    setBusy(false)
    setAsking(false)
    if (!r.ok) {
      const details = (r.body.details as string[] | undefined) ?? []
      setProblems(details.map(d => humanDetail(d, allDraft)))
      return toast(MENU_ERRORS[r.error ?? ''] ?? 'Не опубликовалось — попробуйте ещё раз')
    }
    toast(`Меню опубликовано — гости уже видят версию ${String(r.body.version)}`)
    await load()
  }
  const discard = async () => {
    clearTimeout(timer.current)
    const r = await discardDraft()
    if (!r.ok) return toast('Не получилось отменить — проверьте связь')
    toast('Черновик отменён')
    await load()
  }
  const flipStop = async (d: EditDish) => {
    const on = !stop.includes(d.id)
    const r = await setStop(d.id, on)
    if (!r.ok) return toast('Стоп-лист не изменился — проверьте связь')
    setStopList(on ? [...stop, d.id] : stop.filter(x => x !== d.id))
    toast(on ? `«${d.name}» — в стопе, гости видят «закончилось»` : `«${d.name}» снова в меню`)
  }

  const publishedAt = data.published.publishedAt
    ? new Date(data.published.publishedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="c-card flex flex-wrap items-center gap-3 px-4.5 py-3">
        <span className={`size-2.5 rounded-full ${dirty ? 'bg-c-warn' : 'bg-c-ok'}`} />
        <span className="min-w-0 flex-1 text-[14px]">
          {dirty ? (
            <>
              <b>Черновик</b> · изменено блюд: {changed}
              {removed > 0 && ` · убрано: ${removed}`}
              {orderChanged && changed === 0 && removed === 0 && ' · порядок разделов'}
              <span className="text-c-mute"> · {saving === 'pending' ? 'сохраняем…' : saving === 'error' ? 'не сохранено' : 'сохранено'}</span>
            </>
          ) : (
            <>
              <b>Опубликовано</b>
              <span className="text-c-mute">
                {' '}
                · версия {data.published.version}
                {publishedAt ? ` · ${publishedAt}` : ' · из исходного файла'}
              </span>
            </>
          )}
        </span>
        {dirty && (
          <button onClick={discard} className="h-10 rounded-xl border border-c-line bg-c-card px-3.5 text-[14px]">
            Отменить изменения
          </button>
        )}
        <a
          href={`/?t=${encodeURIComponent(HALL.zones[0]?.tables[0]?.id ?? '1')}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-10 items-center rounded-xl border border-c-line bg-c-card px-3.5 text-[14px]">
          Как видит гость ↗
        </a>
        <button
          onClick={() => setAsking(true)}
          disabled={!dirty || busy}
          className="h-10 rounded-xl bg-c-ink px-4 text-[14px] font-bold text-white disabled:opacity-40"
        >
          Опубликовать
        </button>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="rounded-2xl border border-c-bad-line bg-c-bad-bg p-4 text-[14px] text-c-bad-ink">
          <b>Перед публикацией поправьте:</b>
          <ul className="mt-1.5 list-disc pl-5">
            {problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="c-card p-2" aria-label="Разделы меню">
          <div className="px-2.5 pt-1.5 pb-2 text-[12px] font-bold text-c-mute">Разделы</div>
          {cats.map((c, i) => {
            const on = i === catIdx && !needle
            return (
              <div key={`${c.name}-${i}`} className={`group flex items-center gap-1 rounded-[10px] pr-1 ${on ? 'bg-c-chip' : ''}`}>
                <button onClick={() => (on ? renameCat(i) : setCatIdx(i))} title={on ? 'Переименовать' : c.name} className="h-10 min-w-0 flex-1 truncate px-2.5 text-left text-[14px]">
                  <span className={on ? 'font-bold' : ''}>{c.name}</span>
                </button>
                <span className="c-num text-[12px] text-c-mute">{c.dishes.length}</span>
                <button onClick={() => moveCat(i, -1)} aria-label={`Раздел «${c.name}» выше`} className="size-7 rounded text-c-mute hover:bg-c-line2">
                  ↑
                </button>
                <button onClick={() => moveCat(i, 1)} aria-label={`Раздел «${c.name}» ниже`} className="size-7 rounded text-c-mute hover:bg-c-line2">
                  ↓
                </button>
                {c.dishes.length === 0 && (
                  <button onClick={() => dropCat(i)} aria-label={`Удалить раздел «${c.name}»`} className="size-7 rounded text-c-mute hover:bg-c-line2">
                    ✕
                  </button>
                )}
              </div>
            )
          })}
          <button onClick={addCat} className="mt-1 h-10 w-full rounded-[10px] border border-dashed border-c-off text-[13px]">
            + Раздел
          </button>
        </nav>

        <section className="c-card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-c-line2 px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{needle ? 'Поиск по меню' : cat?.name}</span>
            <input
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Найти блюдо"
              aria-label="Найти блюдо"
              className="h-9 w-48 rounded-full border border-c-line bg-c-bg px-3.5 text-[13px] outline-none focus:border-c-ink"
            />
            <button
              onClick={() => setEditing({ dish: null, cat: cat?.name ?? cats[0]?.name ?? '' })}
              disabled={cats.length === 0}
              className="h-9 rounded-xl bg-c-ink px-3.5 text-[13px] font-bold text-white disabled:opacity-40"
            >
              + Блюдо
            </button>
          </div>
          {dishes.length === 0 ? (
            <div className="p-4">
              <Empty>{needle ? 'Ничего не нашли' : 'В разделе пока нет блюд'}</Empty>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-[14px]">
                <thead>
                  <tr className="border-b border-c-line text-left text-[12px] text-c-mute">
                    <th className="w-16 px-4 py-2.5" />
                    <th className="px-2 py-2.5 font-bold">Блюдо</th>
                    <th className="px-2 py-2.5 text-right font-bold">Цена</th>
                    <th className="px-2 py-2.5 font-bold">Аллергены</th>
                    <th className="px-2 py-2.5 font-bold">Статус</th>
                    <th className="px-4 py-2.5 text-right font-bold">Стоп</th>
                  </tr>
                </thead>
                <tbody>
                  {dishes.map(d => (
                    <DishRow
                      key={d.id}
                      dish={d}
                      status={statusOf(d)}
                      stopped={stop.includes(d.id)}
                      live={published.has(d.id)}
                      onOpen={() => setEditing({ dish: d, cat: cats.find(c => c.dishes.some(x => x.id === d.id))?.name ?? '' })}
                      onStop={() => void flipStop(d)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editing && (
        <DishEditor
          key={editing.dish?.id ?? 'new'}
          dish={editing.dish}
          category={editing.cat}
          categories={cats.map(c => c.name)}
          allergens={data.allergens}
          takenIds={new Set([...draftIds, ...published.keys()])}
          onSave={saveDish}
          onDelete={editing.dish ? () => removeDish(editing.dish!.id) : null}
          onClose={() => setEditing(null)}
        />
      )}
      {asking && (
        <Confirm
          title="Опубликовать меню?"
          body={`Гости, кухня и зал сразу увидят новое меню. Изменено блюд: ${changed}${removed ? `, убрано: ${removed}` : ''}. Уже заказанное остаётся в счетах по старой цене.`}
          ok="Опубликовать"
          busy={busy}
          onOk={() => void publish()}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  )
}

const STATUS: Record<'new' | 'changed', { label: string; bg: string; fg: string }> = {
  new: { label: 'Новое', bg: '#EEF3FA', fg: '#2D5A8A' },
  changed: { label: 'Изменено', bg: '#FBF1DC', fg: '#7A5306' }
}

function DishRow(props: { dish: EditDish; status: Status; stopped: boolean; live: boolean; onOpen: () => void; onStop: () => void }) {
  const { dish: d, status } = props
  const photo = d.photoUrl ?? (d.photo ? `./dishes/thumb/${d.id}.jpg` : null)
  return (
    <tr onClick={props.onOpen} className="cursor-pointer border-b border-c-line2 last:border-0 hover:bg-c-chip">
      <td className="px-4 py-2.5">
        <span className="flex h-12 w-10 items-center justify-center overflow-hidden rounded-lg bg-c-chip text-[11px] text-c-mute">
          {photo ? <img src={photo} alt="" loading="lazy" className="size-full object-cover" /> : 'нет'}
        </span>
      </td>
      <td className="max-w-[320px] px-2 py-2.5">
        <div className="truncate font-bold">{d.name}</div>
        <div className="truncate text-[12px] text-c-mute">{[d.serving, d.desc].filter(Boolean).join(' · ')}</div>
      </td>
      <td className="c-num px-2 py-2.5 text-right font-bold whitespace-nowrap">{fmt(d.price)}</td>
      <td className="px-2 py-2.5 text-[12px]">
        {d.allergens === undefined ? (
          <span className="font-bold text-c-bad-ink">не отмечены</span>
        ) : d.allergens.length === 0 ? (
          <span className="text-c-mute">нет</span>
        ) : (
          <span className="text-c-soft">{d.allergens.join(', ')}</span>
        )}
      </td>
      <td className="px-2 py-2.5">
        {status && (
          <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold" style={{ background: STATUS[status].bg, color: STATUS[status].fg }}>
            {STATUS[status].label}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
        {props.live ? (
          <Toggle on={props.stopped} onClick={props.onStop} danger label={`${d.name}: стоп-лист`} />
        ) : (
          <span className="text-[12px] text-c-mute">после публикации</span>
        )}
      </td>
    </tr>
  )
}
