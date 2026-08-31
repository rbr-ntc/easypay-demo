import { useState } from 'react'
import { apiShiftLog } from '../api'
import type { LogEntry } from '../api'
import { ROLE_LABEL } from '@easypay/domain/roles'
import { fmt } from '../format'
import type { RoleName } from '@easypay/domain/roles'

function time(at: number): string {
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Журнал смены: кто что сделал. Виден только менеджеру. */
export function ShiftLog() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setBusy(true)
    const data = await apiShiftLog()
    setEntries(data?.entries ?? [])
    setBusy(false)
  }

  return (
    <div className="rounded-[20px] p-4.5" style={{ background: '#0C2C21' }}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="ep-brow" style={{ color: '#9FB5A8' }}>Журнал смены</span>
        <button className="ml-auto h-9 rounded-field px-3.5 text-[13px] font-bold" style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }} onClick={() => void toggle()}>
          {open ? 'Свернуть' : 'Показать'}
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto">
          {busy && (
            <div className="flex items-center gap-2 py-4 text-base-content/60">
              <span className="loading loading-spinner loading-sm" /> Загружаем…
            </div>
          )}
          {!busy && entries?.length === 0 && <div className="py-4 text-base-content/60">Пока пусто</div>}
          {!busy && !!entries?.length && (
            <table className="table-zebra table table-sm">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Кто</th>
                  <th>Что</th>
                  <th className="text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td className="font-mono tabular-nums whitespace-nowrap">{time(e.at)}</td>
                    <td className="whitespace-nowrap">
                      {e.name}
                      {e.role ? (
                        <span className="text-base-content/60"> · {ROLE_LABEL[e.role as RoleName] ?? e.role}</span>
                      ) : null}
                    </td>
                    <td>
                      {e.action}
                      {e.tableId ? ` · стол №${e.tableId}` : ''}
                      {e.detail ? ` · ${e.detail}` : ''}
                    </td>
                    {/* Деньги в журнале называются суммой: без неё запись
                        «принял наличные от Олега» ничего не доказывает */}
                    <td className="text-right font-semibold tabular-nums whitespace-nowrap">
                      {typeof e.amount === 'number' && e.amount > 0 ? fmt(e.amount) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
