import creditsJson from '@easypay/config/photo-credits.json'

/**
 * Авторы фотографий блюд. Большинство снимков под CC BY: лицензия требует
 * называть автора в самом продукте, а не только в репозитории, — поэтому
 * данные лежат в конфиге и читаются интерфейсом, а не только документом.
 */
export interface PhotoCredit {
  author: string
  license: string
  licenseUrl: string
  source: string
  page: string
}

const CREDITS: Readonly<Record<string, PhotoCredit>> = creditsJson

export function creditOf(dishId: string): PhotoCredit | null {
  return CREDITS[dishId] ?? null
}

export function allCredits(): readonly [string, PhotoCredit][] {
  return Object.entries(CREDITS)
}

/** «неизвестен» у CC0 — честное «автор не указан», а не пропуск в данных. */
export function authorLabel(credit: PhotoCredit): string {
  return credit.author === 'неизвестен' ? 'автор не указан' : credit.author
}
