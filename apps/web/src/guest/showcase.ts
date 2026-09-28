import showcaseJson from '@easypay/config/showcase.json'
import { CATEGORIES, MENU, findDish } from '../data'
import type { Dish } from '../data'
import { SETTINGS } from '../settings'

/**
 * Витрина гостя 4.x: сезон, гамма, подборки и картинки.
 *
 * Всё, что заведение захочет менять без разработчика, лежит в
 * `packages/config/showcase.json`, а не в коде экранов: подборки, сезонные
 * слайды, обложки. На этапе кабинета этот файл заменит таблица в базе.
 */

export type SeasonKey = 'winter' | 'spring' | 'summer' | 'autumn'
export type PaletteKey = 'soft' | 'pastel' | 'vivid'
export type SectionKind = 'tall' | 'small' | 'list'

interface SeasonConfig {
  title: string
  slides: string[]
  bye: string
}

interface RawSection {
  title: string
  kind: SectionKind
  dishes: string[] | '$season'
}

interface RawCollection {
  id: string
  name: string
  hero: string[] | '$season'
  sections: RawSection[] | '$categories'
}

interface ShowcaseConfig {
  palette: PaletteKey
  season: SeasonKey | 'auto'
  kitchenUntil: string | null
  tall: string[]
  art: Record<'welcome' | 'table' | 'done', string[]>
  seasons: Record<SeasonKey, SeasonConfig>
  collections: RawCollection[]
}

const SHOWCASE = showcaseJson as ShowcaseConfig

export const KITCHEN_UNTIL = SHOWCASE.kitchenUntil

/** Сезон по календарю: заведению не нужно помнить, что пора сменить меню. */
export function currentSeason(now = new Date()): SeasonKey {
  // Сезон, выбранный в кабинете, главнее файла витрины и календаря
  if (SETTINGS.guest.season !== 'auto') return SETTINGS.guest.season
  if (SHOWCASE.season !== 'auto') return SHOWCASE.season
  const m = now.getMonth()
  if (m === 11 || m <= 1) return 'winter'
  if (m <= 4) return 'spring'
  if (m <= 7) return 'summer'
  return 'autumn'
}

export const SEASON_NAME: Record<SeasonKey, string> = {
  winter: 'зима',
  spring: 'весна',
  summer: 'лето',
  autumn: 'осень'
}

/** Подпись меню на тенте: «осеннее меню». */
export const SEASON_MENU: Record<SeasonKey, string> = {
  winter: 'зимнее меню',
  spring: 'весеннее меню',
  summer: 'летнее меню',
  autumn: 'осеннее меню'
}

export function seasonConfig(season: SeasonKey): SeasonConfig {
  return SHOWCASE.seasons[season]
}

/**
 * Гамма: одна светлота и насыщенность на все четыре сезона, меняется только
 * тон. Поэтому тёмный текст на акценте проходит AA в любом сезоне — это
 * проверено в макете, а не угадано.
 */
const PALETTES: Record<PaletteKey, { L: number; C: number; h: Record<SeasonKey, number> }> = {
  soft: { L: 0.8, C: 0.085, h: { autumn: 68, winter: 245, spring: 138, summer: 12 } },
  pastel: { L: 0.86, C: 0.055, h: { autumn: 60, winter: 260, spring: 150, summer: 350 } },
  vivid: { L: 0.74, C: 0.14, h: { autumn: 48, winter: 235, spring: 142, summer: 15 } }
}

/** CSS-переменные корня гостевого экрана для сезона. */
export function seasonVars(season: SeasonKey, palette: PaletteKey = SHOWCASE.palette): Record<string, string> {
  const p = PALETTES[palette]
  const h = p.h[season]
  return {
    '--g-acc': `oklch(${p.L} ${p.C} ${h})`,
    '--g-ink': `oklch(${Math.min(0.92, p.L + 0.07)} ${(p.C * 0.8).toFixed(3)} ${h})`,
    // Фон чуть подкрашен тоном сезона — иначе смена сезона видна только на кнопках
    '--g-paper': `oklch(0.17 0.006 ${h})`,
    '--g-s1': `oklch(0.215 0.007 ${h})`,
    '--g-sand': `oklch(0.27 0.008 ${h})`
  }
}

// ── Картинки ─────────────────────────────────────────────────────────────
// Одна точка, через которую экраны получают адреса картинок: загруженное
// из кабинета фото (лежит в базе), фото из сборки или буква-заглушка.

const TALL = new Set(SHOWCASE.tall)

/**
 * Своё фото блюда: загруженное из кабинета или из сборки. Новое блюдо без
 * фото получает букву названия на тёплом фоне — так договорились в макете.
 */
function ownPhoto(id: string): string | null {
  const dish = findDish(id)
  if (dish?.photoUrl) return dish.photoUrl
  // Блюда нет в меню (сняли, а в счёте осталось) — фото из сборки, если было
  if (!dish || dish.photo) return null
  return letterArt(dish.name)
}

function letterArt(name: string): string {
  const letter = (name.trim()[0] ?? '·').toUpperCase().replace(/[<&>"']/g, '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2f28"/><stop offset="1" stop-color="#1f1a17"/></linearGradient></defs>` +
    `<rect width="400" height="500" fill="url(#g)"/>` +
    `<text x="200" y="300" text-anchor="middle" font-family="Georgia,serif" font-size="200" fill="#e8d9c4" fill-opacity=".55">${letter}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Фото 4:5 для карточек и шторки блюда. */
export function dishPhoto(id: string): string {
  return ownPhoto(id) ?? `./dishes/${id}.jpg`
}

/** Миниатюра для строк 56–76 px: полноразмерное фото там — сотни лишних килобайт. */
export function dishThumb(id: string): string {
  return ownPhoto(id) ?? `./dishes/thumb/${id}.jpg`
}

/** Вертикальный кадр 9:16 для шапки и крупных карточек; если его нет — обычное фото. */
export function dishTall(id: string): string {
  return ownPhoto(id) ?? (TALL.has(id) ? `./hero/${id}.jpg` : dishPhoto(id))
}

export function artSet(kind: 'welcome' | 'table' | 'done'): string[] {
  return SHOWCASE.art[kind].map(name => `./art/${name}.jpg`)
}

// ── Подборки ─────────────────────────────────────────────────────────────

export interface ShowcaseSection {
  title: string
  kind: SectionKind
  dishes: Dish[]
}

export interface Collection {
  id: string
  name: string
  hero: Dish[]
  sections: ShowcaseSection[]
}

const dishes = (ids: string[]): Dish[] => ids.map(findDish).filter((d): d is Dish => !!d)

/**
 * Разворачивает подборки под сезон: `$season` в конфиге — «слайды текущего
 * сезона», `$categories` — всё меню по разделам.
 */
export function collections(season: SeasonKey): Collection[] {
  const se = SHOWCASE.seasons[season]
  return SHOWCASE.collections.map(c => ({
    id: c.id,
    name: c.name === '$season' ? SEASON_NAME[season] : c.name,
    hero: dishes(c.hero === '$season' ? se.slides.slice(0, 3) : c.hero),
    sections:
      c.sections === '$categories'
        ? CATEGORIES.map(cat => ({ title: cat.toLowerCase(), kind: 'list' as const, dishes: MENU[cat] ?? [] }))
        : c.sections.map(s => ({
            title: s.title === '$season' ? se.title : s.title,
            kind: s.kind,
            dishes: dishes(s.dishes === '$season' ? se.slides : s.dishes)
          }))
  }))
}
