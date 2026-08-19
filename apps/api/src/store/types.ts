import type { AuditEntry, MutationResult, Shift, TableSession } from '../types.ts'

/**
 * Хранилище состояния зала. Две реализации: память (быстрые тесты и демо без БД)
 * и Postgres (продукт). Интерфейс намеренно узкий — доменные правила остаются
 * чистыми функциями над объектом сессии стола и про хранилище ничего не знают.
 */
export interface Store {
  readonly kind: 'memory' | 'postgres'

  /** Снимок стола для чтения. Для незанятого стола — пустая закрытая сессия. */
  read(tableId: string): Promise<TableSession>

  /**
   * Изменение стола под блокировкой: загрузили → применили правило → сохранили.
   * Всё внутри одной транзакции, поэтому двое не спишут одну и ту же сумму.
   */
  withTable(tableId: string, apply: (session: TableSession) => MutationResult): Promise<MutationResult>

  /** Все столы, интересные витринам зала и кухни: открытые и недавно закрытые. */
  activeSessions(): Promise<Map<string, TableSession>>

  /** Смена считается из первички, отдельных счётчиков нет. */
  shift(): Promise<Shift>

  audit(entry: AuditEntry): Promise<void>
  auditEntries(limit: number): Promise<AuditEntry[]>

  /** Реестр чеков смены: закрытые сессии со всем составом. */
  shiftChecks(limit: number): Promise<ShiftCheck[]>

  close(): Promise<void>
}

export interface ShiftCheckLine {
  name: string
  qty: number
  price: number
  amount: number
  options: Record<string, string>
  guest: string | null
  cancelled: boolean
  cancelReason: string | null
}

/** Одна закрытая сессия стола — то, чем сводят кассу. */
export interface ShiftCheck {
  tableId: string
  sessionId: string
  openedAt: number
  closedAt: number | null
  guests: number
  waiter: string | null
  lines: ShiftCheckLine[]
  total: number
  paid: number
  debt: number
  overpaid: number
  tips: number
  cancelledTotal: number
}
