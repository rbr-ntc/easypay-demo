import { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { BOTS, PARTICIPANTS, SHARED_SEED, findDish } from './data'
import type { Animal } from './data'

export type Screen = 'welcome' | 'menu' | 'cart' | 'status' | 'payment' | 'tips' | 'done'
export type Sheet = null | 'dish' | 'name' | 'send'
export type PayStage = 'form' | 'qr' | 'processing'
export type PayScope = 'own' | 'equal' | 'full'
export type PayMethod = 'sbp' | 'card' | 'tpay' | 'sber' | 'mir'

export interface CartLine {
  uid: number
  dishId: string
  qty: number
  shared: boolean // общее на стол (делится на всех)
  sent: boolean // уже отправлено на кухню (лочится в корзине)
}

export interface State {
  screen: Screen
  sheet: Sheet
  currentDishId: string | null
  me: { name: string; animal: Animal } | null
  lines: CartLine[]
  menuCat: string
  payScope: PayScope
  payMethod: PayMethod
  payStage: PayStage
  paidAmount: number // сколько гость уже оплатил
  tip: '0' | '5' | '10' | '15' | 'custom'
  tipCustom: number
  rating: number
  sendScope: 'mine' | 'all'
  sendChecked: boolean
  toast: string | null
}

const initial: State = {
  screen: 'welcome',
  sheet: null,
  currentDishId: null,
  me: null,
  lines: [],
  menuCat: 'Основное',
  payScope: 'own',
  payMethod: 'sbp',
  payStage: 'form',
  paidAmount: 0,
  tip: '10',
  tipCustom: 0,
  rating: 0,
  sendScope: 'mine',
  sendChecked: false,
  toast: null
}

export type Action =
  | { type: 'patch'; patch: Partial<State> }
  | { type: 'addLine'; dishId: string; qty: number; shared: boolean }
  | { type: 'removeLine'; uid: number }
  | { type: 'sendWave' }
  | { type: 'reset' }

let uidSeq = 1

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch }
    case 'addLine':
      return {
        ...state,
        lines: [
          ...state.lines,
          { uid: uidSeq++, dishId: action.dishId, qty: action.qty, shared: action.shared, sent: false }
        ]
      }
    case 'removeLine':
      return { ...state, lines: state.lines.filter(l => l.uid !== uid(action)) }
    case 'sendWave':
      return { ...state, lines: state.lines.map(l => ({ ...l, sent: true })) }
    case 'reset':
      return { ...initial }
    default:
      return state
  }
}

function uid(a: { uid: number }): number {
  return a.uid
}

const STORAGE_KEY = 'easypay-demo-v1'

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initial
    const saved = JSON.parse(raw) as State
    // Отбрасываем строки с блюдами, которых больше нет в меню (смена меню между версиями)
    saved.lines = (saved.lines ?? []).filter(l => findDish(l.dishId))
    uidSeq = Math.max(1, ...saved.lines.map(l => l.uid + 1))
    // Никогда не восстанавливаем в промежуточных стадиях платежа
    return { ...initial, ...saved, sheet: null, payStage: 'form', toast: null }
  } catch {
    return initial
  }
}

// Производные суммы — всё считается от состояния, никаких хардкодов
export interface Totals {
  myOwn: number
  sharedTotal: number
  myShare: number
  myTotal: number
  botsTotal: number
  tableTotal: number
  remaining: number // неоплаченный остаток по столу
  myRemaining: number // моя неоплаченная часть
  scopeAmount: (scope: PayScope) => number
}

export function computeTotals(state: State): Totals {
  const myOwn = state.lines
    .filter(l => !l.shared)
    .reduce((sum, l) => sum + (findDish(l.dishId)?.price ?? 0) * l.qty, 0)
  const mySharedAdded = state.lines
    .filter(l => l.shared)
    .reduce((sum, l) => sum + (findDish(l.dishId)?.price ?? 0) * l.qty, 0)
  const sharedTotal = SHARED_SEED.reduce((s, x) => s + x.price, 0) + mySharedAdded
  const myShare = sharedTotal / PARTICIPANTS
  const myTotal = myOwn + myShare
  const botsTotal = BOTS.reduce((s, b) => s + b.sum, 0)
  const tableTotal = myOwn + botsTotal + sharedTotal
  const remaining = Math.max(0, tableTotal - state.paidAmount)
  const myRemaining = Math.max(0, myTotal - state.paidAmount)
  const scopeAmount = (scope: PayScope) => {
    // Все опции считаются от НЕОПЛАЧЕННОГО остатка — защита от двойной оплаты
    if (scope === 'own') return Math.min(myRemaining, remaining)
    if (scope === 'equal') return remaining / PARTICIPANTS
    return remaining
  }
  return { myOwn, sharedTotal, myShare, myTotal, botsTotal, tableTotal, remaining, myRemaining, scopeAmount }
}

export function tipAmount(state: State, paidNow: number): number {
  if (state.tip === 'custom') return state.tipCustom
  if (state.tip === '0') return 0
  const pct = Number(state.tip)
  // Чаевые считаются от фактически оплаченной суммы
  return Math.round((paidNow * pct) / 100)
}

interface Ctx {
  state: State
  dispatch: (a: Action) => void
  totals: Totals
  toast: (msg: string) => void
}

const StoreCtx = createContext<Ctx | null>(null)

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (err) {
      // приватный режим Safari и т.п. — демо работает без персиста
    }
  }, [state])

  const totals = useMemo(() => computeTotals(state), [state])

  const toast = (msg: string) => {
    dispatch({ type: 'patch', patch: { toast: msg } })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => dispatch({ type: 'patch', patch: { toast: null } }), 2200)
  }

  return <StoreCtx.Provider value={{ state, dispatch, totals, toast }}>{children}</StoreCtx.Provider>
}

export function useStore(): Ctx {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}
