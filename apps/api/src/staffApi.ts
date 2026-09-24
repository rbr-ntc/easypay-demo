// Персонал из кабинета: добавить, закрепить столы, сменить PIN, уволить.
//
// PIN придумывает сервер и показывает один раз: так он не совпадёт с чужим
// (вход по PIN не различил бы двух людей) и не будет «1111». В базе — только хеш.
// Удержание долга с официанта здесь не живёт: это отдельная процедура по ТК РФ.

import crypto from 'node:crypto'
import type { Permission } from '@easypay/domain/roles'
import { buildShiftReport } from '@easypay/domain/shift'
import { planTables } from './hallplan.ts'
import { reportOfCheck, windowOf } from './shiftApi.ts'
import {
  activeSessions,
  allStaff,
  applyStaff,
  findStaff,
  hashPin,
  pinTaken,
  STAFF_ROLES,
  type StaffRecord,
  withPinOverrides
} from './staff.ts'
import type { Store } from './store/index.ts'
import type { Actor } from './types.ts'

export interface StaffDeps {
  json: (res: any, code: number, body: unknown) => void
  readBody: (req: any) => Promise<any>
  actorFrom: (req: any, url?: URL | null) => Actor | null
  allowed: (actor: Actor | null, permission: Permission) => boolean
  staffUnauthorized: (req: any) => unknown
  audit: (actor: Actor | null, action: string, tableId: string | null, detail?: string | null, amount?: number | null) => void
  flushAudit: (store: Store) => Promise<void>
  broadcastEverywhere: (store: Store) => Promise<void>
}

const PATHS = new Set(['/api/staff/list', '/api/staff/save', '/api/staff/pin', '/api/staff/active'])
const WEAK = new Set(['0000', '1234', '4321', '1212', '2580', '0852'])

/** Новый PIN: четыре цифры, не занятый и не из очевидных. */
function freshPin(exceptId: string | null): { pin: string; hash: string } {
  for (let i = 0; i < 200; i++) {
    const pin = String(crypto.randomInt(0, 10_000)).padStart(4, '0')
    if (WEAK.has(pin) || /^(\d)\1{3}$/.test(pin)) continue
    const hash = hashPin(pin)
    if (!pinTaken(hash, exceptId)) return { pin, hash }
  }
  throw new Error('не удалось подобрать свободный PIN')
}

/** Сотрудники из базы — при старте сервера. Пусто — работаем по файлу. */
export async function loadStaff(store: Store) {
  const list = await store.staffList()
  if (list?.length) applyStaff(withPinOverrides(list))
}

