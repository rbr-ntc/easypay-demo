import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ApiError,
  apiAck,
  apiAddLine,
  apiCall,
  apiClose,
  apiServe,
  apiStart,
  apiStaffLogin,
  apiStaffLogout,
  apiWhoami,
  apiJoin,
  apiPay,
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
import type { ServerPersona, Snapshot } from './api'
import { clearSignedOut, clearStaff, getCachedStaff, markSignedOut, setCachedStaff, setStaffToken } from './staff'
import { can } from '@easypay/domain/roles'
import type { Permission, Staff } from '@easypay/domain/roles'
import { newIdemKey } from './keys'
import { CATEGORIES, findDish } from './data'
import type { Animal, LineOptions } from './data'
import { amountFor, computeTotals as computeMoney } from '@easypay/domain/money'

/**
 * Четыре экрана вместо семи.
 *
 * `cart` и `status` слились в `table`: гость не понимал, что уже ушло на
 * кухню, а что ещё нет, потому что ответ был размазан по двум экранам.
 * `welcome` убран — вход по QR ведёт сразу в меню. `tips` стали частью `done`.
 */
export type Screen = 'menu' | 'table' | 'payment' | 'done'
export type Sheet = null | 'dish' | 'name' | 'send' | 'call' | 'allergen'
/** `failed` — банк не подтвердил: деньги не списаны, повтор идёт тем же ключом. */
export type PayStage = 'form' | 'qr' | 'processing' | 'failed'
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
  menuCat: string
  payScope: PayScope
  payMethod: PayMethod
  payStage: PayStage
  /** Что именно ответил банк — гостю нужно объяснение, а не «попробуйте ещё». */
  payError: string | null
  /** Сегмент на экране «Стол»: свой заказ или весь стол. */
  tableTab: 'mine' | 'all'
  /** Апселл показывается один раз после первой подачи, а не во время ожидания. */
  upsellShown: boolean
  lastPaid: number
  /** Чек последней оплаты: номер, время и состав — то, что гость может предъявить. */
  lastReceipt: import('./api').Receipt | null
  tip: '0' | '5' | '10' | '15' | 'custom'
  tipCustom: number
  rating: number
  sendScope: 'mine' | 'all'
  sendChecked: boolean
  toast: string | null
}

const initialUi: UiState = {
  screen: 'menu',
  sheet: null,
  currentDishId: null,
  pendingAdd: null,
  pendingAllergens: null,
  menuCat: CATEGORIES[0] ?? '',
  payScope: 'own',
  payMethod: 'sbp',
  payStage: 'form',
  payError: null,
  tableTab: 'mine',
  upsellShown: false,
  lastPaid: 0,
  lastReceipt: null,
  tip: '10',
  tipCustom: 0,
  rating: 0,
  sendScope: 'mine',
  sendChecked: false,
  toast: null
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

  const scopeAmount = (scope: PayScope) => {
    if (scope === 'full') return remaining
    // Делим то, что ещё не оплачено: сосед мог заплатить свою часть раньше
    if (scope === 'equal') return Math.min(remaining, remaining / participants || 0)
    return Math.min(myRemaining, remaining)
  }

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
    'kitchen pending': 'На кухне ещё готовятся блюда этого стола',
    'unknown allergen': 'Такой аллергии нет в списке — выберите из предложенных',
    'unknown table': 'Такого стола нет в зале — проверьте QR на столе',
    'table full': 'За столом уже максимум гостей',
    'nothing to pay': 'Оплачивать пока нечего',
    'nothing to send': 'Всё уже отправлено на кухню',
    'already cooking': 'Кухня уже готовит это блюдо — отменить не получится',
    'already cancelled': 'Это блюдо уже отменено',
    'already served': 'Это блюдо уже подали',
    'allergen warning': 'В этом блюде есть то, на что вы указали аллергию',
    'signed out elsewhere': 'Вы вошли на другом устройстве — войдите заново',
    'not your table': 'Это стол другого официанта',
    'dish in stop list': 'Это блюдо сегодня закончилось',
    'unknown dish': 'Такого блюда больше нет в меню',
    'bad qty': 'Можно заказать от 1 до 9 порций',
    'tip too large': 'Слишком большие чаевые для этого счёта',
    'bad amount': 'Сумма чаевых указана неверно',
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
  if (ui.tip === 'custom') return ui.tipCustom
  if (ui.tip === '0') return 0
  return Math.round((ui.lastPaid * Number(ui.tip)) / 100)
}

