import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ApiError,
  apiAck,
  apiAddLine,
  apiCall,
  apiLeave,
  apiRate,
  apiSetAllergies,
  apiClose,
  apiServe,
  apiStart,
  apiStaffLogin,
  apiStaffLogout,
  apiWhoami,
  apiJoin,
  apiPay,
  apiPayStatus,
  apiCancelPay,
  apiCancelMine,
  apiCancelCash,
  apiCashIntent,
  apiRemoveLine,
  apiReset,
  apiSend,
  apiTip,
  subscribe,
  tableId
} from './api'
import type { SendAllergy, ServerPersona, Snapshot } from './api'
import { clearSignedOut, clearStaff, getCachedStaff, markSignedOut, setCachedStaff, setStaffToken } from './staff'
import { can } from '@easypay/domain/roles'
import type { Permission, Staff } from '@easypay/domain/roles'
import { newIdemKey } from './keys'
import { ensureMenu, findDish, onMenuChange } from './data'
import { ensureSettings, onSettingsChange, SETTINGS } from './settings'
import type { Animal, LineOptions } from './data'
import { amountFor, computeTotals as computeMoney } from '@easypay/domain/money'

/**
 * Пять экранов гостя.
 *
 * `cart` и `status` слились в `table`: гость не понимал, что уже ушло на
 * кухню, а что ещё нет, потому что ответ был размазан по двум экранам.
 * `welcome` вернулся в 4.x — но только для того, кто за столом ещё никто;
 * вернувшийся гость идёт сразу в меню. `tips` — часть `done`.
 */
export type Screen = 'welcome' | 'menu' | 'table' | 'payment' | 'done'
export type Sheet = null | 'dish' | 'name' | 'call' | 'allergies'
/** `failed` — банк не подтвердил: деньги не списаны, повтор идёт тем же ключом. */
export type PayStage = 'form' | 'qr' | 'processing' | 'checking' | 'failed'
export type PayScope = 'own' | 'equal' | 'full'
// «cash» — такой же выбор способа, как остальные. Раньше наличные были не
// выбором, а мгновенным действием: гость трогал строку, чтобы посмотреть, и
// официант уже шёл за деньгами, а на экране ничего не менялось.
export type PayMethod = 'sbp' | 'card' | 'tpay' | 'sber' | 'mir' | 'cash'

export interface PendingAdd {
  dishId: string
  qty: number
  shared: boolean
  options: LineOptions
  /** Ключ намерения: блюдо, добавленное после ввода имени, не должно задвоиться при повторе. */
  idemKey?: string
  /** Пожелание кухне, написанное до того, как гость представился. */
  comment?: string
}

export interface UiState {
  screen: Screen
  sheet: Sheet
  currentDishId: string | null
  pendingAdd: PendingAdd | null
  /**
   * Аллергены, на которых сервер остановил заказ, когда карточка блюда была
   * уже закрыта (имя спрашивали в отдельной шторке). Карточка открывается
   * заново и сразу показывает предупреждение — проглотить его нельзя.
   */
  pendingAllergens: string[] | null
  /** Ключ намерения, с которым карточку блюда открыли заново после сбоя. */
  resumeKey: string | null
  /** Что сделать сразу после «Как вас зовут?»: например, позвать официанта. */
  afterJoin: 'call' | null
  payScope: PayScope
  payMethod: PayMethod
  payStage: PayStage
  /** Что именно ответил банк — гостю нужно объяснение, а не «попробуйте ещё». */
  payError: string | null
  /** Ответа не было вовсе: платёж мог пройти, и говорить обратное нельзя. */
  payUnknown: boolean
  /** Оплата у эквайера, которую ждём: гость вернулся со страницы ЮKassa. */
  payIntent: string | null
  /** Сегмент на экране «Стол»: свой заказ или весь стол. */
  tableTab: 'mine' | 'all'
  lastPaid: number
  /** Чек последней оплаты: номер, время и состав — то, что гость может предъявить. */
  lastReceipt: import('./api').Receipt | null
  /** Чаевые в рублях: гость решает про деньги, а не про проценты. */
  tip: number
  toast: string | null
}

const initialUi: UiState = {
  screen: 'menu',
  sheet: null,
  currentDishId: null,
  pendingAdd: null,
  pendingAllergens: null,
  resumeKey: null,
  afterJoin: null,
  payScope: 'own',
  payMethod: 'sbp',
  payStage: 'form',
  payError: null,
  payUnknown: false,
  payIntent: null,
  tableTab: 'mine',
  lastPaid: 0,
  lastReceipt: null,
  tip: 200,
  toast: null
}

