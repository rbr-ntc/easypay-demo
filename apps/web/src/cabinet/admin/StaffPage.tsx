import { useState } from 'react'
import { ROLE_LABEL, type RoleName } from '@easypay/domain/roles'
import { fmt } from '../../format'
import { useStore } from '../../store'
import { staffPost, type StaffResult } from '../staffApi'
import { Chip, Confirm, Empty } from '../ui'
import { useLoad } from './adminApi'
import { Loading } from './parts'
import { getStaffToken } from '../../staff'

/**
 * Персонал: кто работает, кто сейчас в смене, какие столы за кем. PIN
 * придумывает сервер и показывает один раз — менеджер передаёт его человеку.
 */

interface Person {
  id: string
  name: string
  role: RoleName
  tables: string[]
  phone: string | null
  active: boolean
  devices: string[]
  shiftTips: number
}

interface StaffPayload {
  staff: Person[]
  tables: string[]
}

async function fetchStaff(): Promise<StaffPayload | null> {
  try {
    const res = await fetch('/api/staff/list', { headers: { 'x-staff-token': getStaffToken() } })
    return res.ok ? ((await res.json()) as StaffPayload) : null
  } catch {
    return null
  }
}

const ERRORS: Record<string, string> = {
  'cannot fire yourself': 'Себя уволить нельзя',
  'last manager': 'Это последний менеджер — сначала назначьте другого',
  'cannot demote yourself': 'Свою роль менеджера снять нельзя',
  'name required': 'Как зовут сотрудника?',
  'staff inactive': 'Сотрудник уволен — сначала верните его'
}
const errorOf = (r: StaffResult) => ERRORS[r.error ?? ''] ?? 'Не получилось — попробуйте ещё раз'

const ROLES: RoleName[] = ['waiter', 'cook', 'manager']

type Ask = { kind: 'fire' | 'pin'; person: Person } | null

