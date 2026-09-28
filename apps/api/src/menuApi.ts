// Конструктор меню: черновик, публикация и фото блюд.
//
// Менеджер правит черновик сколько угодно — гости его не видят. Публикация
// строго проверяет меню (цена, аллергены), поднимает версию и рассылает
// снимки: гость, кухня и зал получают новое меню без перезагрузки.

import { ALLERGENS } from '@easypay/domain/allergens'
import type { Permission } from '@easypay/domain/roles'
import { applyMenu, checkMenuDoc, currentMenu, stopList, type MenuDoc } from './menu.ts'
import type { Store } from './store/index.ts'
import type { Actor } from './types.ts'

export interface MenuDeps {
  json: (res: any, code: number, body: unknown) => void
  actorFrom: (req: any, url?: URL | null) => Actor | null
  allowed: (actor: Actor | null, permission: Permission) => boolean
  staffUnauthorized: (req: any) => unknown
  audit: (actor: Actor | null, action: string, tableId: string | null, detail?: string | null, amount?: number | null) => void
  flushAudit: (store: Store) => Promise<void>
  broadcastEverywhere: (store: Store) => Promise<void>
}

/** Документ меню — больше обычного запроса: сорок блюд с модификаторами. */
const DOC_LIMIT = 512 * 1024
/** Фото приходит уже сжатым с клиента (4:5, ~300 КБ); запас — на PNG. */
const PHOTO_LIMIT = 400 * 1024
const PHOTO_TYPES = new Set(['image/jpeg', 'image/webp', 'image/png'])
const PHOTO_PATH = /^\/api\/menu\/photo\/([0-9a-f-]{36})$/

/** Заголовок запроса можно подделать — сверяем первые байты файла с заявленным типом. */
function matchesMime(data: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (mime === 'image/png') return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === 'image/webp') return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP'
  return false
}

async function readRaw(req: any, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readDoc(req: any): Promise<unknown> {
  const raw = (await readRaw(req, DOC_LIMIT)).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/** Опубликованное меню из базы — при старте сервера. Битое не ломает запуск. */
export async function loadPublishedMenu(store: Store) {
  const row = await store.menuDoc('published')
  if (!row) return
  const { doc, errors } = checkMenuDoc(row.doc, false)
  if (!doc || errors.length) {
    console.error('опубликованное меню в базе не прошло проверку, работаем по menu.json:', errors.slice(0, 5))
    return
  }
  applyMenu({ ...doc, version: Number(row.doc.version) || 1, publishedAt: Number(row.doc.publishedAt) || row.updatedAt })
}

export function createMenuRoutes(deps: MenuDeps) {
  const { json, actorFrom, allowed, staffUnauthorized, audit, flushAudit, broadcastEverywhere } = deps

  return async function handle(req: any, res: any, url: URL, store: Store): Promise<boolean> {
    const p = url.pathname

    // Гостевое: меню и фото без входа — их видит каждый за столом
    if (p === '/api/menu/live' && req.method === 'GET') {
      json(res, 200, { ...currentMenu(), stop: stopList() })
      return true
    }
    const photoMatch = PHOTO_PATH.exec(p)
    if (photoMatch && req.method === 'GET') {
      const found = await store.photo(photoMatch[1])
      if (!found) {
        json(res, 404, { error: 'photo not found' })
        return true
      }
      // Фото по id не меняется никогда: новое фото — новый id
      res.writeHead(200, {
        'Content-Type': found.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Браузер не должен «угадывать» тип: картинка остаётся картинкой
        'X-Content-Type-Options': 'nosniff'
      })
      res.end(found.data)
      return true
    }

    const editorPaths = ['/api/menu/editor', '/api/menu/draft', '/api/menu/discard', '/api/menu/publish', '/api/menu/photo']
    if (!editorPaths.includes(p)) return false

    const actor = actorFrom(req, url)
    if (!actor) {
      json(res, 401, staffUnauthorized(req))
      return true
    }
    if (!allowed(actor, 'menu')) {
      json(res, 403, { error: 'role not allowed' })
      return true
    }

    try {
      if (p === '/api/menu/editor' && req.method === 'GET') {
        const draft = await store.menuDoc('draft')
        json(res, 200, {
          published: currentMenu(),
          draft: draft ? { categories: draft.doc.categories, updatedAt: draft.updatedAt } : null,
          allergens: ALLERGENS
        })
        return true
      }

      if (p === '/api/menu/draft' && req.method === 'POST') {
        const { doc, errors } = checkMenuDoc(await readDoc(req), false)
        // Черновик принимаем недописанным, но не битым: без id и имён его не собрать обратно
        const broken = errors.filter(e => !e.endsWith('allergens required'))
        if (!doc || broken.length) {
          json(res, 400, { error: 'bad menu', details: broken.slice(0, 10) })
          return true
        }
        await store.saveMenuDoc('draft', doc, actor.id)
        json(res, 200, { ok: true })
        return true
      }

      if (p === '/api/menu/discard' && req.method === 'POST') {
        await store.saveMenuDoc('draft', null, actor.id)
        json(res, 200, { ok: true })
        return true
      }

      if (p === '/api/menu/publish' && req.method === 'POST') {
        const draft = await store.menuDoc('draft')
        if (!draft) {
          json(res, 409, { error: 'no draft' })
          return true
        }
        const { doc, errors } = checkMenuDoc(draft.doc, true)
        if (!doc || errors.length) {
          json(res, 409, { error: 'menu invalid', details: errors.slice(0, 10) })
          return true
        }
        const before = currentMenu()
        const next: MenuDoc = { ...doc, version: before.version + 1, publishedAt: Date.now() }
        await store.saveMenuDoc('published', next, actor.id)
        await store.saveMenuDoc('draft', null, actor.id)
        applyMenu(next)
        const count = next.categories.reduce((n, c) => n + c.dishes.filter(d => !d.hidden).length, 0)
        audit(actor, 'меню опубликовано', null, `версия ${next.version} · блюд: ${count}`)
        await flushAudit(store)
        await broadcastEverywhere(store)
        json(res, 200, { ok: true, version: next.version })
        return true
      }

      if (p === '/api/menu/photo' && req.method === 'POST') {
        const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim()
        if (!PHOTO_TYPES.has(mime)) {
          json(res, 415, { error: 'photo must be jpeg, webp or png' })
          return true
        }
        const data = await readRaw(req, PHOTO_LIMIT)
        if (data.length < 100 || !matchesMime(data, mime)) {
          json(res, 400, { error: 'not an image' })
          return true
        }
        const id = await store.savePhoto(mime, data)
        json(res, 200, { ok: true, url: `/api/menu/photo/${id}` })
        return true
      }
    } catch (err: any) {
      if (err?.status === 413) {
        // Тело дочитано не до конца — соединение повторно использовать нельзя
        res.setHeader('Connection', 'close')
        json(res, 413, { error: 'too large' })
        req.destroy()
        return true
      }
      if (err instanceof SyntaxError) {
        json(res, 400, { error: 'bad json' })
        return true
      }
      throw err
    }

    json(res, 405, { error: 'method not allowed' })
    return true
  }
}