/** Чем закончилась попытка заказать: успехом, аллергеном или отказом сервера. */
export interface AddResult {
  ok: boolean
  allergens?: string[]
}

interface Ctx {
  ui: UiState
  patch: (p: Partial<UiState>) => void
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
    idemKey?: string
  ) => Promise<AddResult>
  removeLine: (uid: number) => Promise<void>
  /** Отменить своё блюдо, пока кухня не взяла его в работу. */
  cancelMine: (uid: number) => Promise<void>
  /** Позвать официанта с наличными: сумма ждёт подтверждения человека. */
  askCash: (scope: PayScope) => Promise<number>
  /** Передумал: снять просьбу, чтобы официант не шёл за деньгами зря. */
  cancelCash: () => Promise<void>
  sendWave: (scope: 'mine' | 'all') => Promise<void>
  /** Способ передаём серверу: иначе в платеже оседает «СБП» на любой выбор гостя. */
  pay: (scope: PayScope, idemKey: string, method?: PayMethod) => Promise<number>
  leaveTip: (amount: number, idemKey: string) => Promise<number>
  callWaiter: (reason: 'help' | 'bill' | 'water', note?: string) => Promise<void>
  forgetMe: () => void // «Я другой гость» — телефон передали новому человеку
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
  const [ui, setUi] = useState<UiState>(initialUi)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity)
  const [staff, setStaff] = useState<Staff | null>(getCachedStaff)
  const [staffChecked, setStaffChecked] = useState(false)
  const [shiftTips, setShiftTips] = useState(0)
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
      if (sawFullSnapshot.current) return
    } else {
      sawFullSnapshot.current = true
    }
    if (snap.limited || snap.sessionId !== identity.sessionId || !me) {
      localStorage.removeItem(ID_KEY)
      setIdentity(null)
    }
  }, [snap, identity, me, streamKey])

  // Стол закрыли, пока гость был в потоке — мягко возвращаем в начало
  useEffect(() => {
    if (snap?.status === 'closed' && ui.screen !== 'menu' && ui.screen !== 'done') {
      setUi(prev => ({ ...initialUi, toast: prev.toast }))
      toastRef.current?.('Стол закрыт. Спасибо, что были с нами!')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.status])

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
    addLine: async (dishId, qty, shared, options, asGuestToken, confirmAllergen = false, idemKey) => {
      const token = asGuestToken ?? guestToken()
      if (!token) return { ok: false }
      try {
        // Без ключа снаружи каждый повтор был бы новым намерением — и семь
        // быстрых нажатий превращались в семь порций
        await apiAddLine(token, dishId, qty, shared, options, idemKey ?? newIdemKey(), confirmAllergen)
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
    sendWave: scope =>
      guard(async () => {
        if (!guestToken()) return
        await apiSend(guestToken()!, scope)
      }, undefined),
    pay: (scope, idemKey, method) =>
      guard(async () => {
        if (!guestToken()) return 0
        const r = await apiPay(guestToken()!, scope, idemKey, method)
        patch({ lastPaid: r.amount, lastReceipt: r.receipt ?? null })
        return r.amount
      }, 0),
    leaveTip: (amount, idemKey) =>
      guard(async () => {
        if (!guestToken() || amount <= 0) return 0
        const r = await apiTip(guestToken()!, amount, idemKey)
        return r.amount
      }, 0),
    callWaiter: (reason, note) =>
      guard(async () => {
        if (!guestToken()) return
        await apiCall(guestToken()!, reason, note)
        toast('Официант уже идёт 👋')
      }, undefined),
    forgetMe: () => {
      localStorage.removeItem(ID_KEY)
      setIdentity(null)
      setUi(initialUi)
    },
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
