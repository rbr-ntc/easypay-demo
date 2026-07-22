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

export const MENU: Record<string, Dish[]> = {
  'Супы': [
    { id: 'tomyam', name: 'Том ям', desc: 'Острый суп с креветками и кокосовым молоком', price: 690 }
  ],
  'Основное': [
    { id: 'padthai', name: 'Пад тай', desc: 'Рисовая лапша с курицей, тамариндом и арахисом', price: 600 },
    { id: 'steak', name: 'Стейк рибай', desc: 'Мраморная говядина, прожарка на выбор', price: 1290 },
    { id: 'springrolls', name: 'Спринг-роллы', desc: 'Хрустящие роллы с овощами, 6 шт', price: 450 },
    { id: 'duck', name: 'Утка по-пекински', desc: 'С блинчиками и соусом хойсин', price: 1490, stop: true }
  ],
  'Пицца': [
    { id: 'margarita', name: 'Пицца «Маргарита»', desc: 'Томаты, моцарелла, свежий базилик', price: 890 }
  ],
  'Напитки': [
    { id: 'lemonade', name: 'Домашний лимонад', desc: 'Мята и лайм, 0,4 л', price: 220 }
  ],
  'Десерты': []
}

export const CATEGORIES = Object.keys(MENU)

export function findDish(id: string): Dish | undefined {
  for (const cat of CATEGORIES) {
    const d = MENU[cat].find(x => x.id === id)
    if (d) return d
  }
  return undefined
}

// Боты за столом — «пришли раньше», их заказы уже на кухне
export interface Bot {
  id: string
  name: string
  animal: Animal
  dishName: string
  sum: number
}

export const BOTS: Bot[] = [
  { id: 'dima', name: 'Дима', animal: 'bear', dishName: 'Пад тай', sum: 600 },
  { id: 'lena', name: 'Лена', animal: 'panda', dishName: 'Стейк рибай', sum: 1290 }
]

// Общие блюда, заказанные столом до прихода гостя
export interface SharedSeed {
  name: string
  price: number
}

export const SHARED_SEED: SharedSeed[] = [
  { name: 'Спринг-роллы', price: 450 },
  { name: 'Лимонад ×3', price: 660 },
  { name: 'Пицца «Маргарита»', price: 890 }
]

export const RESTAURANT = 'Времена года'
export const TABLE_LABEL = 'Стол №12'
export const HALL_LABEL = 'Терраса'
export const WAITER_NAME = 'Максим'
// Все делят общие блюда на троих: 2 бота + гость
export const PARTICIPANTS = 3
