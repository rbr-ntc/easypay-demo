// Формы состояния стола и ответов сервера. Пока состояние живёт в памяти,
// эти же типы описывают строки будущих таблиц: guests, order_lines, payments, tips, calls.
import type { RoleName } from '@easypay/domain/roles'

export interface Persona {
  id: string
  name: string
  animal: string
  joinedAt: number
  /** Хеш личного токена гостя: сам токен отдаётся один раз при join. */
  secretHash: string
  /** Заявленные аллергии гостя: система обязана предупреждать сама. */
  allergies?: string[]
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
  /** Кто взял в работу, подал и отменил — журнал обязан отвечать на «кто». */
  startedBy?: string | null
  servedBy?: string | null
  cancelledBy?: string | null
  /** Повар подтвердил, что снял блюдо с плиты. */
  cancelAck?: boolean
  /** Живой текст гостя к блюду: «без орехов, аллергия». Доезжает до повара. */
  comment?: string | null
}

export interface ReceiptLine {
  name: string
  qty: number
  price: number
  shared: boolean
  share: number | null
}

export interface Payment {
  /** Номер чека, который гость может назвать в споре. */
  receiptNo?: string
  /** За что именно списаны деньги. */
  lines?: ReceiptLine[]
  id: string
  personaId: string
  amount: number
  scope: string
  at: number
}

export interface Tip {
  id: string
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
  /** Текст гостя к вызову: «аллергия на орехи». */
  note?: string | null
}

export interface TableSession {
  /** Момент, когда стол реально убрали: свободен по факту, а не по таймеру. */
  cleanedAt?: number | null
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
  /** Долг, с которым стол закрыли — измеряется до отмены неподанного. */
  closedWithDebt?: number
  /** Переплата, зафиксированная при закрытии стола. */
  overpaid?: number
  /** Сброс стола: хранилище освободит стол после того, как зафиксирует чек. */
  resetRequested?: boolean
  /** Привязка к строкам БД. В памяти не используется. */
  db?: { tableUuid: string; sessionUuid: string | null }
}

/** Кто действует: сотрудник со своей сессией или мастер-токен менеджера. */
export interface Actor {
  id: string
  name: string
  role: RoleName
  tables?: string[]
  /** Идентификатор сессии сотрудника — попадает в журнал вместе с действием. */
  sessionId?: string | null
  device?: string | null
}

export interface AuditEntry {
  at: number
  staffId: string | null
  name: string
  role: string | null
  action: string
  tableId: string | null
  detail: string | null
  /** Сумма, если действие про деньги: списание, долг, переплата. */
  amount?: number | null
  /** Сессия сотрудника: журнал должен различать двух людей под одним PIN. */
  sessionId?: string | null
}

/** Результат мутации: статус и тело ответа. */
export interface MutationResult {
  status: number
  body: Record<string, unknown>
}

export interface Shift {
  tables: number
  /** Выручка закрытых столов — с ней сверяется реестр чеков. */
  closedRevenue: number
  tablesWithRevenue: number
  revenue: number
  debt: number
  /** Стоимость снятого с кухни: еда не отдана, это не долг гостя. */
  writtenOff?: number
  /** Открытые столы, где уже были платежи. */
  openTablesWithRevenue?: number
  overpaid: number
  guests: number
  guestsSeen: number
  startedAt: number
  tipsByStaff: Record<string, number>
}
