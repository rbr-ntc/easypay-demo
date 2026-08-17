import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ApiError,
  apiAck,
  apiAddLine,
  apiCall,
  apiClose,
  apiServe,
  apiStaffLogin,
  apiStaffLogout,
  apiWhoami,
  apiJoin,
  apiPay,
  apiRemoveLine,
  apiReset,
  apiSend,
  apiTip,
  subscribe,
  tableId
} from './api'
import type { ServerPersona, Snapshot } from './api'
import { clearStaff, getCachedStaff, setCachedStaff, setStaffToken } from './staff'
import { can } from '../shared/roles.js'
import type { Permission, Staff } from '../shared/roles.js'
import { newIdemKey } from './keys'
import { CATEGORIES, findDish } from './data'
import type { Animal, LineOptions } from './data'
import { amountFor, computeTotals as computeMoney } from '../shared/money.js'

export type Screen = 'welcome' | 'menu' | 'cart' | 'status' | 'payment' | 'tips' | 'done'
export type Sheet = null | 'dish' | 'name' | 'send'
export type PayStage = 'form' | 'qr' | 'processing'
export type PayScope = 'own' | 'equal' | 'full'
export type PayMethod = 'sbp' | 'card' | 'tpay' | 'sber' | 'mir'

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
  menuCat: string
  payScope: PayScope
  payMethod: PayMethod
  payStage: PayStage
  lastPaid: number
  tip: '0' | '5' | '10' | '15' | 'custom'
  tipCustom: number
  rating: number
  sendScope: 'mine' | 'all'
  sendChecked: boolean
  toast: string | null
}

const initialUi: UiState = {
  screen: 'welcome',
  sheet: null,
  currentDishId: null,
  pendingAdd: null,
  menuCat: CATEGORIES[0] ?? '',
  payScope: 'own',
  payMethod: 'sbp',
  payStage: 'form',
  lastPaid: 0,
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
}

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Identity
    return parsed.sessionId && parsed.personaId ? parsed : null
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
  tableTotal: number
  paidTotal: number
  remaining: number
  myPaid: number
  myRemaining: number
  scopeAmount: (scope: PayScope) => number
  personaOwn: (pid: string) => number
  personaPaid: (pid: string) => number
}

// Считает ровно то же, что сервер: модель живёт в shared/money.js в одном экземпляре.
// Клиентские суммы — только для отображения, списывает всегда сервер.
export function computeTotals(snap: Snapshot | null, myId: string | null): Totals {
  const core = computeMoney(snap ?? {}, id => findDish(id)?.price ?? 0)
  return {
    participants: core.participants,
    sharedTotal: core.sharedTotal,
    myOwn: core.ownOf(myId),
    myShare: core.share,
    myTotal: core.totalOf(myId),
    tableTotal: core.tableTotal,
    paidTotal: core.paidTotal,
    remaining: core.remaining,
    myPaid: core.paidOf(myId),
    myRemaining: core.remainingOf(myId),
    scopeAmount: scope => amountFor(core, myId, scope),
    personaOwn: pid => core.ownOf(pid),
    personaPaid: pid => core.paidOf(pid)
  }
}

