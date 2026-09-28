import { applySettings, DEFAULT_SETTINGS, type VenueSettings } from '@easypay/domain/settings'
import { setRestaurant } from './data'
import { HALL } from './hallConfig'

/**
 * Настройки заведения на клиенте: способы оплаты, чаевые, сезон, пороги
 * тревог. Грузятся до первого кадра вместе с меню и перечитываются, когда в
 * снимке приходит новая версия — менеджер поменял что-то посреди смены.
 */

export let SETTINGS: VenueSettings = { ...DEFAULT_SETTINGS, venue: { ...DEFAULT_SETTINGS.venue, name: HALL.restaurant } }
let VERSION = 0
applySettings(SETTINGS)

const listeners = new Set<() => void>()

export function setSettings(next: VenueSettings, version: number) {
  SETTINGS = next
  VERSION = version
  applySettings(next)
  setRestaurant(next.venue.name || HALL.restaurant)
  for (const fn of listeners) fn()
}

export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let loading: Promise<boolean> | null = null

export function loadSettings(timeoutMs = 3000): Promise<boolean> {
  loading ??= (async () => {
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), timeoutMs)
    try {
      const res = await fetch('/api/settings', { signal: stop.signal })
      if (!res.ok) return false
      const body = (await res.json()) as { settings: VenueSettings; version: number }
      if (!body.settings?.pay) return false
      setSettings(body.settings, body.version)
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
      loading = null
    }
  })()
  return loading
}

export function ensureSettings(version: number | null | undefined) {
  if (typeof version === 'number' && version !== VERSION) void loadSettings()
}