export function createStaffRoutes(deps: StaffDeps) {
  const { json, readBody, actorFrom, allowed, staffUnauthorized, audit, flushAudit, broadcastEverywhere } = deps

  async function persist(store: Store, rec: StaffRecord) {
    await store.saveStaff(rec)
    const list = allStaff()
    const next = list.some(s => s.id === rec.id) ? list.map(s => (s.id === rec.id ? rec : s)) : [...list, rec]
    applyStaff(next)
    // Имя официанта стоит на карточках зала и в чеках — пусть обновится сразу
    await broadcastEverywhere(store)
  }

  async function listPayload(store: Store) {
    const online = activeSessions()
    const shift = await store.currentShift()
    const win = shift ? await windowOf(store, shift) : undefined
    const report = shift ? buildShiftReport((await store.shiftChecks(300)).map(c => reportOfCheck(c, win))) : null
    const tipsOf = (name: string) => report?.tipsByWaiter.find(t => t.name === name)?.amount ?? 0
    return {
      staff: allStaff().map(s => ({
        id: s.id,
        name: s.name,
        role: s.role,
        tables: s.tables,
        phone: s.phone,
        active: s.active,
        devices: online.filter(o => o.staffId === s.id).map(o => o.device ?? 'устройство'),
        shiftTips: tipsOf(s.name)
      })),
      tables: planTables().map(t => t.id)
    }
  }

  return async function handle(req: any, res: any, url: URL, store: Store): Promise<boolean> {
    const p = url.pathname
    if (!PATHS.has(p)) return false

    const actor = actorFrom(req, url)
    if (!actor) {
      json(res, 401, staffUnauthorized(req))
      return true
    }
    if (!allowed(actor, 'staff')) {
      json(res, 403, { error: 'role not allowed' })
      return true
    }

    if (p === '/api/staff/list' && req.method === 'GET') {
      json(res, 200, await listPayload(store))
      return true
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return true
    }
    const body = await readBody(req)

    if (p === '/api/staff/save') {
      const name = String(body.name ?? '').trim().slice(0, 40)
      const role = String(body.role ?? '')
      const known = new Set(planTables().map(t => t.id))
      const tables: string[] = Array.isArray(body.tables) ? [...new Set<string>(body.tables.map(String))].filter(t => known.has(t)) : []
      const phone = String(body.phone ?? '').replace(/[^\d+()\s-]/g, '').trim().slice(0, 20) || null
      if (!name) {
        json(res, 400, { error: 'name required' })
        return true
      }
      if (!(STAFF_ROLES as readonly string[]).includes(role)) {
        json(res, 400, { error: 'bad role' })
        return true
      }
      const existing = typeof body.id === 'string' ? findStaff(body.id) : null
      if (body.id && !existing) {
        json(res, 404, { error: 'staff not found' })
        return true
      }
      if (existing && existing.id === actor.id && existing.role === 'manager' && role !== 'manager') {
        json(res, 409, { error: 'cannot demote yourself' })
        return true
      }
      if (existing) {
        const rec = { ...existing, name, role, tables: role === 'waiter' ? tables : [], phone }
        await persist(store, rec)
        audit(actor, 'изменил сотрудника', null, `${name} · ${role}${rec.tables.length ? ` · столы ${rec.tables.join(', ')}` : ''}`)
        await flushAudit(store)
        json(res, 200, { ok: true, id: rec.id })
        return true
      }
      const { pin, hash } = freshPin(null)
      const rec: StaffRecord = {
        id: `s-${crypto.randomBytes(4).toString('hex')}`,
        name,
        role,
        tables: role === 'waiter' ? tables : [],
        pinHash: hash,
        active: true,
        phone
      }
      await persist(store, rec)
      audit(actor, 'добавил сотрудника', null, `${name} · ${role}`)
      await flushAudit(store)
      // PIN уходит один раз — менеджер передаёт его человеку; в базе только хеш
      json(res, 200, { ok: true, id: rec.id, pin })
      return true
    }

    const target = typeof body.id === 'string' ? findStaff(body.id) : null
    if (!target) {
      json(res, 404, { error: 'staff not found' })
      return true
    }

    if (p === '/api/staff/pin') {
      if (!target.active) {
        json(res, 409, { error: 'staff inactive' })
        return true
      }
      const { pin, hash } = freshPin(target.id)
      await persist(store, { ...target, pinHash: hash })
      audit(actor, 'сменил PIN', null, target.name)
      await flushAudit(store)
      json(res, 200, { ok: true, pin })
      return true
    }

    if (p === '/api/staff/active') {
      const active = body.active === true
      if (!active && target.id === actor.id) {
        json(res, 409, { error: 'cannot fire yourself' })
        return true
      }
      const managersLeft = allStaff().filter(s => s.active && s.role === 'manager' && s.id !== target.id).length
      if (!active && target.role === 'manager' && managersLeft === 0) {
        json(res, 409, { error: 'last manager' })
        return true
      }
      let rec = { ...target, active }
      // Вернувшемуся — новый PIN: старый мог достаться другому
      let pin: string | undefined
      if (active && !target.active) {
        const fresh = freshPin(target.id)
        rec = { ...rec, pinHash: fresh.hash }
        pin = fresh.pin
      }
      await persist(store, rec)
      audit(actor, active ? 'вернул сотрудника' : 'уволил сотрудника', null, target.name)
      await flushAudit(store)
      json(res, 200, { ok: true, ...(pin ? { pin } : {}) })
      return true
    }

    json(res, 404, { error: 'not found' })
    return true
  }
}
