import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  apiAddLine,
  apiClose,
  apiJoin,
  apiPay,
  apiRemoveLine,
  apiReset,
  apiSend,
  subscribe,
  tableId
} from './api'
import type { ServerPersona, Snapshot } from './api'
import { findDish } from './data'
import type { Animal } from './data'

export type Screen = 'welcome' | 'menu' | 'cart' | 'status' | 'payment' | 'tips' | 'done'
export type Sheet = null | 'dish' | 'name' | 'send'
export type PayStage = 'form' | 'qr' | 'processing'
export type PayScope = 'own' | 'equal' | 'full'
export type PayMethod = 'sbp' | 'card' | 'tpay' | 'sber' | 'mir'

export interface PendingAdd {
  dishId: string
  qty: number
  shared: boolean
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
  menuCat: 'Основное',
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

export function computeTotals(snap: Snapshot | null, myId: string | null): Totals {
  const personas = snap?.personas ?? []
  const lines = snap?.lines ?? []
  const payments = snap?.payments ?? []
  const participants = Math.max(1, personas.length)
  const price = (l: { dishId: string; qty: number }) => (findDish(l.dishId)?.price ?? 0) * l.qty
  const sharedTotal = lines.filter(l => l.shared).reduce((s, l) => s + price(l), 0)
  const personaOwn = (pid: string) =>
    lines.filter(l => !l.shared && l.personaId === pid).reduce((s, l) => s + price(l), 0)
  const ownAll = lines.filter(l => !l.shared).reduce((s, l) => s + price(l), 0)
  const myShare = sharedTotal / participants
  const myOwn = myId ? personaOwn(myId) : 0
  const myTotal = myOwn + myShare
  const tableTotal = ownAll + sharedTotal
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.max(0, tableTotal - paidTotal)
  const personaPaid = (pid: string) => payments.filter(p => p.personaId === pid).reduce((s, p) => s + p.amount, 0)
  const myPaid = myId ? personaPaid(myId) : 0
  const myRemaining = Math.max(0, myTotal - myPaid)
  const scopeAmount = (scope: PayScope) => {
    if (scope === 'full') return remaining
    if (scope === 'equal') return Math.min(remaining, tableTotal / participants)
    return Math.min(myRemaining, remaining)
  }
  return {
    participants,
    sharedTotal,
    myOwn,
    myShare,
    myTotal,
    tableTotal,
    paidTotal,
    remaining,
    myPaid,
    myRemaining,
    scopeAmount,
    personaOwn,
    personaPaid
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
  join: (name: string, animal: Animal) => Promise<ServerPersona | null>
  addLine: (dishId: string, qty: number, shared: boolean, asPersonaId?: string) => Promise<void>
  removeLine: (uid: number) => Promise<void>
  sendWave: (scope: 'mine' | 'all') => Promise<void>
  pay: (scope: PayScope) => Promise<number>
  closeTable: () => Promise<void>
  resetDemo: () => Promise<void>
  forgetMe: () => void // «Я другой гость» — телефон передали новому человеку
}

const StoreCtx = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ui, setUi] = useState<UiState>(initialUi)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity)
  const personaId = identity?.personaId ?? null
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => subscribe(setSnap, setConnected), [])

  const me = useMemo(
    () => snap?.personas.find(p => p.id === personaId) ?? null,
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

  const ctx: Ctx = {
    ui,
    patch,
    snap,
    connected,
    me,
    totals,
    toast,
    join: (name, animal) =>
      guard(async () => {
        const r = await apiJoin(name, animal)
        const id: Identity = { sessionId: r.snapshot.sessionId ?? '', personaId: r.personaId }
        localStorage.setItem(ID_KEY, JSON.stringify(id))
        setIdentity(id)
        setSnap(r.snapshot)
        return r.snapshot.personas.find(p => p.id === r.personaId) ?? null
      }, null),
    addLine: (dishId, qty, shared, asPersonaId) =>
      guard(async () => {
        const pid = asPersonaId ?? personaId
        if (!pid) return
        await apiAddLine(pid, dishId, qty, shared)
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
    pay: scope =>
      guard(async () => {
        if (!personaId) return 0
        const r = await apiPay(personaId, scope)
        patch({ lastPaid: r.amount })
        return r.amount
      }, 0),
    closeTable: () =>
      guard(async () => {
        await apiClose()
      }, undefined),
    resetDemo: () =>
      guard(async () => {
        await apiReset()
        localStorage.removeItem(ID_KEY)
        setIdentity(null)
        setUi(initialUi)
      }, undefined),
    forgetMe: () => {
      localStorage.removeItem(ID_KEY)
      setIdentity(null)
      setUi(initialUi)
    }
  }

  return <StoreCtx.Provider value={ctx}>{children}</StoreCtx.Provider>
}

export function useStore(): Ctx {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}
