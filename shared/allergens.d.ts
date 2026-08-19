export interface AllergenOptionEffect {
  adds?: string[]
  removes?: string[]
}

export interface AllergenDishOption {
  id: string
  name: string
  choices: string[]
  default?: string
  effects?: Record<string, AllergenOptionEffect>
}

export interface AllergenDish {
  allergens?: string[]
  tags?: string[]
  options?: AllergenDishOption[]
}

export declare const ALLERGENS: string[]
export declare function isAllergen(tag: string): boolean
export declare function dietTagsOf(dish: AllergenDish): string[]
export declare function allergensFor(dish: AllergenDish, options?: Record<string, string>): string[]
export declare function possibleAllergensFor(dish: AllergenDish): string[]
