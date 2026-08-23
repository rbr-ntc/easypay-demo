import type { Animal } from './data'
import { getStaffToken } from './staff'
import type { Staff } from '@easypay/domain/roles'

// Стол — только из ?t=... (его несёт QR со стола). Молчаливого дефолта нет:
// без параметра гость увидит экран выбора стола, а не чужой заказ.
const TABLE_RE = /^[A-Za-z0-9_-]{1,24}$/
const requested = new URLSearchParams(window.location.search).get('t')

export const tableId: string | null = requested && TABLE_RE.test(requested) ? requested : null
export const requestedTable = requested // как есть — чтобы показать «стол не найден»

const API = tableId ? `/api/t/${encodeURIComponent(tableId)}` : null

export class ApiError extends Error {
  readonly status: number
  /** Сырой код ошибки сервера: по нему клиент отличает «аллерген» от «нет связи». */
  readonly error: string
  /** Подробности отказа: список аллергенов, остаток, потолок чаевых. */
  readonly extra: Record<string, unknown>

  constructor(message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.error = message
    this.extra = extra
  }
}

export interface ServerPersona {
  id: string
  name: string
  animal: Animal
  joinedAt: number
  /** Что человеку нельзя. Сервер отдаёт это всем за столом с самого join. */
  allergies?: string[]
}

export interface ServerLine {
  uid: number
  dishId: string
  name?: string
  qty: number
  /** Цена, зафиксированная в позиции. Сервер шлёт её всегда — считать деньги
      по прайсу из меню нельзя: модификатор и правка меню делают её чужой. */
  price: number
  options?: Record<string, string>
  shared: boolean
  sharedWith?: string[]
  cancelled?: boolean
  cancelReason?: string | null
  personaId: string
  sent: boolean
  served: boolean
  sentAt: number | null
  startedAt?: number | null
  /** Готово и стоит на раздаче — гость видит «несут», а не «готовится». */
  readyAt?: number | null
  servedAt: number | null
}

export interface ServerPayment {
  /** Чем заплатили и кто принял: без этого наличные не свести с кассой. */
  method?: string
  takenByName?: string | null
  personaId: string
  amount: number
  scope: string
  at: number
}

export interface ServerTip {
  personaId: string
  amount: number
  at: number
}

export interface ServerCall {
  id?: string
  at: number
  personaId: string
  reason: string
  /** Что гость написал словами. Важнее подписи причины: с ним официант знает,
      зачем идёт, а без него — «Ольга зовёт официанта» и лишний заход. */
  note?: string | null
  name?: string
}

/** Итоги считает сервер — гость видит ровно то, что спишется. */
export interface PersonaTotals {
  personaId: string
  own: number
  share: number
  total: number
  paid: number
  remaining: number
  draft: number
}

export interface ServerTotals {
  tableTotal: number
  paidTotal: number
  remaining: number
  sharedTotal: number
  draftTotal: number
  byPersona: PersonaTotals[]
}

export interface Snapshot {
  tableId: string
  sessionId: string | null
  status: 'open' | 'closed'
  openedAt: number | null
  closedAt: number | null
  personas: ServerPersona[]
  lines: ServerLine[]
  payments: ServerPayment[]
  tips: ServerTip[]
  call: ServerCall | null
  calls: ServerCall[]
  waiter: { id: string; name: string } | null
  seats: number
  /** Заглушка для постороннего: состав и деньги вырезаны, это не пустой стол. */
  limited?: boolean
  /** Просьба принять наличные: деньги ещё не в счёте, их берёт человек. */
  cashIntent?: { personaId: string; scope: string; amount: number; at: number } | null
  totals: ServerTotals
}

/** Столько ждём ответа, прежде чем честно сказать гостю, что не дождались. */
const ACTION_TIMEOUT = 12_000

async function post<T>(
  action: string,
  body: object,
  opts: { staff?: boolean; guest?: string; sessionId?: string | null } = {}
): Promise<T> {
  if (!API) throw new ApiError('стол не выбран', 400)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.staff) headers['x-staff-token'] = getStaffToken()
  if (opts.guest) headers['x-guest-token'] = opts.guest
  // Запрос обязан сдаться сам. Без этого при исчерпанном пуле соединений
  // кнопка вечно показывала «Секунду…» — ни ответа, ни ошибки, ни возможности
  // повторить: гость просто сидел перед застывшим экраном.
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), ACTION_TIMEOUT)
  let res: Response
  try {
    res = await fetch(`${API}/${action}`, {
      method: 'POST',
      headers,
      signal: stop.signal,
      // sessionId помогает серверу отличить «этот гость не с нашего стола» от
      // «стол закрыли, пока вы ели» — гостю нужны разные объяснения
      body: JSON.stringify(opts.sessionId ? { ...body, sessionId: opts.sessionId } : body)
    })
  } catch (err) {
    if (stop.signal.aborted) throw new ApiError('timeout', 0)
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as Record<string, unknown>
    throw new ApiError(String(err.error ?? 'request failed'), res.status, err)
  }
  return res.json() as Promise<T>
}

