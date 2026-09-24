import { useEffect, useMemo, useState } from 'react'
import { ticketUrgency, ticketWait } from '@easypay/domain/kitchen'
import type { KitchenTicket } from '@easypay/domain/kitchen'
import { dismissCancelled, handOver, markReady, subscribeKitchen, takeToWork } from '../kitchenApi'
import type { KitchenPayload } from '../kitchenApi'
import { allergenAccusative } from '@easypay/domain/allergens'
import { ensureMenu, MENU, optionsLabel } from '../data'
import { ensureSettings } from '../settings'
import { useStore } from '../store'
import { useCab } from './Shell'
import { setStop, staffError } from './staffApi'
import { Empty, Toggle } from './ui'

/**
 * Кухня и бар — одна раскладка, разные очереди. Колонки по пути блюда:
 * новые → в работе → на раздаче. Справа — стоп-лист в один тап: выключили —
 * гости сразу видят «закончилось».
 */

type Ticket = KitchenTicket & {
  removedAllergens?: { id: string; choice: string; removes: string[] }[]
  comment?: string | null
  /** Аллергии тех, кто будет это есть (у общего блюда — всех, кто делит). */
  guestAllergies?: { name: string; allergies: string[] }[]
  /** В блюде есть аллерген едока: гость подтвердил риск, кухня обязана знать. */
  allergyHits?: string[]
  sharedNames?: string[] | null
  /** Отмена пришла, когда блюдо уже было на плите: продукт потерян. */
  wasCooking?: boolean
}

/** Бар готовит напитки: в menu.json это разделы «Напитки» и «Вино и бар». */
const BAR_CATEGORIES = new Set(['Напитки', 'Вино и бар'])

const COLUMNS: { id: 'new' | 'cooking' | 'ready'; kitchen: string; bar: string }[] = [
  { id: 'new', kitchen: 'Новые', bar: 'Новые' },
  { id: 'cooking', kitchen: 'В работе', bar: 'В работе' },
  { id: 'ready', kitchen: 'На раздаче', bar: 'Готово, забрать' }
]

const colOf = (t: Ticket) => (t.readyAt ? 'ready' : t.startedAt ? 'cooking' : 'new')

