import menuJson from './menu.json'

export const NAVY = '#1F1D3D'
export const SBP_GRADIENT = 'linear-gradient(118deg,#5A1E9B 0%,#8E2A8C 46%,#E5097F 100%)'

export type Animal = 'fox' | 'bear' | 'panda' | 'raccoon' | 'owl' | 'cat'

export interface Dish {
  id: string
  name: string
  desc: string
  price: number
  stop?: boolean
}

export const MENU = menuJson as Record<string, Dish[]>
export const CATEGORIES = Object.keys(MENU)

export function findDish(id: string): Dish | undefined {
  for (const cat of CATEGORIES) {
    const d = MENU[cat].find(x => x.id === id)
    if (d) return d
  }
  return undefined
}

export const RESTAURANT = 'Времена года'
export const HALL_LABEL = 'Терраса'
export const WAITER_NAME = 'Максим'
