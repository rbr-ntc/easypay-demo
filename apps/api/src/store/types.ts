import type { AuditEntry, MutationResult, Shift, TableSession } from '../types.ts'
import type { QualityVisit } from '@easypay/domain/quality'
import type { SessionEvent, StaffRecord, StoredSession } from '../staff.ts'

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
  /** Журнал, свежие первыми; `since` — от начала смены, чтобы её начало не терялось. */
  auditEntries(limit: number, since?: number | null): Promise<AuditEntry[]>

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
  /**
   * Решение закрывает весь остаток долга, поэтому на сессию оно одно: второе
   * (двойной тап, два менеджера) вернёт null, а не удвоит деньги в кассе.
   */
  addSettlement(s: Omit<Settlement, 'id' | 'at'>): Promise<Settlement | null>
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
  /** Кто (строковый id сотрудника) и когда последним переключал блюдо. */
  stopDetails(): Promise<Record<string, { by: string | null; at: number | null }>>

  // ── Меню из кабинета ──────────────────────────────────────────────────
  /** Опубликованное меню или черновик менеджера; null — ещё не было. */
  menuDoc(kind: MenuDocKind): Promise<MenuDocRow | null>
  /** Сохранить документ; null удаляет (отменить черновик). */
  saveMenuDoc(kind: MenuDocKind, doc: unknown | null, byStaffId: string | null): Promise<void>
  /** Фото блюда: хранится в базе, отдаётся по id — переживает редеплой. */
  savePhoto(mime: string, data: Buffer): Promise<string>
  photo(id: string): Promise<{ mime: string; data: Buffer } | null>

  // ── Персонал из кабинета ──────────────────────────────────────────────
  /** Сотрудники из базы; null — ещё никого не заводили, работаем по файлу. */
  staffList(): Promise<StaffRecord[] | null>
  /** Создать или обновить сотрудника вместе с закреплёнными столами. */
  saveStaff(rec: StaffRecord): Promise<void>

  // ── Сессии персонала ──────────────────────────────────────────────────
  /** Живые сессии (не отозванные, не истёкшие) — поднять после рестарта. */
  staffSessions(): Promise<StoredSession[]>
  /** Записать вход, выход, вытеснение, увольнение. */
  applySessionEvents(events: SessionEvent[]): Promise<void>

  // ── Настройки заведения ───────────────────────────────────────────────
  /** Сохранённые настройки и момент сохранения; null — не сохраняли. */
  settings(): Promise<{ doc: unknown; savedAt: number } | null>
  saveSettings(doc: unknown): Promise<number>

  /** Визиты за период для «Гости и качество»: оценки, ожидание вызова и кухни, чаевые. */
  qualityVisits(from: number, to: number, limit: number): Promise<QualityVisit[]>
  /** Отметить замечание разобранным. false — такой оценки нет. */
  resolveRating(sessionId: string, guestId: string, byStaffId: string | null, resolution: string): Promise<boolean>
  close(): Promise<void>
}

export type MenuDocKind = 'draft' | 'published'

export interface MenuDocRow {
  doc: any
  updatedAt: number
  /** Строковый id сотрудника, как в сессиях и журнале. */
  updatedBy: string | null
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
  /** Чаевые по отдельности со временем: отчёт смены берёт только свои по времени. */
  tipsList?: { amount: number; waiter: string | null; at: number }[]
  /** Уже возвращено гостям. */
  refunded?: number
  /** Возвраты по отдельности: наличные уходят из кассы, и сверка должна это знать. */
  refundsList?: { amount: number; method: string; at: number }[]
  firstSentAt?: number | null
  /** Оценки визита гостями этого стола. */
  ratings?: { rating: 'good' | 'ok' | 'bad'; note: string | null; guest: string | null }[]
  lastServedAt?: number | null
}
