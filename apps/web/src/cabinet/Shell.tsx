import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { subscribeHall } from '../hallApi'
import type { HallPayload } from '../hallApi'
import { ROLE_LABEL } from '@easypay/domain/roles'
import { RESTAURANT } from '../data'
import { fmt } from '../format'
import { ensureSettings, SETTINGS } from '../settings'
import { Icon } from './icons'
import { ADMIN_PAGES, go, href, type CabRoute, type Workspace } from './route'
import { CToast } from './ui'

/**
 * Каркас кабинета 4.0: переключатель рабочих мест «Кабинет · Зал · Кухня ·
 * Бар» наверху, боковое меню — только в кабинете. Каждая роль видит свои
 * места: повар — кухню и бар, официант — ещё и зал, менеджер — всё.
 */

interface CabCtx {
  hall: HallPayload | null
  hallLive: boolean
  /** Общий секундный тик для таймеров стадий и столов. */
  now: number
}

const Ctx = createContext<CabCtx>({ hall: null, hallLive: false, now: Date.now() })
export const useCab = () => useContext(Ctx)

const SIDE_KEY = 'easypay-cab-side'

export function Shell({ route, title, children }: { route: CabRoute; title: ReactNode; children: ReactNode }) {
  const { staff, may, signOutStaff, ui } = useStore()
  const [hall, setHall] = useState<HallPayload | null>(null)
  const [hallLive, setHallLive] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [side, setSide] = useState(() => {
    try {
      const v = localStorage.getItem(SIDE_KEY)
      return v === null ? window.innerWidth >= 1200 : v === '1'
    } catch {
      return true
    }
  })

  // На планшете и телефоне меню — только иконки: иначе 248 px съедают полэкрана
  const narrow = useNarrow()
  const open = side && !narrow

  const canHall = may('hall')
  // Поток зала нужен и шапке (смена), и самому залу — подписываемся один раз
  useEffect(() => (canHall ? subscribeHall(setHall, setHallLive) : undefined), [canHall])
  useEffect(() => ensureSettings(hall?.settingsVersion), [hall?.settingsVersion])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const toggleSide = () =>
    setSide(v => {
      try {
        localStorage.setItem(SIDE_KEY, v ? '0' : '1')
      } catch {
        /* приватный режим — живём без памяти */
      }
      return !v
    })

  const spaces: { ws: Workspace; label: string; ok: boolean }[] = [
    { ws: 'admin', label: 'Кабинет', ok: may('log') },
    { ws: 'hall', label: 'Зал', ok: may('hall') },
    { ws: 'kitchen', label: 'Кухня', ok: may('kitchen') },
    { ws: 'bar', label: 'Бар', ok: may('kitchen') }
  ]
  const admin = route.ws === 'admin'
  const startedAt = hall?.shift?.startedAt
  const shiftOpen = hall?.shift?.open !== false
  const shiftLabel = !hall
    ? null
    : !shiftOpen
      ? 'Смена закрыта'
      : startedAt
        ? `Смена с ${new Date(startedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
        : null

  return (
    <Ctx.Provider value={{ hall, hallLive, now }}>
      <div className="cab flex h-full min-h-0 w-full overflow-hidden">
        {admin && (
          <aside
            className="flex shrink-0 flex-col overflow-hidden border-r border-c-line bg-c-card px-2.5 py-5.5 transition-[width] duration-200"
            style={{ width: open ? 248 : 64 }}
          >
            {open && (
              <div className="px-2.5 pb-5.5">
                <div className="text-[17px] leading-tight font-bold">{RESTAURANT}</div>
                <div className="mt-1 text-[13px] text-c-mute">Кабинет · EasyPay</div>
              </div>
            )}
            <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Разделы кабинета">
              {ADMIN_PAGES.map(p => {
                const on = route.page === p.id
                return (
                  <a
                    key={p.id}
                    href={href({ ws: 'admin', page: p.id })}
                    title={p.label}
                    aria-current={on ? 'page' : undefined}
                    className={`relative flex h-10 shrink-0 items-center gap-3 rounded-[10px] px-3 text-[15px] ${
                      open ? 'justify-start' : 'justify-center'
                    } ${on ? 'bg-c-chip font-bold' : ''}`}
                  >
                    <span
                      className="absolute top-2.5 bottom-2.5 left-0 w-0.75 rounded-sm"
                      style={{ background: on ? '#1B1A17' : 'transparent' }}
                    />
                    <span className={on ? 'text-c-ink' : 'text-c-mute'}>
                      <Icon name={p.id} />
                    </span>
                    {open && <span className="flex-1 truncate">{p.label}</span>}
                  </a>
                )
              })}
            </nav>
            {!narrow && (
              <button
                onClick={toggleSide}
                className="mt-2.5 mb-2.5 h-10 shrink-0 rounded-[10px] bg-c-chip text-[13px] font-bold whitespace-nowrap"
              >
                {side ? '« Свернуть' : '»'}
              </button>
            )}
            <UserBlock compact={!open} name={staff?.name} role={staff ? ROLE_LABEL[staff.role] : ''} onOut={signOutStaff} />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-18 shrink-0 items-center gap-3.5 border-b border-c-line bg-c-bg px-4 md:px-6">
            <div className="flex min-w-0 shrink overflow-x-auto rounded-xl bg-c-tabs p-0.75" role="tablist" aria-label="Рабочее место">
              {spaces
                .filter(s => s.ok)
                .map(s => {
                  const on = route.ws === s.ws
                  return (
                    <a
                      key={s.ws}
                      role="tab"
                      aria-selected={on}
                      href={href({ ws: s.ws })}
                      className={`flex h-9 items-center rounded-[10px] px-3.5 text-[14px] whitespace-nowrap ${
                        on ? 'bg-c-card font-bold' : ''
                      }`}
                      style={on ? { boxShadow: '0 1px 2px rgba(27,26,23,.12)' } : undefined}
                    >
                      {s.label}
                    </a>
                  )
                })}
            </div>
            <div className="min-w-0 flex-1" />
            {shiftLabel && (
              <span className="hidden h-9 shrink-0 items-center gap-2 rounded-full border border-c-line bg-c-card px-3.5 text-[13px] whitespace-nowrap md:flex">
                <span className={`size-2 rounded-full ${hallLive && shiftOpen ? 'bg-c-ok' : hallLive ? 'bg-c-off' : 'bg-c-warn'}`} />
                {hallLive ? shiftLabel : 'Нет связи…'}
              </span>
            )}
            {admin && may('log') && shiftOpen && route.page !== 'close' && (
              <button
                onClick={() => go({ ws: 'admin', page: 'close' })}
                className="h-10 shrink-0 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold whitespace-nowrap text-white"
              >
                {narrow ? 'Закрыть' : 'Закрыть смену'}
              </button>
            )}
            {!admin && (
              <UserChip
                name={staff?.name}
                role={staff ? ROLE_LABEL[staff.role] : ''}
                tips={staff?.role === 'waiter' && shiftOpen ? (hall?.shift?.tipsByStaff?.[staff.id] ?? 0) : null}
                onOut={signOutStaff}
              />
            )}
          </header>

          {admin && shiftOpen && startedAt && route.page !== 'close' && remindDue(startedAt, now) && (
            <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-c-warn-line bg-c-warn-bg px-4 py-2.5 text-[14px] text-c-warn-fg md:px-6">
              <span className="flex-1">Пора закрывать смену — в настройках напоминание на {SETTINGS.shift.remindAt}.</span>
              <button onClick={() => go({ ws: 'admin', page: 'close' })} className="h-8 rounded-lg bg-c-ink px-3 text-[13px] font-bold text-white">
                Закрыть смену
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-10 md:px-6">
            <h1 className="mb-4.5 text-[22px] font-bold md:text-[24px]">{title}</h1>
            {children}
          </div>
        </main>
      </div>
      {ui.toast && <CToast msg={ui.toast} />}
    </Ctx.Provider>
  )
}

/**
 * Напоминание «пора закрывать смену»: наступило время из настроек, а смена
 * открыта с прошлого дня или с вечера. Днём, в обед, оно не всплывает.
 */
function remindDue(startedAt: number, now: number): boolean {
  const at = SETTINGS.shift.remindAt
  if (!at) return false
  const [h, m] = at.split(':').map(Number)
  const due = new Date(now)
  due.setHours(h, m, 0, 0)
  if (due.getTime() > now) due.setDate(due.getDate() - 1)
  // Смена открыта раньше последнего наступившего «часа закрытия», и с тех пор прошло меньше полусуток
  return startedAt < due.getTime() && now - due.getTime() < 12 * 60 * 60 * 1000
}

const NARROW = '(max-width: 1023px)'

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

function UserBlock({ compact, name, role, onOut }: { compact: boolean; name?: string; role: string; onOut: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 overflow-hidden border-t border-c-line px-1 py-3 whitespace-nowrap">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-c-line2 text-[15px] font-bold">
        {(name ?? '?').slice(0, 1)}
      </span>
      {!compact && (
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold">{name}</div>
            <div className="text-[13px] text-c-mute">{role.toLowerCase()}</div>
          </div>
          <button onClick={onOut} className="h-8 rounded-lg px-2 text-[13px] text-c-mute underline">
            выйти
          </button>
        </>
      )}
    </div>
  )
}

function UserChip({ name, role, tips, onOut }: { name?: string; role: string; tips: number | null; onOut: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {tips !== null && (
        <span className="c-num flex h-9 items-center rounded-full bg-c-ok-bg px-3 text-[13px] font-bold whitespace-nowrap text-c-ok-fg">
          чаевые {fmt(tips)}
        </span>
      )}
      <div className="hidden text-right md:block">
        <div className="text-[14px] font-bold">{name}</div>
        <div className="text-[12px] text-c-mute">{role.toLowerCase()}</div>
      </div>
      <button onClick={onOut} className="h-10 rounded-xl border border-c-line bg-c-card px-3.5 text-[14px]">
        Выйти
      </button>
    </div>
  )
}
