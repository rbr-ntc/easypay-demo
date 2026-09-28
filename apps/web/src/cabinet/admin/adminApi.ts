import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShiftReport } from '@easypay/domain/shift'
import type { QualityReport } from '@easypay/domain/quality'
import { getStaffToken } from '../../staff'
import { staffError, staffPost, type StaffResult } from '../staffApi'

/** Клиент кабинета: смена, решения, история, реестр. Всё — с токеном персонала. */

export interface ShiftPublic {
  id: string
  openedAt: number
  closedAt: number | null
  openedBy: string | null
  closedBy: string | null
}

export interface Blocker {
  tableId: string
  sessionId: string | null
  guests: number
  openedAt: number | null
  remaining: number
  kitchen: string[]
  cash: number
  calls: number
}

export interface DebtOfShift {
  sessionId: string
  tableId: string
  amount: number
  settled: number
  left: number
  closedAt: number | null
  waiter: string | null
  guests: number
}

export interface ShiftState {
  shift: ShiftPublic | null
  report: ShiftReport
  blockers: Blocker[]
  debts: DebtOfShift[]
  refunds: { tableId: string; sessionId: string; amount: number; closedAt: number | null }[]
  cash: { system: number; collected: number }
}

export interface Decision {
  id: string
  kind: 'debt' | 'refund' | 'long'
  sessionId?: string
  tableId?: string
  title: string
  meta?: string
  text?: string
  amount: number
  at: number | null
}

export interface ShiftSummary {
  revenue: number
  checks: number
  guests: number
  avgCheck: number
  tips: number
  debt: number
  diff: number
}

export interface ShiftRow extends ShiftPublic {
  summary: ShiftSummary
  live: boolean
}

export interface ZReport {
  report: ShiftReport
  carried: { tableId: string; remaining: number; guests: number }[]
  settlements: { tableId: string; kind: string; amount: number; method: string | null; reason: string | null }[]
  cash: { system: number; counted: number; diff: number; note: string | null } | null
}

export interface CheckRow {
  tableId: string
  sessionId: string
  openedAt: number
  closedAt: number | null
  guests: number
  waiter: string | null
  lines: { name: string; qty: number; price: number; amount: number; guest: string | null; shared?: boolean; cancelled: boolean; cancelReason: string | null; options: Record<string, string> }[]
  total: number
  paid: number
  debt: number
  overpaid: number
  tips: number
  cancelledTotal: number
  payments?: { amount: number; method: string; at: number; guest: string | null; takenBy: string | null }[]
  refunded?: number
  firstSentAt?: number | null
  lastServedAt?: number | null
  settled: number
  /** Оценки визита с экрана «Спасибо»: одна на гостя. */
  ratings?: { rating: 'good' | 'ok' | 'bad'; note: string | null; guest: string | null }[]
}

export interface LogEntry {
  at: number
  name: string
  role: string | null
  action: string
  tableId: string | null
  detail: string | null
  amount?: number | null
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: { 'x-staff-token': getStaffToken() } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch (err) {
    console.error('кабинет: не удалось загрузить', path, err)
    return null
  }
}

export const fetchShift = () => getJson<ShiftState>('/api/shift')
export const fetchDecisions = () => getJson<{ open: Decision[]; done: Decision[] }>('/api/decisions')
export const fetchShifts = () => getJson<{ current: ShiftRow | null; history: ShiftRow[] }>('/api/shifts')
export const fetchShiftCard = (id: string) =>
  getJson<{ shift: ShiftPublic; z: ZReport | null; live: boolean }>(`/api/shifts/${encodeURIComponent(id)}`)
export const fetchChecks = (shift?: string | null) =>
  getJson<{ shiftId: string | null; checks: CheckRow[] }>(`/api/checks${shift ? `?shift=${encodeURIComponent(shift)}` : ''}`)
export const fetchLog = (all = false) => getJson<{ entries: LogEntry[]; since: number | null }>(`/api/log${all ? '?shift=all' : ''}`)

export const openShift = () => staffPost('/api/shift/open')
export const closeShift = (cashCounted: number, note: string) => staffPost('/api/shift/close', { cashCounted, note })
export const settleDebt = (sessionId: string, kind: 'collected' | 'written_off', opts: { method?: string; reason?: string }) =>
  staffPost('/api/decisions/settle', { sessionId, kind, ...opts })
export const noteDecision = (key: string, text: string) => staffPost('/api/decisions/note', { key, text })

export type QualityPeriod = 'shift' | 'today' | '7d' | '30d'
export const fetchQuality = (period: QualityPeriod) =>
  getJson<{ period: QualityPeriod; from: number; to: number; truncated: boolean; report: QualityReport }>(`/api/quality?period=${period}`)
export const resolveRemark = (sessionId: string, guestId: string, resolution: string) =>
  staffPost('/api/quality/resolve', { sessionId, guestId, resolution })

/**
 * Данные кабинета: загрузка, обновление после действия и тихий опрос.
 * Живых потоков у отчётов нет — раз в 15 секунд достаточно: это не зал.
 */
export function useLoad<T>(load: () => Promise<T | null>, deps: unknown[] = [], pollMs = 15_000) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)
  const reload = useCallback(async () => {
    const d = await load()
    if (!alive.current) return
    if (d === null) setFailed(true)
    else {
      setFailed(false)
      setData(d)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    alive.current = true
    setData(null)
    void reload()
    const t = pollMs > 0 ? setInterval(() => void reload(), pollMs) : undefined
    return () => {
      alive.current = false
      if (t) clearInterval(t)
    }
  }, [reload, pollMs])
  return { data, failed, reload }
}

export const errorText = (r: StaffResult): string => {
  const map: Record<string, string> = {
    'debts unresolved': 'Сначала решите каждый долг смены',
    'note required': 'Расхождение кассы — только с комментарием',
    'cash count required': 'Введите, сколько наличных в кассе',
    'no open shift': 'Смена уже закрыта',
    'already settled': 'Этот долг уже решён',
    'debt not found': 'Долг не найден — обновите страницу',
    'method required': 'Выберите способ взыскания',
    'stale session': 'За столом уже новые гости — верните переплату на кассе и отметьте в журнале',
    'nothing to refund': 'Переплату уже вернули',
    'rating not found': 'Отзыв не найден — обновите страницу',
    'resolution required': 'Напишите, что сделали — это прочтёт владелец'
  }
  return map[r.error ?? ''] ?? staffError(r)
}