// idemKey: повтор с тем же ключом не создаёт вторую персону / второй платёж
export const apiJoin = (name: string, animal: Animal, idemKey: string, allergies: string[] = []) =>
  post<{ personaId: string; guestToken: string; snapshot: Snapshot }>('join', {
    name,
    animal,
    // Аллергии гостя: дальше система предупреждает сама, а не ждёт комментария
    allergies,
    idemKey
  })

export const apiAddLine = (
  guest: string,
  dishId: string,
  qty: number,
  shared: boolean,
  options: Record<string, string>,
  idemKey: string,
  // Гость увидел предупреждение об аллергене и сознательно подтвердил заказ
  confirmAllergen = false
) =>
  post<{ ok: true; uid: number }>(
    'lines',
    { dishId, qty, shared, options, idemKey, confirmAllergen },
    { guest }
  )

/** Отменить своё блюдо, пока кухня не взяла его в работу. */
export const apiCancelMine = (guest: string, uid: number) =>
  post<{ ok: true }>('cancelMine', { uid }, { guest })

export const apiRemoveLine = (guest: string, uid: number) => post<{ ok: true }>('remove', { uid }, { guest })

export const apiSend = (guest: string, scope: 'mine' | 'all') => post<{ ok: true; sent: number }>('send', { scope }, { guest })

export interface Receipt {
  no: string
  at: number
  amount: number
  scope: string
  guest: string
  table: string
  lines: {
    name: string
    qty: number
    price: number
    /** Модификаторы: чек обязан называть, бутылка это или бокал. */
    options?: Record<string, string>
    shared: boolean
    share: number | null
  }[]
}

export const apiPay = (
  guest: string,
  scope: 'own' | 'equal' | 'full',
  idemKey: string,
  /** Чем именно платит гость — иначе в платеже осядет «СБП» на любой выбор. */
  method?: string
) =>
  post<{ ok: true; amount: number; remaining: number; receipt?: Receipt }>(
    'pay',
    { scope, idemKey, method },
    { guest }
  )

/** «Заплачу наличными»: просьба к официанту, деньги не списываются. */
export const apiCashIntent = (guest: string, scope: 'own' | 'equal' | 'full') =>
  post<{ ok: true; amount: number; scope: string }>('cashIntent', { scope }, { guest })

/** «Передумал»: снять просьбу о наличных, чтобы официант не шёл зря. */
export const apiCancelCash = (guest: string) => post<{ ok: true }>('cancelCash', {}, { guest })

export const apiTip = (guest: string, amount: number, idemKey: string) =>
  post<{ ok: true; amount: number }>('tip', { amount, idemKey }, { guest })

export const apiCall = (guest: string, reason: 'help' | 'bill' | 'water', note?: string) =>
  post<{ ok: true; callId: string; repeated: boolean }>('call', { reason, note }, { guest })

// Действия персонала — с сессией сотрудника и привязкой к сессии стола
export const apiStart = (uid: number, sessionId: string) =>
  post<{ ok: true; startedAt: number }>('start', { uid, sessionId }, { staff: true })

export const apiServe = (uid: number, sessionId: string) => post<{ ok: true }>('serve', { uid, sessionId }, { staff: true })

export const apiAck = (callId?: string) => post<{ ok: true; left: number }>('ack', { callId }, { staff: true })

/** force — осознанное закрытие стола с долгом. */
export const apiClose = (force = false) => post<{ ok: true }>('close', { force }, { staff: true })

export const apiReset = () => post<{ ok: true }>('reset', {}, { staff: true })

export interface Whoami {
  staff: Staff
  shiftTips: number
}

/** Кто сейчас в смене на этом устройстве. null — нужно войти. */
/**
 * Кто сейчас в смене на этом устройстве.
 *
 * `null` — сервер СКАЗАЛ «токена нет». `'offline'` — сервер молчит или отвечает
 * пятисоткой. Раньше это было одно и то же значение, и рестарт сервера или
 * моргнувший Wi-Fi выбрасывали повара на PIN-экран посреди смены, стирая
 * личность из localStorage.
 */