export function KitchenPage({ station }: { station: 'kitchen' | 'bar' }) {
  const { may, toast } = useStore()
  const { now } = useCab()
  const [data, setData] = useState<KitchenPayload | null>(null)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => subscribeKitchen(setData, setLive), [])
  useEffect(() => ensureMenu(data?.menuVersion), [data?.menuVersion])
  useEffect(() => ensureSettings(data?.settingsVersion), [data?.settingsVersion])

  const tickets = ((data?.tickets ?? []) as Ticket[]).filter(t => t.station === station)
  const cancelled = ((data?.cancelled ?? []) as Ticket[]).filter(t => t.station === station)

  const act = async (t: Ticket) => {
    if (busy) return
    setBusy(t.uid)
    const col = colOf(t)
    const ok =
      col === 'new'
        ? await takeToWork(t.tableId, t.uid, t.sessionId)
        : col === 'cooking'
          ? await markReady(t.tableId, t.uid, t.sessionId)
          : await handOver(t.tableId, t.uid, t.sessionId)
    setBusy(null)
    if (!ok) toast('Не получилось — обновите экран')
  }

  const dismiss = async (t: Ticket) => {
    setBusy(t.uid)
    const ok = await dismissCancelled(t.tableId, t.uid, t.sessionId)
    setBusy(null)
    if (!ok) toast('Не получилось — обновите экран')
  }

  if (!data) return <Empty>{live ? 'Загружаем очередь…' : 'Подключаемся к кухне…'}</Empty>

  return (
    <div className="c-fade flex flex-col gap-3.5">
      {/* Снятое с заказа не исчезает молча: повар подтверждает, что увидел,
          — иначе блюдо, которое уже никому не нужно, доедет до раздачи */}
      {cancelled.length > 0 && (
        <div className="flex flex-col gap-2">
          {cancelled.map(t => (
            <div
              key={`x-${t.tableId}-${t.uid}`}
              className="flex items-center gap-3.5 rounded-2xl border border-c-bad-line bg-c-bad-bg px-4.5 py-3"
            >
              <span className="text-[15px]">
                <b>Снято:</b> {t.name}
                {t.qty > 1 ? ` ×${t.qty}` : ''} · стол {t.tableId}
                {t.reason ? ` · ${t.reason}` : ''}
                {/* С плиты — значит, продукт уже потрачен: повар выбрасывает, а не вычёркивает */}
                {t.wasCooking && <b className="text-c-bad-ink"> · уже готовилось</b>}
              </span>
              <span className="flex-1" />
              {may('dismiss') && (
                <button
                  disabled={busy === t.uid}
                  onClick={() => void dismiss(t)}
                  className="h-10 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold text-white disabled:opacity-50"
                >
                  Понял
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid items-start gap-3.5 lg:grid-cols-[repeat(3,minmax(160px,1fr))_minmax(210px,250px)]">
        {COLUMNS.map(col => {
          const list = tickets.filter(t => colOf(t) === col.id)
          return (
            <div key={col.id} className="flex min-w-0 flex-col gap-2.5">
              <div className="flex items-baseline gap-2 px-1">
                <span className="text-[15px] font-bold">{col[station]}</span>
                <span className="text-[13px] text-c-mute">{list.length}</span>
              </div>
              {list.length === 0 && <Empty>пусто</Empty>}
              {list.map(t => (
                <TicketCard key={`${t.tableId}-${t.uid}`} t={t} now={now} busy={busy === t.uid} onAct={() => void act(t)} station={station} canAct={may(colOf(t) === 'new' ? 'start' : colOf(t) === 'cooking' ? 'ready' : 'serve')} />
              ))}
            </div>
          )
        })}
        <StopPanel station={station} stop={data.stop ?? []} q={q} setQ={setQ} canStop={may('stop')} onToast={toast} />
      </div>
    </div>
  )
}

function TicketCard({
  t,
  now,
  busy,
  onAct,
  station,
  canAct
}: {
  t: Ticket
  now: number
  busy: boolean
  onAct: () => void
  station: 'kitchen' | 'bar'
  canAct: boolean
}) {
  const col = colOf(t)
  const urgency = ticketUrgency(t, now)
  const mins = Math.floor(ticketWait(t, now) / 60_000)
  const frame =
    urgency === 'danger' ? '1.5px solid #D9876F' : urgency === 'warn' ? '1.5px solid #E3C27A' : '1px solid #E6E2DA'
  const timeColor = urgency === 'danger' ? '#B03A1E' : urgency === 'warn' ? '#9A6A0B' : '#6B665E'
  const label = col === 'new' ? 'В работу' : col === 'cooking' ? 'Готово, на раздачу' : 'Забрали в зал'
  const btn =
    col === 'new'
      ? { background: '#F1EEE8', color: '#1B1A17' }
      : col === 'cooking'
        ? { background: '#1B1A17', color: '#FFFFFF' }
        : { background: '#2E8A55', color: '#FFFFFF' }
  const mods = optionsLabel(t.options)

  return (
    <div className="rounded-2xl bg-c-card p-3.5" style={{ border: frame }}>
      <div className="flex items-baseline gap-2">
        <span className="text-[20px] font-bold">{t.tableId}</span>
        <span className="text-[12px] text-c-mute">{t.zoneName}</span>
        <span className="flex-1" />
        <span className="c-num text-[15px] font-bold" style={{ color: timeColor }}>
          {mins} мин
        </span>
      </div>
      <div className="mt-1.5 text-[17px] leading-tight font-bold">
        {t.name}
        {t.qty > 1 ? ` ×${t.qty}` : ''}
      </div>
      {/* Вариант, снимающий аллерген, — не пожелание, а запрет */}
      {/* Аллергия едока — первым делом: это не пожелание, а запрет */}
      {(t.guestAllergies ?? []).map(g => (
        <div key={g.name} className="mt-2 rounded-lg bg-c-bad px-2.5 py-2 text-[13px] font-bold text-white">
          АЛЛЕРГИЯ · {g.name}: {g.allergies.join(', ')}
        </div>
      ))}
      {(t.allergyHits ?? []).length > 0 && (
        <div className="mt-1.5 rounded-lg border border-c-bad-line bg-c-bad-bg px-2.5 py-1.5 text-[12px] font-bold text-c-bad-ink">
          В блюде есть {t.allergyHits!.join(', ')} — гость предупреждён и подтвердил. Уточните у официанта.
        </div>
      )}
      {(t.removedAllergens ?? []).map(r => (
        <div key={r.id} className="mt-2 rounded-lg bg-c-bad px-2.5 py-2 text-[13px] font-bold text-white">
          {r.choice.toUpperCase()} — снимает {r.removes.map(allergenAccusative).join(' и ')}
        </div>
      ))}
      {mods && <div className="mt-1.5 text-[13px]">{mods}</div>}
      {t.comment && <div className="mt-1.5 text-[13px] font-bold">✎ {t.comment}</div>}
      {/* И на баре тоже: сульфиты в вине и орехи в миндальном молоке — его работа */}
      {t.allergens?.length > 0 && (
        <div className="mt-1.5 text-[12px] font-bold text-c-warn-ink">аллергены: {t.allergens.join(' · ')}</div>
      )}
      <div className="mt-1.5 text-[12px] text-c-mute">
        {t.shared ? `на стол${t.sharedNames?.length ? `: ${t.sharedNames.join(', ')}` : ''}` : t.guest}
        {t.waiterName ? ` · ${t.waiterName}` : ''}
      </div>
      {canAct && (
        <button
          disabled={busy}
          onClick={onAct}
          className="mt-3 h-11 w-full rounded-[10px] text-[15px] font-bold disabled:opacity-50"
          style={btn}
        >
          {busy ? 'Секунду…' : label}
        </button>
      )}
    </div>
  )
}

function StopPanel({
  station,
  stop,
  q,
  setQ,
  canStop,
  onToast
}: {
  station: 'kitchen' | 'bar'
  stop: string[]
  q: string
  setQ: (v: string) => void
  canStop: boolean
  onToast: (m: string) => void
}) {
  const [pending, setPending] = useState<string | null>(null)
  const { menuRev } = useStore()
  const dishes = useMemo(
    () =>
      Object.entries(MENU).flatMap(([cat, items]) =>
        items.filter(d => (d.station ?? (BAR_CATEGORIES.has(cat) ? 'bar' : 'kitchen')) === station)
      ),
    // menuRev — меню опубликовали заново
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [station, menuRev]
  )
  const stopped = new Set(stop)
  const needle = q.trim().toLowerCase()
  const shown = dishes.filter(d => !needle || d.name.toLowerCase().includes(needle))
  // Выключенное — наверх: это то, о чём повар должен помнить
  const sorted = [...shown].sort((a, b) => Number(stopped.has(b.id)) - Number(stopped.has(a.id)))

  const flip = async (id: string, name: string) => {
    if (pending) return
    setPending(id)
    const next = !stopped.has(id)
    const r = await setStop(id, next)
    setPending(null)
    onToast(r.ok ? (next ? `${name} — закончилось` : `${name} — снова в меню`) : staffError(r))
  }

  return (
    <div className="c-card sticky top-0 p-3.5">
      <div className="text-[15px] font-bold">
        Стоп-лист · {dishes.filter(d => stopped.has(d.id)).length}
      </div>
      <div className="mt-0.5 text-[12px] text-c-mute">Выключили — гости сразу видят «закончилось»</div>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Найти"
        aria-label="Найти блюдо в стоп-листе"
        className="mt-2.5 h-9 w-full rounded-[10px] border border-c-line bg-c-bg px-3 text-[13px] outline-none focus:border-c-ink"
      />
      <div className="mt-1.5 max-h-[60vh] overflow-y-auto">
        {sorted.map(d => {
          const off = stopped.has(d.id)
          return (
            <div key={d.id} className="flex h-11 items-center gap-2.5 border-b border-c-line2 last:border-b-0">
              <span className={`min-w-0 flex-1 truncate text-[14px] ${off ? 'text-c-mute line-through' : ''}`}>{d.name}</span>
              <Toggle
                on={!off}
                label={`${d.name}: ${off ? 'закончилось' : 'в меню'}`}
                disabled={!canStop || pending === d.id}
                onClick={() => void flip(d.id, d.name)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