export function StaffPage() {
  const { toast } = useStore()
  const q = useLoad(fetchStaff, [], 20_000)
  const [tab, setTab] = useState<'active' | 'fired'>('active')
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [shown, setShown] = useState<{ name: string; pin: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (!q.data) return <Loading failed={q.failed} />
  const people = q.data.staff.filter(p => (tab === 'active' ? p.active : !p.active))
  const counts = { active: q.data.staff.filter(p => p.active).length, fired: q.data.staff.filter(p => !p.active).length }

  const run = async (fn: () => Promise<StaffResult>, done: (r: StaffResult) => void) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    setAsk(null)
    if (!r.ok) return toast(errorOf(r))
    done(r)
    void q.reload()
  }
  const newPin = (p: Person) =>
    run(() => staffPost('/api/staff/pin', { id: p.id }), r => setShown({ name: p.name, pin: String(r.body.pin) }))
  const setActive = (p: Person, active: boolean) =>
    run(
      () => staffPost('/api/staff/active', { id: p.id, active }),
      r => {
        if (r.body.pin) setShown({ name: p.name, pin: String(r.body.pin) })
        else toast(active ? `${p.name} снова в команде` : `${p.name} уволен(а) — вход закрыт`)
      }
    )

  return (
    <div className="flex max-w-[1100px] flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={tab === 'active'} onClick={() => setTab('active')}>
          Работают · {counts.active}
        </Chip>
        <Chip on={tab === 'fired'} onClick={() => setTab('fired')}>
          Уволены · {counts.fired}
        </Chip>
        <span className="flex-1" />
        <button onClick={() => setEditing('new')} className="h-9 rounded-xl bg-c-ink px-3.5 text-[13px] font-bold text-white">
          + Сотрудник
        </button>
      </div>

      {people.length === 0 ? (
        <Empty>{tab === 'active' ? 'Никого нет — добавьте первого сотрудника' : 'Уволенных нет'}</Empty>
      ) : (
        <div className="c-card overflow-x-auto">
          <table className="w-full min-w-[820px] text-[14px]">
            <thead>
              <tr className="border-b border-c-line text-left text-[12px] text-c-mute">
                <th className="px-4 py-3 font-bold">Сотрудник</th>
                <th className="px-3 py-3 font-bold">Роль</th>
                <th className="px-3 py-3 font-bold">Сейчас</th>
                <th className="px-3 py-3 font-bold">Столы</th>
                <th className="px-3 py-3 text-right font-bold">Чаевые за смену</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {people.map(p => (
                <tr key={p.id} className={`border-b border-c-line2 last:border-0 ${p.active ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3">
                    <button onClick={() => setEditing(p)} className="flex items-center gap-2.5 text-left">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-c-line2 font-bold">{p.name.slice(0, 1)}</span>
                      <span>
                        <span className="block font-bold">{p.name}</span>
                        <span className="block text-[12px] text-c-mute">{p.phone ?? 'телефон не указан'}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-3">{ROLE_LABEL[p.role] ?? p.role}</td>
                  <td className="px-3 py-3 text-[13px]">
                    <span className="flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${p.devices.length ? 'bg-c-ok' : 'bg-c-off'}`} />
                      {p.devices.length ? `в смене${p.devices.length > 1 ? ` · ${p.devices.length} устр.` : ''}` : 'не в смене'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-c-mute">{p.role === 'waiter' ? p.tables.join(', ') || '—' : p.role === 'manager' ? 'все' : '—'}</td>
                  <td className="c-num px-3 py-3 text-right">{p.shiftTips ? fmt(p.shiftTips) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className="flex justify-end gap-1.5">
                      {p.active && (
                        <button onClick={() => setAsk({ kind: 'pin', person: p })} className="h-8 rounded-lg border border-c-line px-2.5 text-[13px] whitespace-nowrap">
                          Новый PIN
                        </button>
                      )}
                      <button
                        onClick={() => (p.active ? setAsk({ kind: 'fire', person: p }) : void setActive(p, true))}
                        className={`h-8 rounded-lg border border-c-line px-2.5 text-[13px] whitespace-nowrap ${p.active ? 'text-c-bad-ink' : ''}`}
                      >
                        {p.active ? 'Уволить' : 'Вернуть'}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PersonEditor
          person={editing === 'new' ? null : editing}
          tables={q.data.tables}
          onClose={() => setEditing(null)}
          onSaved={(pin, name) => {
            setEditing(null)
            if (pin) setShown({ name, pin })
            else toast('Сохранено')
            void q.reload()
          }}
        />
      )}
      {ask && (
        <Confirm
          title={ask.kind === 'fire' ? `Уволить ${ask.person.name}?` : `Новый PIN для ${ask.person.name}?`}
          body={
            ask.kind === 'fire'
              ? 'Вход закроется сразу, открытые сессии погаснут. Журнал, чеки и чаевые останутся. Вернуть можно в любой момент — с новым PIN.'
              : 'Старый PIN перестанет работать сразу. Новый покажем один раз — передайте его сотруднику.'
          }
          ok={ask.kind === 'fire' ? 'Уволить' : 'Выдать PIN'}
          danger={ask.kind === 'fire'}
          busy={busy}
          onOk={() => void (ask.kind === 'fire' ? setActive(ask.person, false) : newPin(ask.person))}
          onCancel={() => setAsk(null)}
        />
      )}
      {shown && <PinCard name={shown.name} pin={shown.pin} onClose={() => setShown(null)} />}
    </div>
  )
}

function PinCard({ name, pin, onClose }: { name: string; pin: string; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30" style={{ background: 'rgba(27,26,23,.35)' }} />
      <div role="alertdialog" aria-modal="true" aria-label={`PIN для ${name}`} className="c-fade fixed top-1/2 left-1/2 z-31 w-[min(400px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[20px] bg-c-card p-6 text-center">
        <div className="text-[15px] text-c-mute">PIN для {name}</div>
        <div className="c-num mt-3 text-[48px] font-bold tracking-[0.3em]">{pin}</div>
        <p className="mt-3 text-[13px] text-c-mute">Покажем только сейчас — в базе хранится не сам PIN, а его отпечаток. Передайте сотруднику лично.</p>
        <button onClick={onClose} className="mt-5 h-11 w-full rounded-xl bg-c-ink text-[15px] font-bold text-white">
          Передал(а)
        </button>
      </div>
    </>
  )
}

function PersonEditor(props: { person: Person | null; tables: string[]; onClose: () => void; onSaved: (pin: string | null, name: string) => void }) {
  const { toast } = useStore()
  const p = props.person
  const [name, setName] = useState(p?.name ?? '')
  const [role, setRole] = useState<RoleName>(p?.role ?? 'waiter')
  const [phone, setPhone] = useState(p?.phone ?? '')
  const [tables, setTables] = useState<string[]>(p?.tables ?? [])
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return toast('Как зовут сотрудника?')
    setBusy(true)
    const r = await staffPost('/api/staff/save', { id: p?.id, name, role, phone, tables })
    setBusy(false)
    if (!r.ok) return toast(errorOf(r))
    props.onSaved(r.body.pin ? String(r.body.pin) : null, name.trim())
  }
  const flip = (t: string) => setTables(tables.includes(t) ? tables.filter(x => x !== t) : [...tables, t])

  return (
    <>
      <div onClick={props.onClose} className="fixed inset-0 z-30" style={{ background: 'rgba(27,26,23,.3)' }} />
      <aside role="dialog" aria-modal="true" aria-label={p ? p.name : 'Новый сотрудник'} className="c-fade fixed top-0 right-0 bottom-0 z-31 flex w-[min(460px,100vw)] flex-col bg-c-card" style={{ boxShadow: '-30px 0 60px -30px rgba(0,0,0,.35)' }}>
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-c-line2 px-5">
          <span className="flex-1 text-[18px] font-bold">{p ? p.name : 'Новый сотрудник'}</span>
          <button onClick={props.onClose} aria-label="Закрыть" className="size-9 rounded-lg text-[18px] text-c-mute hover:bg-c-chip">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <label className="block">
            <span className="text-[13px] font-bold">Имя</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={40} className={INPUT} />
          </label>
          <label className="mt-4 block">
            <span className="text-[13px] font-bold">Телефон</span>
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="+7 900 000-00-00" className={INPUT} />
          </label>
          <div className="mt-4">
            <div className="text-[13px] font-bold">Роль</div>
            <div className="mt-1.5 flex gap-1.5">
              {ROLES.map(r => (
                <Chip key={r} on={role === r} onClick={() => setRole(r)}>
                  {ROLE_LABEL[r]}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-c-mute">
              {role === 'cook' ? 'Видит кухню и бар, ведёт стоп-лист.' : role === 'waiter' ? 'Зал, свои столы, кухня; принимает наличные.' : 'Всё, включая кабинет, закрытие смены и персонал.'}
            </p>
          </div>
          {role === 'waiter' && (
            <div className="mt-4">
              <div className="text-[13px] font-bold">Закреплённые столы</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {props.tables.map(t => (
                  <button key={t} onClick={() => flip(t)} aria-pressed={tables.includes(t)} className={`h-9 min-w-10 rounded-lg px-2.5 text-[14px] ${tables.includes(t) ? 'bg-c-ink font-bold text-white' : 'border border-c-line'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!p && <p className="mt-5 rounded-xl bg-c-chip p-3 text-[13px] text-c-soft">PIN придумаем сами и покажем один раз после сохранения.</p>}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-c-line2 p-4">
          <span className="flex-1" />
          <button onClick={props.onClose} className="h-11 rounded-xl border border-c-line bg-c-card px-4 text-[15px]">
            Отмена
          </button>
          <button onClick={() => void save()} disabled={busy} className="h-11 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold text-white disabled:opacity-50">
            {busy ? 'Секунду…' : p ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </aside>
    </>
  )
}

const INPUT = 'mt-1.5 h-10 w-full rounded-xl border border-c-line bg-c-bg px-3 text-[15px] outline-none focus:border-c-ink'