export async function apiWhoami(token: string = getStaffToken()): Promise<Whoami | null | 'offline'> {
  if (!token) return null
  try {
    const res = await fetch('/api/staff/me', { headers: { 'x-staff-token': token } })
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) return 'offline'
    return (await res.json()) as Whoami
  } catch {
    return 'offline'
  }
}

export type LoginResult = { ok: true; token: string; staff: Staff } | { ok: false; status: number }

export async function apiStaffLogin(pin: string): Promise<LoginResult> {
  try {
    const res = await fetch('/api/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    })
    if (!res.ok) return { ok: false, status: res.status }
    const body = (await res.json()) as { token: string; staff: Staff }
    return { ok: true, ...body }
  } catch {
    return { ok: false, status: 0 } // связи нет
  }
}

export async function apiStaffLogout(token: string = getStaffToken()): Promise<void> {
  try {
    await fetch('/api/staff/logout', { method: 'POST', headers: { 'x-staff-token': token } })
  } catch {
    /* выходим локально в любом случае */
  }
}

export interface ShiftCheckLine {
  name: string
  qty: number
  price: number
  amount: number
  guest: string | null
  cancelled: boolean
  cancelReason: string | null
}

export interface ShiftCheck {
  tableId: string
  sessionId: string
  openedAt: number
  closedAt: number
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

export interface ShiftChecksPayload {
  shift: { closedRevenue: number; netRevenue?: number; overpaid: number; debt: number; writtenOff?: number }
  checks: ShiftCheck[]
  control: {
    checksPaid: number
    closedRevenue: number
    openPaid: number
    matches: boolean
    // Сверка не только денег: долг и переплата тоже обязаны сходиться
    checksDebt?: number
    shiftDebt?: number
    debtMatches?: boolean
    checksOverpaid?: number
    overpaidMatches?: boolean
    checksWrittenOff?: number
    shiftWrittenOff?: number
    writtenOffMatches?: boolean
    /** Сколько чеков за сверкой и сколько из них поместилось в список. */
    checksTotal?: number
    checksShown?: number
  }
}

/** Реестр чеков смены: то, чем сводят кассу. Только менеджеру. */
export async function apiShiftChecks(): Promise<ShiftChecksPayload | null> {
  try {
    const res = await fetch('/api/shift/checks', { headers: { 'x-staff-token': getStaffToken() } })
    if (!res.ok) return null
    return (await res.json()) as ShiftChecksPayload
  } catch {
    return null
  }
}

export async function apiShiftLog(): Promise<{ entries: LogEntry[] } | null> {
  try {
    const res = await fetch('/api/log', { headers: { 'x-staff-token': getStaffToken() } })
    if (!res.ok) return null
    return (await res.json()) as { entries: LogEntry[] }
  } catch {
    return null
  }
}

export interface LogEntry {
  at: number
  staffId: string | null
  name: string
  role: string | null
  action: string
  tableId: string | null
  detail: string | null
  /** Сумма денежного действия: журнал обязан обосновывать цифры смены. */
  amount?: number | null
}

export function subscribe(
  onSnapshot: (s: Snapshot) => void,
  onState: (ok: boolean) => void,
  guestToken?: string | null
): () => void {
  if (!API) return () => {} // стол не выбран — подписываться не на что
  // Состав стола и деньги видит только свой: EventSource не умеет заголовки,
  // поэтому секрет передаётся параметром — гостевой у гостя, служебный у персонала.
  // Без этого экран официанта показывал пустой стол при живых гостях в зале.
  // Личный секрет гостя старше служебного: иначе на общем устройстве гость
  // подписывался бы токеном персонала и видел состав чужого стола
  const staff = guestToken ? null : getStaffToken()
  const params = new URLSearchParams()
  if (guestToken) params.set('g', guestToken)
  if (staff) params.set('token', staff)
  const query = params.toString()
  const url = query ? `${API}/stream?${query}` : `${API}/stream`
  const es = new EventSource(url)
  es.onmessage = e => {
    try {
      onSnapshot(JSON.parse(e.data) as Snapshot)
      onState(true)
    } catch (err) {
      console.error('bad snapshot:', err)
    }
  }
  es.onerror = () => onState(false) // EventSource переподключается сам
  return () => es.close()
}
