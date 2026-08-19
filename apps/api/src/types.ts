// Формы состояния стола и ответов сервера. Пока состояние живёт в памяти,
// эти же типы описывают строки будущих таблиц: guests, order_lines, payments, tips, calls.
import type { RoleName } from '@easypay/domain/roles'

export interface Persona {
  id: string
  name: string
  animal: string
  joinedAt: number
  /** Личный секрет гостя: наружу не отдаётся, по нему проверяются действия. */
  secret: string
}

export interface Line {
  uid: number
  dishId: string
  qty: number
  price: number
  options: Record<string, string>
  shared: boolean
  sharedWith: string[]
  personaId: string
  sent: boolean
  served: boolean
  cancelled: boolean
  sentAt: number | null
  startedAt: number | null
  servedAt: number | null
  cancelledAt?: number | null
  cancelReason?: string | null
}

export interface Payment {
  personaId: string
  amount: number
  scope: string
  at: number
}

export interface Tip {
  personaId: string
  amount: number
  at: number
  waiterId: string | null
}

export interface Call {
  id: string
  at: number
  personaId: string
  reason: string
}

export interface TableSession {
  sessionId: string | null
  status: 'open' | 'closed'
  openedAt: number | null
  closedAt: number | null
  personas: Persona[]
  lines: Line[]
  payments: Payment[]
  tips: Tip[]
  calls: Call[]
  seq: number
  /** Переплата, зафиксированная при закрытии стола. */
  overpaid?: number
}

/** Кто действует: сотрудник со своей сессией или мастер-токен менеджера. */
export interface Actor {
  id: string
  name: string
  role: RoleName
  tables?: string[]
}

export interface AuditEntry {
  at: number
  staffId: string | null
  name: string
  role: string | null
  action: string
  tableId: string | null
  detail: string | null
}

/** Результат мутации: статус и тело ответа. */
export interface MutationResult {
  status: number
  body: Record<string, unknown>
}

export interface Shift {
  tables: number
  tablesWithRevenue: number
  revenue: number
  debt: number
  overpaid: number
  guests: number
  guestsSeen: number
  startedAt: number
  tipsByStaff: Record<string, number>
}