export function tipAmount(ui: UiState): number {
  if (ui.tip === 'custom') return ui.tipCustom
  if (ui.tip === '0') return 0
  return Math.round((ui.lastPaid * Number(ui.tip)) / 100)
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
  join: (name: string, animal: Animal, idemKey: string) => Promise<ServerPersona | null>
  addLine: (dishId: string, qty: number, shared: boolean, options: LineOptions, asPersonaId?: string) => Promise<void>
  removeLine: (uid: number) => Promise<void>
  sendWave: (scope: 'mine' | 'all') => Promise<void>
  pay: (scope: PayScope, idemKey: string) => Promise<number>
  leaveTip: (amount: number, idemKey: string) => Promise<number>
  callWaiter: (reason: 'help' | 'bill' | 'water') => Promise<void>
  forgetMe: () => void // «Я другой гость» — телефон передали новому человеку
  // смена сотрудника: вход по PIN, права роли
  staff: Staff | null
  staffChecked: boolean
  shiftTips: number
  may: (permission: Permission) => boolean
  checkStaff: () => Promise<void>
  signInStaff: (pin: string) => Promise<boolean>
  signOutStaff: () => Promise<void>
  serveLine: (uid: number) => Promise<boolean>
  ackCall: () => Promise<boolean>
  closeTable: () => Promise<boolean>
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
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => subscribe(setSnap, setConnected), [])

  // На закрытом столе личность недействительна: первое действие гостя
  // должно пройти через join и открыть НОВУЮ сессию
  const me = useMemo(
    () => (snap?.status === 'open' ? snap.personas.find(p => p.id === personaId) ?? null : null),
    [snap, personaId]
  )

  // Сессия сменилась (стол закрыли/сбросили) — локальная личность устарела
  useEffect(() => {
    if (!snap || !identity) return
    if (snap.sessionId !== identity.sessionId || !me) {
      localStorage.removeItem(ID_KEY)
      setIdentity(null)
    }
  }, [snap, identity, me])

  // Стол закрыли, пока гость был в потоке — мягко возвращаем на приветствие
  useEffect(() => {
    if (snap?.status === 'closed' && ui.screen !== 'welcome' && ui.screen !== 'done') {
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

  const guard = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      console.error('api error:', err)
      toast('Не получилось — проверьте связь и попробуйте ещё раз')
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
    join: (name, animal, idemKey) =>
      guard(async () => {
        const r = await apiJoin(name, animal, idemKey)
        const id: Identity = { sessionId: r.snapshot.sessionId ?? '', personaId: r.personaId }
        localStorage.setItem(ID_KEY, JSON.stringify(id))
        setIdentity(id)
        setSnap(r.snapshot)
        return r.snapshot.personas.find(p => p.id === r.personaId) ?? null
      }, null),
    addLine: (dishId, qty, shared, options, asPersonaId) =>
      guard(async () => {
        const pid = asPersonaId ?? personaId
        if (!pid) return
        await apiAddLine(pid, dishId, qty, shared, options, newIdemKey())
      }, undefined),
    removeLine: uid =>
      guard(async () => {
        if (!personaId) return
        await apiRemoveLine(personaId, uid)
      }, undefined),
    sendWave: scope =>
      guard(async () => {
        if (!personaId) return
        await apiSend(personaId, scope)
      }, undefined),
    pay: (scope, idemKey) =>
      guard(async () => {
        if (!personaId) return 0
        const r = await apiPay(personaId, scope, idemKey)
        patch({ lastPaid: r.amount })
        return r.amount
      }, 0),
    leaveTip: (amount, idemKey) =>
      guard(async () => {
        if (!personaId || amount <= 0) return 0
        const r = await apiTip(personaId, amount, idemKey)
        return r.amount
      }, 0),
    callWaiter: reason =>
      guard(async () => {
        if (!personaId) return
        await apiCall(personaId, reason)
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
      setStaff(who?.staff ?? null)
      setCachedStaff(who?.staff ?? null)
      setShiftTips(who?.shiftTips ?? 0)
      setStaffChecked(true)
    },
    signInStaff: async (pin: string) => {
      const result = await apiStaffLogin(pin.trim())
      if (!result) return false
      setStaffToken(result.token)
      setStaff(result.staff)
      setCachedStaff(result.staff)
      setStaffChecked(true)
      return true
    },
    signOutStaff: async () => {
      await apiStaffLogout()
      clearStaff()
      setStaff(null)
      setShiftTips(0)
      setStaffChecked(true)
    },
    serveLine: uid => staffGuard(() => apiServe(uid)),
    ackCall: () => staffGuard(() => apiAck()),
    closeTable: () => staffGuard(() => apiClose()),
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
