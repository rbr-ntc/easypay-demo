// Настройки заведения в памяти процесса: проверка заказа и оплаты не ходит
// в базу. Источник — база (venues.settings), правится из кабинета.
import { applySettings, checkSettings, DEFAULT_SETTINGS, type VenueSettings } from '@easypay/domain/settings'
import { HALL } from './hallplan.ts'

/** Заведение по умолчанию — из плана зала: название уже там. */
const BASE: VenueSettings = { ...DEFAULT_SETTINGS, venue: { ...DEFAULT_SETTINGS.venue, name: String(HALL.restaurant ?? 'Ресторан') } }

let SETTINGS: VenueSettings = BASE
/** Версия — момент сохранения: клиенты по ней понимают, что пора перечитать. */
let VERSION = 1

applySettings(SETTINGS)

export const currentSettings = (): VenueSettings => SETTINGS
export const settingsVersion = (): number => VERSION
export const baseSettings = (): VenueSettings => BASE

export function setSettings(next: VenueSettings, version: number) {
  SETTINGS = next
  VERSION = version
  applySettings(next)
}

/** Сохранённое в базе поверх умолчаний: новые поля схемы получают значение по умолчанию. */
export function restoreSettings(raw: unknown, version: number) {
  const { settings } = checkSettings(raw, BASE)
  setSettings(settings, version)
}

/** Какой тумблер отвечает за способ оплаты с телефона. */
export function phoneMethodAllowed(method: string): boolean {
  const pay = SETTINGS.pay
  return method === 'card' || method === 'mir' ? pay.card : pay.sbp
}
