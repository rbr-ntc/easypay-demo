// Настройки заведения из кабинета. Читать их может каждый — там нет секретов,
// а гостю нужны способы оплаты, чаевые и реквизиты для чека. Менять — менеджер.

import type { Permission } from '@easypay/domain/roles'
import { checkSettings } from '@easypay/domain/settings'
import { currentSettings, restoreSettings, setSettings, settingsVersion } from './settings.ts'
import type { Store } from './store/index.ts'
import type { Actor } from './types.ts'

export interface SettingsDeps {
  json: (res: any, code: number, body: unknown) => void
  readBody: (req: any) => Promise<any>
  actorFrom: (req: any, url?: URL | null) => Actor | null
  allowed: (actor: Actor | null, permission: Permission) => boolean
  staffUnauthorized: (req: any) => unknown
  audit: (actor: Actor | null, action: string, tableId: string | null, detail?: string | null, amount?: number | null) => void
  flushAudit: (store: Store) => Promise<void>
  broadcastEverywhere: (store: Store) => Promise<void>
}

/** Сохранённые настройки — при старте сервера. */
export async function loadSettings(store: Store) {
  const saved = await store.settings()
  if (saved) restoreSettings(saved.doc, saved.savedAt)
}

export function createSettingsRoutes(deps: SettingsDeps) {
  const { json, readBody, actorFrom, allowed, staffUnauthorized, audit, flushAudit, broadcastEverywhere } = deps

  return async function handle(req: any, res: any, url: URL, store: Store): Promise<boolean> {
    if (url.pathname !== '/api/settings') return false

    if (req.method === 'GET') {
      json(res, 200, { settings: currentSettings(), version: settingsVersion() })
      return true
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const actor = actorFrom(req, url)
    if (!actor) {
      json(res, 401, staffUnauthorized(req))
      return true
    }
    if (!allowed(actor, 'settings')) {
      json(res, 403, { error: 'role not allowed' })
      return true
    }
    const body = await readBody(req)
    const { settings, errors } = checkSettings(body.settings, currentSettings())
    if (errors.length) {
      json(res, 400, { error: errors[0], details: errors })
      return true
    }
    const savedAt = await store.saveSettings(settings)
    setSettings(settings, savedAt)
    audit(actor, 'изменил настройки', null, null)
    await flushAudit(store)
    // Способы оплаты, чаевые и пороги должны смениться у всех сразу
    await broadcastEverywhere(store)
    json(res, 200, { ok: true, settings, version: savedAt })
    return true
  }
}