const PAY_KEY = `easypay-pay-${tableId}`

/** Номер оплаты у эквайера, которую ждём: из адреса возврата или из прошлой попытки. */
function returningPayIntent(): string | null {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('pay')
  if (fromUrl) {
    // Номер из адреса убираем: обновление страницы не должно перепроверять вечно
    params.delete('pay')
    const q = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`)
    rememberPayIntent(fromUrl)
    return fromUrl
  }
  try {
    return localStorage.getItem(PAY_KEY)
  } catch {
    return null
  }
}

function rememberPayIntent(id: string | null) {
  try {
    if (id) localStorage.setItem(PAY_KEY, id)
    else localStorage.removeItem(PAY_KEY)
  } catch {
    /* приватный режим — просто не запомним */
  }
}

const ID_KEY = `easypay-identity-${tableId}`

interface Identity {
  sessionId: string
  personaId: string
  guestToken: string
}

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Identity
    // без личного токена личность недействительна: сервер такие действия отклонит
    return parsed.sessionId && parsed.personaId && parsed.guestToken ? parsed : null
  } catch {
    return null
  }
}

export interface Totals {
  participants: number
  sharedTotal: number
  myOwn: number
  myShare: number
  myTotal: number
  /** Черновик корзины — вне счёта стола. */
  myDraft: number
  draftTotal: number
  tableTotal: number
  paidTotal: number
  remaining: number
  myPaid: number
  myRemaining: number
  scopeAmount: (scope: PayScope) => number
  /** На скольких делится «Поровну»: все за столом. */
  equalSplit: number
  /** Кто-то уже платил «поровну» — остальным предлагаем тоже поровну. */
  equalMode: boolean
  personaOwn: (pid: string) => number
  personaTotal: (pid: string) => number
  personaPaid: (pid: string) => number
  personaRemaining: (pid: string) => number
}

// Считает ровно то же, что сервер: модель живёт в shared/money.js в одном экземпляре.
// Клиентские суммы — только для отображения, списывает всегда сервер.
export function computeTotals(snap: Snapshot | null, myId: string | null): Totals {
  // Цена зафиксирована в позиции сервером и уже включает надбавку за модификатор.
  // Меню тут только запасной вариант для позиций без цены.
  const core = computeMoney(snap ?? {}, id => findDish(id)?.price ?? 0)
  const server = snap?.totals
  const mine = myId ? server?.byPersona.find(p => p.personaId === myId) : undefined
  const participants = core.participants

  const tableTotal = server?.tableTotal ?? core.tableTotal
  const paidTotal = server?.paidTotal ?? core.paidTotal
  const remaining = server?.remaining ?? core.remaining
  const myTotal = mine?.total ?? core.totalOf(myId)
  const myPaid = mine?.paid ?? core.paidOf(myId)
  const myRemaining = mine?.remaining ?? core.remainingOf(myId)

  /**
   * Сумма списания — ТОЙ ЖЕ функцией, что и на сервере (`amountFor`), на
   * серверных итогах. Своя формула здесь уже расходилась: «поровну» делила
   * остаток, а сервер делит счёт — Анна внесла половину из 3 000 на троих,
   * Борис видел «Оплатить · 500 ₽», а списывалось 1 000 ₽.
   */
  // Те же числа, что у сервера: «поровну» — доля счёта минус уже внесённое
  // Сосед сейчас на странице оплаты — его сумма зарезервирована, кнопка считает от остатка
  const res = snap?.reserved
  const resMine = myId ? res?.byPersona.find(p => p.personaId === myId) : undefined
  const moneyView = {
    remaining: res?.remaining ?? remaining,
    tableTotal,
    participants,
    remainingOf: () => resMine?.remaining ?? myRemaining,
    paidOf: () => resMine?.paid ?? myPaid
  } as any
  const scopeAmount = (scope: PayScope) => (participants > 0 ? amountFor(moneyView, myId, scope) : 0)
  const equalSplit = participants
  const equalMode = (snap?.payments ?? []).some(p => p.scope === 'equal')

  return {
    participants,
    sharedTotal: server?.sharedTotal ?? core.sharedTotal,
    myOwn: mine?.own ?? core.ownOf(myId),
    myShare: mine?.share ?? core.shareOf(myId),
    myTotal,
    myDraft: mine?.draft ?? core.draftOf(myId),
    draftTotal: server?.draftTotal ?? core.draftTotal,
    tableTotal,
    paidTotal,
    remaining,
    myPaid,
    myRemaining,
    scopeAmount,
    equalSplit,
    equalMode,
    personaOwn: pid => server?.byPersona.find(p => p.personaId === pid)?.own ?? core.ownOf(pid),
    personaTotal: pid => server?.byPersona.find(p => p.personaId === pid)?.total ?? core.totalOf(pid),
    personaPaid: pid => server?.byPersona.find(p => p.personaId === pid)?.paid ?? core.paidOf(pid),
    // Личный остаток берём у сервера: за гостя мог заплатить сосед
    personaRemaining: pid => server?.byPersona.find(p => p.personaId === pid)?.remaining ?? core.remainingOf(pid)
  }
}

/** Человеческий текст вместо кода ошибки: гость должен понять, что делать дальше. */
export function humanError(err: ApiError): string {
  const map: Record<string, string> = {
    // Не дождались ответа — говорим об этом словами, а не вечным «Секунду…»
    timeout: 'Сервер не ответил вовремя. Проверьте связь и попробуйте ещё раз',
    'guest token required': 'Похоже, вы вышли из заказа. Откройте меню заново со своего QR',
    'unknown guest': 'Этот заказ принадлежит другому гостю',
    'session ended': 'Стол закрыли. Отсканируйте QR на столе, чтобы начать заново',
    'not your persona': 'Заказывать можно только за себя',
    'table closed': 'Стол уже закрыли. Отсканируйте QR, чтобы начать заново',
    'scope required': 'Выберите, за что платите: за себя или за весь стол',
    'already sent to kitchen': 'Это блюдо уже на кухне — его снимет официант',
    'already closed': 'Стол уже закрыт',
    'cash request pending': 'Официант уже идёт за наличными — дождитесь его или отмените просьбу',
    'shift closed': 'Ресторан ещё не открыл смену — заказ пока не принять. Позовите официанта',
    'kitchen pending': 'На кухне ещё готовятся блюда этого стола',
    'unknown allergen': 'Такой аллергии нет в списке — выберите из предложенных',
    'unknown table': 'Такого стола нет в зале — проверьте QR на столе',
    'table key required': 'Отсканируйте QR-код на столе: по ссылке без него за стол не сесть',
    'table full': 'За столом нет свободных мест — попросите официанта приставить стул',
    // Частая причина — корзина ещё не отправлена: подсказываем, что сделать
    'nothing to pay': 'Оплачивать пока нечего — если в корзине что-то есть, сначала отправьте на кухню',
    'unknown method': 'Такой способ оплаты не поддерживается',
    'stale key': 'Счёт изменился с прошлой попытки — нажмите «Оплатить» ещё раз',
    'nothing to send': 'Всё уже отправлено на кухню',
    'already cooking': 'Кухня уже готовит это блюдо — отменить не получится',
    'already cancelled': 'Это блюдо уже отменено',
    'already served': 'Это блюдо уже подали',
    'allergen warning': 'В этом блюде есть то, на что вы указали аллергию',
    'guest has orders': 'За вами уже есть заказ — выйти нельзя, позовите официанта',
    'guest has payments': 'Вы уже платили — выйти нельзя, позовите официанта',
    'last guest': 'Вы последний за столом',
    'signed out elsewhere': 'Вы вошли на другом устройстве — войдите заново',
    'not your table': 'Это стол другого официанта',
    'dish in stop list': 'Это блюдо сегодня закончилось',
    'unknown dish': 'Такого блюда больше нет в меню',
    'bad qty': 'Можно заказать от 1 до 9 порций',
    'tip too large': 'Слишком большие чаевые для этого счёта',
    'bad amount': 'Сумма указана неверно — минимум 1 ₽',
    'payment in progress': 'Оплата уже идёт — завершите её на странице банка или подождите пару минут',
    'payment provider unavailable': 'Платёжный сервис не ответил — попробуйте ещё раз через минуту',
    'public url not configured': 'Оплата с телефона временно недоступна — позовите официанта',
    'too many requests': 'Слишком много нажатий подряд — подождите минуту',
    'equal split in progress': 'Стол уже делит счёт поровну — выберите «поровну» или «весь стол»',
    'locked or missing': 'Позиция уже уехала на кухню — её не убрать',
    'not yours': 'Это позиция другого гостя',
    'stale session': 'Стол успели закрыть — обновите страницу',
    'idemKey required': 'Не получилось подтвердить платёж, попробуйте ещё раз'
  }
  if (map[err.message]) return map[err.message]
  if (err.message.startsWith('bad value for')) return 'Такого варианта у блюда нет — выберите из списка'
  if (err.message.startsWith('unknown option')) return 'Этот модификатор недоступен для блюда'
  if (err.status >= 500) return 'Сервер не отвечает — попробуйте ещё раз'
  return 'Не получилось — проверьте связь и попробуйте ещё раз'
}

export function tipAmount(ui: UiState): number {
  return Math.max(0, Math.round(ui.tip))
}

/**
 * Чем закончилась оплата. `unknown: true` — сервер не ответил: платёж мог
 * пройти, и утверждать гостю «деньги не списаны» в этом случае нельзя.
 */
export interface PayResult {
  paid: number
  error: string | null
  unknown: boolean
  /** Ушли на страницу эквайера: результат узнаем после возврата. */
  redirect?: boolean
  /** Код ошибки сервера: `stale key` — ключ попытки устарел, нужен новый. */
  code?: string | null
}

/** Чем закончилась попытка заказать: успехом, аллергеном или отказом сервера. */
export interface AddResult {
  ok: boolean
  allergens?: string[]
}

interface Ctx {
  ui: UiState
  patch: (p: Partial<UiState>) => void
  /** Растёт с каждой сменой меню или настроек: ключ для useMemo над ними. */
  menuRev: number
  snap: Snapshot | null
  connected: boolean
  me: ServerPersona | null
  totals: Totals
  toast: (msg: string) => void
  // server actions
  join: (name: string, animal: Animal, idemKey: string, allergies?: string[]) => Promise<ServerPersona | null>
  /**
   * Возвращает исход попытки. `allergens` — сервер остановил заказ, гость с
   * заявленной аллергией обязан подтвердить осознанно. `ok: false` без
   * аллергенов — сервер отказал: праздновать успех в этом случае нельзя.
   */
  addLine: (
    dishId: string,
    qty: number,
    shared: boolean,
    options: LineOptions,
    asGuestToken?: string,
    confirmAllergen?: boolean,
    /** Ключ намерения: один на карточку блюда, а не на каждый тап по кнопке. */
    idemKey?: string,
    /** Пожелание кухне: «без лука», «аллергия, отдельной посудой». */
    comment?: string
  ) => Promise<AddResult>
  removeLine: (uid: number) => Promise<void>
  /** Отменить своё блюдо, пока кухня не взяла его в работу. */
  cancelMine: (uid: number) => Promise<void>
  /** Позвать официанта с наличными: сумма ждёт подтверждения человека. */
  askCash: (scope: PayScope) => Promise<number>
  /** Передумал: снять просьбу, чтобы официант не шёл за деньгами зря. */
  cancelCash: () => Promise<void>
  /** Возвращает, дошло ли до кухни: интерфейс не должен праздновать отказ. */
  /** ok — ушло; allergy — корзина пролежала, и в ней теперь есть чей-то аллерген. */
  sendWave: (scope: 'mine' | 'all', confirmUids?: number[]) => Promise<{ ok: boolean; held?: boolean; allergy?: SendAllergy[] }>
  /**
   * Способ передаём серверу: иначе в платеже оседает «СБП» на любой выбор.
   * Возвращает исход целиком: экран отказа обязан знать, ЧТО ответил сервер,
   * — «банк не подтвердил» и «связь оборвалась» это разные вещи, и во втором
   * случае деньги могли списаться.
   */
  pay: (scope: PayScope, idemKey: string, method?: PayMethod) => Promise<PayResult>
  /** Спросить сервер, чем кончилась оплата у эквайера. `pending` — ещё ждём. */
  /** Перестать ждать оплату: гость ушёл к столу — при перезагрузке не проверять заново. */
  forgetPayIntent: () => void
  /** Отменить свою оплату картой в пути — например, чтобы заплатить наличными. */
  cancelPay: () => Promise<boolean>
  checkPay: (intentId: string) => Promise<{ status: 'pending' | 'succeeded' | 'canceled' | 'unknown'; confirmationUrl?: string | null }>
  leaveTip: (amount: number, idemKey: string) => Promise<number>
  callWaiter: (reason: 'help' | 'bill' | 'water', note?: string) => Promise<void>
  forgetMe: () => void // «Я другой гость» — телефон передали новому человеку
  /** Изменить свои аллергии после посадки. true — сервер принял. */
  setAllergies: (allergies: string[]) => Promise<boolean>
  /** Выйти из-за стола, если сел по ошибке и за тобой ничего нет. */
  leaveTable: () => Promise<boolean>
  /** Оценить визит. true — сервер принял. */
  rateVisit: (rating: 'good' | 'ok' | 'bad', note?: string) => Promise<boolean>
  // смена сотрудника: вход по PIN, права роли
  staff: Staff | null
  staffChecked: boolean
  shiftTips: number
  may: (permission: Permission) => boolean
  checkStaff: () => Promise<void>
  /** Возвращает HTTP-статус попытки: 200 — вошли, 401 — не тот PIN, 429 — перебор попыток. */
  signInStaff: (pin: string) => Promise<number>
  signOutStaff: () => Promise<void>
  startLine: (uid: number) => Promise<boolean>
  serveLine: (uid: number) => Promise<boolean>
  ackCall: (callId?: string) => Promise<boolean>
  closeTable: (force?: boolean) => Promise<boolean>
  resetDemo: () => Promise<boolean>
}

const StoreCtx = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  // Приветствие видит тот, кто за этим столом ещё никто. Вернувшийся гость
  // (личность в localStorage) сразу попадает в меню — второй раз «добро
  // пожаловать» после каждой перезагрузки только мешает.
  const [ui, setUi] = useState<UiState>(() => {
    // Вернулись со страницы оплаты — сразу проверяем, чем кончилось
    const intent = returningPayIntent()
    if (intent && loadIdentity()) return { ...initialUi, screen: 'payment', payStage: 'checking', payIntent: intent }
    return { ...initialUi, screen: loadIdentity() ? 'menu' : 'welcome' }
  })
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity)
  const [staff, setStaff] = useState<Staff | null>(getCachedStaff)
  const [staffChecked, setStaffChecked] = useState(false)
  const [shiftTips, setShiftTips] = useState(0)
  // Меню опубликовали — перерисовываем всех, кто читает MENU при отрисовке
  const [menuRev, setMenuRev] = useState(0)
  useEffect(() => onMenuChange(() => setMenuRev(r => r + 1)), [])
  useEffect(() => onSettingsChange(() => setMenuRev(r => r + 1)), [])
  useEffect(() => ensureMenu(snap?.menuVersion), [snap?.menuVersion])
  useEffect(() => ensureSettings(snap?.settingsVersion), [snap?.settingsVersion])
  // Официант принял мой вызов — говорим, кто идёт: раньше вызов исчезал молча,
  // и «идут ко мне» было не отличить от «вызов сбросили»
  const seenAcks = useRef<Set<string>>(new Set())
  useEffect(() => {
    const mineId = identity?.personaId
    for (const a of snap?.acked ?? []) {
      if (seenAcks.current.has(a.id)) continue
      seenAcks.current.add(a.id)
      if (a.personaId === mineId && Date.now() - a.at < 60_000) {
        // Ответ официанта — словами: «пицца через 3 минуты», а не только «идёт»
        toastRef.current?.(a.reply ? `${a.by ?? 'Официант'}: ${a.reply}` : `${a.by ?? 'Официант'} идёт к вам`)
      }
    }
  }, [snap?.acked, identity?.personaId])
  const personaId = identity?.personaId ?? null
  // Токен читаем через ref: действие сразу после join не должно видеть старое замыкание
  const identityRef = useRef<Identity | null>(identity)
  identityRef.current = identity
  const guestToken = () => identityRef.current?.guestToken ?? null
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // Переподписываемся, когда гость получил личность: до join поток анонимный
  const [streamKey, setStreamKey] = useState(0)
  useEffect(() => subscribe(setSnap, setConnected, identityRef.current?.guestToken ?? null), [streamKey])

  // Личность сотрудника обязана следовать за токеном, а не жить своей жизнью.
  // Токен могли заменить на этом же устройстве (сменился человек) или погасить
  // с другого — и то, и другое должно немедленно отразиться на экране.
  useEffect(() => {
    let alive = true
    const resync = async () => {
      const who = await apiWhoami()
      if (!alive) return
      // Рестарт сервера или моргнувший Wi-Fi — не повод разлогинить повара
      // посреди смены. Ресинк висит на focus, то есть срабатывал бы десятки
      // раз за вечер.
      if (who === 'offline') return
      setStaff(who?.staff ?? null)
      setCachedStaff(who?.staff ?? null)
      setShiftTips(who?.shiftTips ?? 0)
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'easypay-staff-token') void resync()
    }
    const onFocus = () => void resync()

    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // На закрытом столе личность недействительна: первое действие гостя
  // должно пройти через join и открыть НОВУЮ сессию
  const me = useMemo(
    () => (snap?.status === 'open' ? snap.personas.find(p => p.id === personaId) ?? null : null),
    [snap, personaId]
  )

  // Сессия сменилась (стол закрыли/сбросили) — локальная личность устарела
  // Заглушка для постороннего (`limited`) значит две разные вещи, и путать их
  // нельзя. Если она прилетела ПОСЛЕ полного снапшота — это запоздавший кадр
  // старого потока сразу после join: личность трогать нельзя, иначе гость
  // теряет корзину и садится за стол вторым с тем же именем. Если она пришла
  // ПЕРВОЙ в подписке, открытой с токеном, — токен мёртв (стол сбросили, пока
  // телефон спал), и держаться за такую личность значит запереть гостя: любое
  // действие отвечает «session ended», а пересканирование QR подтягивает её же.
  const sawFullSnapshot = useRef(false)
  useEffect(() => {
    sawFullSnapshot.current = false
  }, [streamKey])

  useEffect(() => {
    if (!snap || !identity) return
    if (snap.limited) {
      // Сервер прямо сказал: вы больше не за этим столом (убрали, стол пересел)
      if (snap.revoked) {
        localStorage.removeItem(ID_KEY)
        setIdentity(null)
        setStreamKey(k => k + 1)
        return
      }
      if (sawFullSnapshot.current) return
    } else {
      sawFullSnapshot.current = true
    }
    if (snap.limited || snap.sessionId !== identity.sessionId || !me) {
      localStorage.removeItem(ID_KEY)
      setIdentity(null)
    }
  }, [snap, identity, me, streamKey])

  // Стол закрыли ИЛИ сбросили, пока гость был в потоке — мягко возвращаем в
  // начало. Раньше смотрели только на статус, а `reset` открывает новую сессию
  // со статусом open: гость терял личность и оставался на экране «Стол», где
  // без личности не рендерится вообще ничего — пустой белый лист до перезагрузки.
  const lostMyself = !!snap && snap.status === 'open' && !me && ui.screen !== 'menu' && ui.screen !== 'welcome'
  useEffect(() => {
    if (lostMyself) {
      setUi(prev => ({ ...initialUi, toast: prev.toast }))
      toastRef.current?.('Стол начали заново — можно заказывать')
      return
    }
    // Закрытый стол для нового гостя — нормальное начало, а не «вас выгнали»:
    // приветствие показывается именно на таком столе, его сбрасывать нельзя
    if (snap?.status === 'closed' && ui.screen !== 'menu' && ui.screen !== 'done' && ui.screen !== 'welcome') {
      setUi(prev => ({ ...initialUi, toast: prev.toast }))
      toastRef.current?.('Стол закрыт. Спасибо, что были с нами!')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.status, lostMyself])

  const patch = (p: Partial<UiState>) => setUi(prev => ({ ...prev, ...p }))

  const toast = (msg: string) => {
    patch({ toast: msg })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => patch({ toast: null }), 2200)
  }
  const toastRef = useRef<typeof toast>()
  toastRef.current = toast

  const totals = useMemo(() => computeTotals(snap, personaId), [snap, personaId])

  // Причину отказа объясняет сервер — гостю нужно показать её, а не «проверьте связь»
  const guard = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      console.error('api error:', err)
      toast(err instanceof ApiError ? humanError(err) : 'Не получилось — проверьте связь и попробуйте ещё раз')
      return fallback
    }
  }

  // Действия персонала: 401 — сессия протухла, 403 — роли не хватает прав
  const staffGuard = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStaff(null)
        setCachedStaff(null)
        toast('Нужно войти в смену')
      } else if (err instanceof ApiError && err.status === 403) {
        toast('Вашей роли это недоступно')
      } else {
        console.error('api error:', err)
        toast('Не получилось — проверьте связь и попробуйте ещё раз')
      }
      return false
    }
  }

  const ctx: Ctx = {
    ui,
    patch,
    menuRev,
    snap,
    connected,
    me,
    totals,
    toast,
    join: (name, animal, idemKey, allergies = []) =>
      guard(async () => {
        const r = await apiJoin(name, animal, idemKey, allergies)
        const id: Identity = { sessionId: r.snapshot.sessionId ?? '', personaId: r.personaId, guestToken: r.guestToken }
        setStreamKey(k => k + 1)
        localStorage.setItem(ID_KEY, JSON.stringify(id))
        identityRef.current = id
        setIdentity(id)
        setSnap(r.snapshot)
        return r.snapshot.personas.find(p => p.id === r.personaId) ?? null
      }, null),
    addLine: async (dishId, qty, shared, options, asGuestToken, confirmAllergen = false, idemKey, comment) => {
      const token = asGuestToken ?? guestToken()
      if (!token) return { ok: false }
      try {
        // Без ключа снаружи каждый повтор был бы новым намерением — и семь
        // быстрых нажатий превращались в семь порций
        await apiAddLine(token, dishId, qty, shared, options, idemKey ?? newIdemKey(), confirmAllergen, comment)
        return { ok: true }
      } catch (err) {
        // Аллерген — не ошибка связи: гостю нужен осознанный выбор, а не тост
        if (err instanceof ApiError && err.error === 'allergen warning') {
          return { ok: false, allergens: (err.extra?.allergens as string[]) ?? [] }
        }
        toastRef.current?.(
          err instanceof ApiError ? humanError(err) : 'Не получилось — проверьте связь и попробуйте ещё раз'
        )
        return { ok: false }
      }
    },
    removeLine: uid =>
      guard(async () => {
        if (!guestToken()) return
        await apiRemoveLine(guestToken()!, uid)
      }, undefined),
    cancelMine: uid =>
      guard(async () => {
        if (!guestToken()) return
        await apiCancelMine(guestToken()!, uid)
      }, undefined),
    askCash: scope =>
      guard(async () => {
        if (!guestToken()) return 0
        const r = await apiCashIntent(guestToken()!, scope)
        toastRef.current?.('Официант подойдёт за наличными')
        return r.amount
      }, 0),
    cancelCash: () =>
      guard(async () => {
        if (!guestToken()) return
        await apiCancelCash(guestToken()!)
        // Иначе футер продолжает предлагать «Позвать официанта» человеку,
        // который только что от этого отказался
        setUi(prev => ({ ...prev, payMethod: 'sbp' }))
        toast('Хорошо, платим телефоном')
      }, undefined),
    sendWave: async (scope, confirmUids = []) => {
      if (!guestToken()) return { ok: false }
      try {
        const r = await apiSend(guestToken()!, scope, confirmUids)
        // Чужое с аллергеном соседа и снятое в стоп остаются в корзине — говорим об этом
        const held = r.heldBack ?? []
        if (held.length) {
          toastRef.current?.(
            held
              .map(h => (h.reason === 'stop' ? `«${h.dish}» закончилось` : `«${h.dish}» ждёт подтверждения: аллергия у ${h.people.join(', ')}`))
              .join(' · ')
          )
        }
        return { ok: r.sent > 0, held: held.length > 0 }
      } catch (err) {
        if (err instanceof ApiError && err.error === 'allergen warning') {
          return { ok: false, allergy: (err.extra?.lines as SendAllergy[]) ?? [] }
        }
        const dishes = err instanceof ApiError ? (err.extra?.dishes as string[] | undefined) : undefined
        toastRef.current?.(
          dishes?.length
            ? `${dishes.map(d => `«${d}»`).join(', ')} сегодня ${dishes.length === 1 ? 'закончилось' : 'закончились'} — уберите из корзины`
            : err instanceof ApiError
              ? humanError(err)
              : 'Не получилось — проверьте связь и попробуйте ещё раз'
        )
        return { ok: false }
      }
    },
    pay: async (scope, idemKey, method) => {
      if (!guestToken()) return { paid: 0, error: 'guest token required', unknown: false }
      try {
        const r = await apiPay(guestToken()!, scope, idemKey, method)
        if (r.pending && r.intentId) {
          rememberPayIntent(r.intentId)
          // Кнопка «Назад» с сайта эквайера вернёт на проверку, а не на вечное «Проводим оплату»
          patch({ payStage: 'checking', payIntent: r.intentId })
          if (r.confirmationUrl) window.location.assign(r.confirmationUrl)
          return { paid: 0, error: null, unknown: false, redirect: true }
        }
        patch({ lastPaid: r.amount, lastReceipt: r.receipt ?? null })
        return { paid: r.amount, error: null, unknown: false }
      } catch (err) {
        const api = err instanceof ApiError ? err : null
        // Таймаут и обрыв: запрос ушёл, ответа нет. Платёж мог пройти —
        // говорить «деньги не списаны» здесь было бы враньём про чужие деньги.
        const unknown = !api || api.status === 0 || api.status >= 500
        return { paid: 0, error: api ? humanError(api) : 'Не получилось — проверьте связь', unknown, code: api?.error ?? null }
      }
    },
    forgetPayIntent: () => rememberPayIntent(null),
    cancelPay: () =>
      guard(async () => {
        if (!guestToken()) return false
        await apiCancelPay(guestToken()!)
        rememberPayIntent(null)
        patch({ payStage: 'form', payIntent: null })
        return true
      }, false),
    checkPay: async intentId => {
      if (!guestToken()) return { status: 'unknown' }
      try {
        const r = await apiPayStatus(guestToken()!, intentId)
        if (r.status === 'succeeded') {
          rememberPayIntent(null)
          patch({ payStage: 'form', payIntent: null, screen: 'done', lastPaid: r.amount ?? 0, lastReceipt: r.receipt ?? null })
        } else if (r.status === 'canceled') {
          rememberPayIntent(null)
          patch({ payStage: 'failed', payIntent: null, payError: `Платёж не прошёл: ${r.reason ?? 'банк отклонил'}. Деньги не списаны`, payUnknown: false })
        }
        return { status: r.status, confirmationUrl: r.confirmationUrl ?? null }
      } catch (err) {
        // Такой оплаты нет (стол пересел, чужой телефон) — забываем её, а не ждём вечно
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
          rememberPayIntent(null)
          patch({ payStage: 'form', payIntent: null })
        }
        return { status: 'unknown' }
      }
    },
    leaveTip: (amount, idemKey) =>
      guard(async () => {
        if (!guestToken() || amount <= 0) return 0
        // Чаевые — тем же способом, что и оплата; платил наличными — первым
        // включённым в заведении способом с телефона (СБП могут выключить)
        const phone = ['sbp', 'card', 'tpay', 'sber', 'mir']
        const method = phone.includes(ui.payMethod) ? ui.payMethod : SETTINGS.pay.sbp ? 'sbp' : 'card'
        const r = await apiTip(guestToken()!, amount, idemKey, method)
        return r.amount
      }, 0),
    callWaiter: (reason, note) =>
      guard(async () => {
        if (!guestToken()) return
        await apiCall(guestToken()!, reason, note)
        toast(snap?.waiter?.name ? `${snap.waiter.name} подойдёт через пару минут` : 'Официант подойдёт через пару минут')
      }, undefined),
    forgetMe: () => {
      localStorage.removeItem(ID_KEY)
      setIdentity(null)
      setUi(initialUi)
    },
    setAllergies: allergies =>
      guard(async () => {
        if (!guestToken()) return false
        await apiSetAllergies(guestToken()!, allergies)
        toast(allergies.length ? `Аллергии: ${allergies.join(', ')} — кухня увидит` : 'Аллергий нет — отметили')
        return true
      }, false),
    rateVisit: (rating, note) =>
      guard(async () => {
        if (!guestToken()) return false
        await apiRate(guestToken()!, rating, note)
        return true
      }, false),
    leaveTable: () =>
      guard(async () => {
        if (!guestToken()) return false
        await apiLeave(guestToken()!)
        localStorage.removeItem(ID_KEY)
        setIdentity(null)
        // Поток был подписан с токеном — переподписываемся как посторонний
        setStreamKey(k => k + 1)
        setUi(initialUi)
        toast('Вы вышли из-за стола')
        return true
      }, false),
    staff,
    staffChecked,
    shiftTips,
    may: permission => can(staff?.role, permission),
    checkStaff: async () => {
      const who = await apiWhoami()
      // Сервер молчит — держим то, что знали. Выгонять человека из смены можно
      // только по прямому ответу сервера, а не по обрыву связи.
      if (who === 'offline') {
        setStaffChecked(true)
        return
      }
      setStaff(who?.staff ?? null)
      setCachedStaff(who?.staff ?? null)
      setShiftTips(who?.shiftTips ?? 0)
      setStaffChecked(true)
    },
    signInStaff: async (pin: string) => {
      const result = await apiStaffLogin(pin.trim())
      if (!result.ok) return result.status
      clearSignedOut()
      setStaffToken(result.token)
      setStaff(result.staff)
      setCachedStaff(result.staff)
      setStaffChecked(true)
      return 200
    },
    signOutStaff: async () => {
      await apiStaffLogout()
      clearStaff()
      markSignedOut() // чтобы ссылка ?mtoken= не залогинила обратно при обновлении
      setStaff(null)
      setShiftTips(0)
      setStaffChecked(true)
    },
    startLine: uid => staffGuard(() => apiStart(uid, snap?.sessionId ?? '')),
    serveLine: uid => staffGuard(() => apiServe(uid, snap?.sessionId ?? '')),
    ackCall: callId => staffGuard(() => apiAck(callId)),
    closeTable: (force = false) => staffGuard(() => apiClose(force)),
    resetDemo: () =>
      staffGuard(async () => {
        await apiReset()
        localStorage.removeItem(ID_KEY)
        setIdentity(null)
        setUi(initialUi)
      })
  }

  return <StoreCtx.Provider value={ctx}>{children}</StoreCtx.Provider>
}

export function useStore(): Ctx {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}
