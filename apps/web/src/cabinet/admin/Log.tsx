import { useState } from 'react'
import { ROLE_LABEL } from '@easypay/domain/roles'
import { fmt } from '../../format'
import { Chip, Empty } from '../ui'
import { fetchLog, useLoad, type LogEntry } from './adminApi'
import { dayLabel, hm, Loading } from './parts'

/** Журнал смены: кто, что, когда и на какую сумму. Только чтение. */

type Kind = 'money' | 'close' | 'menu' | 'kitchen' | 'staff' | 'guest'

const KINDS: { id: Kind; label: string; color: string; re: RegExp }[] = [
  { id: 'close', label: 'Закрытие', color: '#9E2E17', re: /закрыл|закрыт|долг|решение|смена/ },
  { id: 'money', label: 'Деньги', color: '#22613D', re: /оплат|налич|чаев|переплат|вернул|возврат/ },
  { id: 'menu', label: 'Меню', color: '#7A5306', re: /стоп|меню|закончилось/ },
  { id: 'kitchen', label: 'Кухня', color: '#2D5A8A', re: /кухн|работу|готово|подал|плит|отмен/ },
  { id: 'staff', label: 'Персонал', color: '#4A463F', re: /вошёл|вышел|вызов|убрал стол/ }
]

const kindOf = (e: LogEntry): Kind => KINDS.find(k => k.re.test(e.action))?.id ?? 'guest'
const TABS: { id: 'all' | Kind; label: string }[] = [{ id: 'all', label: 'Всё' }, ...KINDS.map(k => ({ id: k.id, label: k.label }))]


/**
 * Действие — существительным, а не глаголом: «закрыл стол» у Оли и Ирины звучало
 * с чужим родом, а род по имени не угадать (смена №7, Ж2). Незнакомое — как есть.
 */
const ACTION_NOUN: Record<string, string> = {
  'вошёл в смену': 'вход в смену',
  'вышел из смены': 'выход из смены',
  'сел за стол': 'посадка за стол',
  'вышел из-за стола': 'уход из-за стола',
  'добавил': 'добавление в корзину',
  'добавил на стол': 'блюдо добавлено персоналом',
  'убрал': 'убрано из корзины',
  'отправил на кухню': 'отправка на кухню',
  'взял в работу': 'в работе на кухне',
  'подал': 'подача',
  'закрыл': 'закрытие стола',
  'закрыл стол': 'закрытие стола',
  'сбросил': 'сброс стола',
  'убрал стол': 'уборка стола',
  'убрал гостя': 'гость убран со стола',
  'позвал официанта': 'вызов официанта',
  'позвал ещё раз': 'повторный вызов',
  'принял вызов': 'вызов принят',
  'принял наличные': 'наличные приняты',
  'вернул переплату': 'возврат переплаты',
  'указал аллергии': 'аллергии гостя',
  'оценил визит': 'оценка визита',
  'разобрал замечание': 'замечание разобрано',
  'приставил стул': 'приставлен стул',
  'снял отменённое с плиты': 'отмена подтверждена кухней',
  'передумал платить наличными': 'отказ от наличных',
  'отменил оплату картой': 'отмена оплаты картой',
  'добавил сотрудника': 'новый сотрудник',
  'изменил сотрудника': 'сотрудник изменён',
  'уволил сотрудника': 'сотрудник уволен',
  'вернул сотрудника': 'сотрудник возвращён',
  'сменил PIN': 'смена PIN',
  'изменил настройки': 'настройки изменены',
  'согласился на аллерген': 'согласие на аллерген'
}
const actionText = (a: string) => ACTION_NOUN[a] ?? a

export function Log() {
  const [whole, setWhole] = useState(false)
  const q = useLoad(() => fetchLog(whole), [whole])
  const [tab, setTab] = useState<'all' | Kind>('all')
  const [table, setTable] = useState('')
  if (!q.data) return <Loading failed={q.failed} />
  const t = table.trim()
  const rows = q.data.entries.filter(e => (tab === 'all' || kindOf(e) === tab) && (!t || e.tableId === t))

  return (
    <div className="flex max-w-[1000px] flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <Chip key={t.id} on={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </Chip>
        ))}
        <span className="flex-1" />
        <input
          value={table}
          onChange={e => setTable(e.target.value)}
          placeholder="Стол"
          aria-label="Фильтр по столу"
          className="h-9 w-20 rounded-full border border-c-line bg-c-card px-3 text-[13px] outline-none focus:border-c-ink"
        />
        <Chip on={!whole} onClick={() => setWhole(false)}>
          {q.data.since ? `Смена с ${hm(q.data.since)}` : 'Эта смена'}
        </Chip>
        <Chip on={whole} onClick={() => setWhole(true)}>
          Всё
        </Chip>
      </div>
      <div className="-mt-1.5 text-[12px] text-c-mute">Журнал нельзя изменить или удалить · записей: {rows.length}</div>
      {rows.length === 0 ? (
        <Empty>Записей нет</Empty>
      ) : (
        <div className="c-card overflow-hidden">
          {rows.map((e, i) => {
            const k = KINDS.find(x => x.id === kindOf(e))
            const prev = rows[i - 1]
            const newDay = !prev || new Date(prev.at).toDateString() !== new Date(e.at).toDateString()
            return (
              <div key={`${e.at}-${i}`}>
                {newDay && <div className="bg-c-chip px-4 py-1.5 text-[12px] font-bold text-c-mute">{dayLabel(e.at)}</div>}
                <div className="grid grid-cols-[52px_84px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-c-line2 px-4 py-3 text-[14px]">
                  <span className="c-num text-c-mute">{hm(e.at)}</span>
                  <span className="text-[12px] font-bold" style={{ color: k?.color ?? '#6B665E' }}>
                    {k?.label ?? 'Гость'}
                  </span>
                  <span className="min-w-0">
                    <span className="block">
                      {e.tableId && <b>Стол {e.tableId} · </b>}
                      {actionText(e.action)}
                      {e.detail && <span className="text-c-soft"> · {e.detail}</span>}
                    </span>
                    <span className="block text-[12px] text-c-mute">
                      {e.name}
                      {e.role ? ` · ${(ROLE_LABEL[e.role as keyof typeof ROLE_LABEL] ?? e.role).toLowerCase()}` : ''}
                    </span>
                  </span>
                  <span className="c-num font-bold">{e.amount ? fmt(e.amount) : ''}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
