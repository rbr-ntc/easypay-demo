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

  /**
   * Реестр чеков смены: закрытые сессии со всем составом. Без `shiftId` —
   * текущая смена, с ним — любая из истории.
   */
  shiftChecks(limit: number, shiftId?: string | null): Promise<ShiftCheck[]>

  // ── Жизненный цикл смены ──────────────────────────────────────────────
  /** Открытая смена или null — тогда новые столы не открываются. */
  currentShift(): Promise<ShiftInfo | null>
  /**
   * Открыть смену. Столы, перенесённые из прошлой (остались открытыми при
   * закрытии), переходят в новую — их выручка считается здесь.
   */
  openShift(byStaffId: string | null): Promise<ShiftInfo>
  /** Закрыть текущую смену, заморозив Z-отчёт. Открытые столы остаются — это перенос. */
  closeShift(report: unknown, byStaffId: string | null): Promise<ShiftInfo | null>
  /** Закрытые смены, свежие первыми. */
  shiftHistory(limit: number): Promise<ShiftInfo[]>

  // ── Долги и решения ───────────────────────────────────────────────────
  /** Закрытые с долгом столы за последние `sinceMs` — из них очередь «требует решения». */
  checksWithDebt(sinceMs: number): Promise<ShiftCheck[]>
  settlements(): Promise<Settlement[]>
  addSettlement(s: Omit<Settlement, 'id' | 'at'>): Promise<Settlement>
  /** Решения без денег: «это банкет — нормально» по долго открытому столу. */
  decisionNotes(): Promise<DecisionNote[]>
  addDecisionNote(n: Omit<DecisionNote, 'at'>): Promise<void>

  /**
   * Итоги ПО ВСЕМ закрытым чекам смены, а не по видимой их части. Список на
   * экране обрезан сотней последних, и сверка, сложенная из него, начинала
   * врать после сто первого стола за вечер — ровно в тот момент, когда цифры
   * нужнее всего. Сверять надо всё, показывать — сколько поместилось.
   */
  shiftCheckTotals(): Promise<ShiftCheckTotals>

  /** Переопределения стоп-листа поверх menu.json: блюдо → стоп или нет. */
  stopOverrides(): Promise<Record<string, boolean>>
  /** Кто и когда выключил или вернул блюдо — пишется вместе со значением. */
  setStop(dishId: string, stop: boolean, byStaffId: string | null): Promise<void>

  close(): Promise<void>
}

export interface ShiftCheckLine {
  name: string
  qty: number
  price: number
  amount: number
  options: Record<string, string>
  guest: string | null
  shared?: boolean
  cancelled: boolean
  cancelReason: string | null
}

export interface ShiftInfo {
  id: string
  openedAt: number
  openedBy: string | null
  closedAt: number | null
  closedBy: string | null
  /** Z-отчёт — заморожен при закрытии и больше не меняется. */
  report: unknown | null
}

/** Решение по долгу: взыскали (каким способом) или списали на заведение (почему). */
export interface Settlement {
  id: string
  sessionId: string
  tableId: string
  kind: 'collected' | 'written_off'
  amount: number
  method: 'cash' | 'transfer' | 'sbp' | null
  reason: string | null
  byId: string | null
  at: number
}

export interface DecisionNote {
  key: string
  text: string
  byId: string | null
  at: number
}

/** Свод по всем чекам смены: этим сходится касса. */
export interface ShiftCheckTotals {
  count: number
  paid: number
  debt: number
  overpaid: number
  cancelledTotal: number
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
  /** Смена, к которой относится чек. */
  shiftId?: string | null
  /** Платежи по отдельности: способ и время нужны отчёту по часам и по кассе. */
  payments?: { amount: number; method: string; at: number; guest: string | null; takenBy: string | null }[]
  tipsList?: { amount: number; waiter: string | null }[]
  /** Уже возвращено гостям. */
  refunded?: number
  firstSentAt?: number | null
  lastServedAt?: number | null
}
