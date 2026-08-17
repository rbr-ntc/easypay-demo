import { useState } from 'react'
import { apiShiftLog } from '../api'
import type { LogEntry } from '../api'
import { ROLE_LABEL } from '../../shared/roles.js'
import type { RoleName } from '../../shared/roles.js'

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
    <div className="ep-h-zone">
      <div className="ep-h-zone-title">
        <span className="ep-h-zone-name">Журнал смены</span>
        <button className="ep-w-btn ep-w-btn--quiet" onClick={() => void toggle()}>
          {open ? 'Свернуть' : 'Показать'}
        </button>
      </div>

      {open && (
        <div className="ep-h-log">
          {busy && <div className="ep-h-empty">Загружаем…</div>}
          {!busy && entries?.length === 0 && <div className="ep-h-empty">Пока пусто</div>}
          {entries?.map((e, i) => (
            <div className="ep-h-log-row" key={`${e.at}-${i}`}>
              <span className="ep-h-log-time">{time(e.at)}</span>
              <span className="ep-h-log-who">
                {e.name}
                {e.role ? ` · ${ROLE_LABEL[e.role as RoleName] ?? e.role}` : ''}
              </span>
              <span className="ep-h-log-what">
                {e.action}
                {e.tableId ? ` · стол №${e.tableId}` : ''}
                {e.detail ? ` · ${e.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
