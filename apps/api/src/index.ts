// EasyPay API: HTTP + SSE. Состояние стола живёт в хранилище (память или Postgres),
// доменные правила — чистые функции над объектом сессии стола.
//
// Порядок любой мутации: загрузили сессию под блокировкой → применили правило →
// сохранили → записали журнал → разослали снапшот. Деньги считает только сервер.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { amountFor, computeTotals, isBillLine, PAY_SCOPES, round2, splitRounded } from '@easypay/domain/money'
import type { PayScope } from '@easypay/domain/money'
import { can, ownsTable } from '@easypay/domain/roles'
import type { Permission } from '@easypay/domain/roles'
import {
  allergensOf,
  applyStopMeta,
  applyStopOverrides,
  checkOptions,
  dishName,
  getDish,
  isStopped,
  menuPayload,
  menuVersion,
  priceOf,
  priceWithOptions,
  setStopOverride,
  stopList
} from './menu.ts'
import { ALLERGENS } from '@easypay/domain/allergens'
import { isKnownTable, seatsOf } from './hallplan.ts'
import { hallPayload, kitchenPayload } from './feeds.ts'
import { createStore, type Store } from './store/index.ts'
import { createShiftRoutes } from './shiftApi.ts'
import { createMenuRoutes, loadPublishedMenu } from './menuApi.ts'
import { createStaffRoutes, loadStaff } from './staffApi.ts'
import { receiptLines, receiptNoOf, receiptNote, venueOfReceipt } from './receipt.ts'
import { createSettingsRoutes, loadSettings } from './settingsApi.ts'
import { currentSettings, phoneMethodAllowed, settingsVersion } from './settings.ts'
import {
  dropSession,
  restoreSessions,
  takeSessionEvents,
  wasRevoked,
  loginAllowed,
  lockoutSeconds,
  loginByPin,
  sessionStaff,
  staffName,
  staffRoster,
  sweepSessions,
  waiterOfTable
} from './staff.ts'
import { createRateLimiter } from './rateLimit.ts'
import { paymentProvider } from './payments/index.ts'
import { cancelIntent, equalInFlight, isReserving, openIntent, pendingPaysOf, reservedTotals, reservedView, settleIntent, startAtProvider, type PayFlowDeps } from './payFlow.ts'
import type { Actor, AuditEntry, Call, MutationResult, PayMethod, Persona, TableSession } from './types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', '..', 'web', 'dist')
const PORT = process.env.PORT || 8787

// --- Хранилище ---
let storePromise: Promise<Store> | null = null
// Стоп-лист живёт в памяти процесса — загружаем его из хранилища один раз при старте
const getStore = () =>
  (storePromise ??= createStore().then(async store => {
    await loadPublishedMenu(store)
    await loadStaff(store)
    // Персонал остаётся в смене после рестарта: сессии поднимаем из базы
    restoreSessions(await store.staffSessions())
    await loadSettings(store)
    applyStopOverrides(await store.stopOverrides())
    const who = await store.stopDetails()
    applyStopMeta(Object.fromEntries(Object.entries(who).map(([id, m]) => [id, { by: staffName(m.by) ?? m.by, at: m.at }])))
    return store
  }))

/** Для тестов и корректного завершения: закрывает подключение хранилища. */
export async function closeStore() {
  if (!storePromise) return
  const store = await storePromise
  storePromise = null
  await store.close()
}

// --- Токен менеджера: сервисный вход, когда PIN-ов ещё нет ---
export const MANAGER_TOKEN = process.env.EASYPAY_MANAGER_TOKEN || crypto.randomBytes(9).toString('base64url')

function tokenMatches(token: unknown): boolean {
  const given = Buffer.from(String(token ?? ''))
  const want = Buffer.from(MANAGER_TOKEN)
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

const hashToken = (token: unknown) => crypto.createHash('sha256').update(String(token)).digest('hex')

/**
 * Кто действует: сотрудник со своей сессией (вход по PIN) или мастер-токен менеджера.
 * EventSource не умеет слать заголовки, поэтому для SSE токен принимаем и из query.
 */
function actorFrom(req: any, url?: URL | null): Actor | null {
  // Токен в адресе — только для чтения потоков: он оседает в истории и логах,
  // и раньше им же можно было менять меню, настройки и персонал (смена №6, Б6)
  const fromQuery = url && req.method === 'GET' && url.pathname.endsWith('/stream') ? url.searchParams.get('token') : null
  const token = req.headers['x-staff-token'] ?? req.headers['x-manager-token'] ?? fromQuery
  if (!token) return null
  if (tokenMatches(token)) return { id: 'token', name: 'Менеджер (токен)', role: 'manager', tables: [], sessionId: null }
  return sessionStaff(token)
}

const allowed = (actor: Actor | null, permission: Permission) => !!actor && can(actor.role, permission)

// --- Журнал ---
// Мутация синхронна, поэтому записи можно копить здесь и сбрасывать после сохранения.
let pendingAudit: AuditEntry[] = []

function audit(
  actor: Actor | null,
  action: string,
  tableId: string | null,
  detail: string | null = null,
  amount: number | null = null,
  guest: { id: string; name: string } | null = null
) {
  pendingAudit.push({
    at: Date.now(),
    staffId: actor?.id ?? null,
    // Гость — тоже автор действия, и в споре о деньгах важно знать, какой именно
    guestId: guest?.id ?? null,
    name: actor?.name ?? guest?.name ?? 'Гость',
    role: actor?.role ?? null,
    sessionId: actor?.sessionId ?? null,
    action,
    tableId: tableId ?? null,
    detail,
    amount
  })
}

async function flushAudit(store: Store) {
  const entries = pendingAudit
  pendingAudit = []
  for (const entry of entries) await store.audit(entry)
  // Входы, выходы и увольнения — туда же: сессии переживают рестарт сервера
  const events = takeSessionEvents()
  if (events.length) {
    try {
      await store.applySessionEvents(events)
    } catch (err) {
      console.error('сессии персонала не записались в базу:', err)
    }
  }
}

// --- Потоки SSE ---
const streams = new Map<string, Set<http.ServerResponse>>()
const hallStreams = new Set<http.ServerResponse>()
const kitchenStreams = new Set<http.ServerResponse>()
const idempotency = new Map<string, { at: number; status: number; body: Record<string, unknown> }>()
// Запросы с одним ключом, пришедшие одновременно, ждут первый и получают его
// ответ. Кеш отвечает на повтор ПОСЛЕ выполнения, эта карта — на повтор ВО ВРЕМЯ.
const inFlight = new Map<string, Promise<MutationResult>>()

const MAX_STREAMS_PER_TABLE = 50
const MAX_STAFF_STREAMS = 20
const MAX_IDEM = 2000
const IDEM_TTL = 10 * 60 * 1000
const MAX_CALLS = 5
/** Больше четырёх стульев к столу не приставить — это уже другой стол. */
const MAX_EXTRA_SEATS = 4
const MAX_LINES = 200

const sweeper = setInterval(() => {
  const cutoff = Date.now() - IDEM_TTL
  for (const [key, rec] of idempotency) if (rec.at < cutoff) idempotency.delete(key)
  sweepSessions()
}, 10 * 60 * 1000)
sweeper.unref()

function idemRemember(key: string, status: number, body: Record<string, unknown>) {
  if (idempotency.size >= MAX_IDEM) {
    const oldest = idempotency.keys().next().value
    if (oldest) idempotency.delete(oldest)
  }
  idempotency.set(key, { at: Date.now(), status, body })
}

/** Открывает новую сессию прямо в объекте: хранилище не должно подменять ссылки. */
function openSessionInPlace(t: TableSession) {
  // Новая посадка — всегда новая сессия. Раньше при переоткрытии стола сюда
  // попадал id ЗАКРЫТОЙ сессии из базы: клиент не видел расхождения, не забывал
  // мёртвую личность и упирался в «unknown guest» на каждом действии.
  t.sessionId = crypto.randomUUID()
  t.status = 'open'
  t.openedAt = Date.now()
  t.closedAt = null
  t.personas = []
  t.lines = []
  t.payments = []
  t.tips = []
  t.calls = []
  // Принятые вызовы прошлой посадки новым гостям не показываем
  t.callAcks = []
  t.ratings = []
  t.extraSeats = 0
  // Поздние оплаты прошлой посадки новому столу не принадлежат: их заморозку снимет эквайер-поток
  t.payIntents = []
  t.seq = 1
  t.overpaid = 0
  if (t.db) t.db.sessionUuid = null // в БД это будет новая строка сессии
}

/** Публичная позиция: без внутренних полей, зато с названием блюда. */
function publicLine(line: any) {
  return {
    uid: line.uid,
    dishId: line.dishId,
    name: dishName(line.dishId),
    qty: line.qty,
    price: line.price,
    options: line.options ?? {},
    // Состав с учётом модификаторов: гость должен иметь возможность перепроверить,
    // что он съест, уже после отправки на кухню
    allergens: allergensOf(line.dishId, line.options ?? {}),
    comment: line.comment ?? null,
    shared: !!line.shared,
    sharedWith: line.sharedWith ?? [],
    personaId: line.personaId,
    sent: !!line.sent,
    served: !!line.served,
    cancelled: !!line.cancelled,
    cancelReason: line.cancelReason ?? null,
    sentAt: line.sentAt ?? null,
    startedAt: line.startedAt ?? null,
    readyAt: line.readyAt ?? null,
    servedAt: line.servedAt ?? null
  }
}

/**
 * Снапшот стола. Секреты гостей наружу не уходят, зато уходят ИТОГИ: гость должен
 * видеть ровно те числа, которые спишет сервер, а не считать их сам.
 */
function snapshot(t: TableSession, id: string) {
  const money = computeTotals(t, priceOf)
  const nameOf = (pid: string) => t.personas.find(p => p.id === pid)?.name ?? 'Гость'

  return {
    tableId: id,
    sessionId: t.sessionId,
    status: t.status,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    // Что сейчас нельзя заказать: кухня выключает блюда тумблером
    stop: stopList(),
    // Версия меню: сменилась — клиент перечитывает меню после публикации
    menuVersion: menuVersion(),
    // То же для настроек: способы оплаты и чаевые меняются посреди ужина
    settingsVersion: settingsVersion(),
    personas: t.personas.map(p => ({
      id: p.id,
      name: p.name,
      animal: p.animal,
      joinedAt: p.joinedAt,
      allergies: p.allergies ?? []
    })),
    lines: t.lines.map(publicLine),
    payments: t.payments.map(p => ({
      personaId: p.personaId,
      amount: p.amount,
      scope: p.scope,
      at: p.at,
      method: p.method ?? 'sbp',
      // Кто физически взял наличные — вечером по этому имени сверяют кассу
      takenByName: p.takenByName ?? staffName(p.takenBy),
      receiptNo: p.receiptNo ?? null,
      lines: p.lines ?? []
    })),
    tips: t.tips.map(x => ({ personaId: x.personaId, amount: x.amount, at: x.at, waiterId: x.waiterId })),
    // Принятые вызовы за последние 15 минут: гость видит, кто к нему идёт
    acked: (t.callAcks ?? [])
      .filter(a => Date.now() - a.at < 15 * 60 * 1000)
      .map(a => ({ id: a.id, personaId: a.personaId, reason: a.reason, at: a.at, by: a.byName, reply: a.reply ?? null })),
    // Кто сейчас платит через эквайера — сумма зарезервирована, стол ждёт
    payPending: pendingPaysOf(t),
    // Суммы «к оплате» с учётом оплат в пути — ими экран считает кнопку, как сервер
    reserved: pendingPaysOf(t).length ? reservedView(t) : null,
    // Эквайер подключён: оплата уходит на страницу ЮKassa, а не записывается сразу
    acquiring: paymentProvider()?.name ?? null,
    // Кто уже оценил — чтобы не спрашивать дважды. Саму оценку соседям не показываем
    rated: (t.ratings ?? []).map(r => r.personaId),
    calls: t.calls.map(c => ({
      id: c.id,
      at: c.at,
      personaId: c.personaId,
      reason: c.reason,
      note: c.note ?? null,
      repeats: c.repeats ?? 1,
      lastAt: c.lastAt ?? c.at,
      name: nameOf(c.personaId)
    })),
    call: t.calls[0] ? { ...t.calls[0], name: nameOf(t.calls[0].personaId) } : null,
    waiter: waiterOfTable(id),
    // «Хочу наличными»: официант подойдёт и подтвердит приём денег
    // Сумму просьбы пересчитываем на каждый снапшот от текущего остатка: она
    // замерзала в момент нажатия, а списывалась актуальная. Сосед доплачивал,
    // пока официант шёл, — гость читал 1 200 ₽, официант брал 1 200 ₽,
    // а проводилось 300 ₽.
    cashIntent: t.cashIntent
      ? { ...t.cashIntent, amount: round2(amountFor(money, t.cashIntent.personaId, t.cashIntent.scope as PayScope)) }
      : null,
    seats: seatsOf(id) + (t.extraSeats ?? 0),
    totals: {
      tableTotal: round2(money.tableTotal),
      paidTotal: round2(money.paidTotal),
      remaining: round2(money.remaining),
      // Заплатили больше, чем осталось в счёте (например, блюдо отменили после
      // оплаты) — эти деньги надо вернуть, и видно это должно быть сразу
      overpaid: round2(Math.max(0, money.paidTotal - money.tableTotal)),
      // Переплата, оставшаяся к возврату, и уже отданное: возврат — движение
      // денег наружу, и он обязан быть виден там же, где виден долг
      toRefund: round2(t.overpaid ?? 0),
      refunded: round2((t.refunds ?? []).reduce((sum, r) => sum + r.amount, 0)),
      sharedTotal: round2(money.sharedTotal),
      draftTotal: round2(money.draftTotal),
      byPersona: (() => {
        // Округляем не по отдельности, а так, чтобы суммы сходились со столом:
        // иначе гость видит доли, которые в сумме не равны счёту
        const ids = t.personas.map(p => p.id)
        // Хвост округления раскладываем ОДИН раз — на долях общих блюд. Всё
        // остальное выводится из них, поэтому «своё + доля» у гостя всегда
        // равно его счёту, а остаток — счёту минус оплаченное. Раньше доли и
        // итоги округлялись независимо: гость видел долю 163,34 при остатке 163,33.
        const shares = splitRounded(ids.map(id => money.shareOf(id)), round2(money.sharedTotal))
        return t.personas.map((p, i) => {
          const own = round2(money.ownOf(p.id))
          const total = round2(own + shares[i])
          const paid = round2(money.paidOf(p.id))
          return {
            personaId: p.id,
            own,
            share: shares[i],
            total,
            paid,
            // Остаток берём из денежной модели, а не считаем здесь заново:
            // именно это число списывается при оплате, и оно уже учитывает
            // переплату соседа за стол
            remaining: round2(money.remainingOf(p.id)),
            draft: round2(money.draftOf(p.id))
          }
        })
      })()
    }
  }
}

/**
 * Что видно постороннему: стол существует, занят или свободен, сколько мест.
 * Ни имён, ни блюд, ни денег — гость по QR должен понять, куда он сел,
 * а не прочитать выписку по соседям.
 */
function publicStub(t: TableSession, id: string) {
  return {
    tableId: id,
    sessionId: null,
    // Меню смотрят и до того, как представились: «закончилось» нужно и им
    stop: stopList(),
    menuVersion: menuVersion(),
    settingsVersion: settingsVersion(),
    status: t.status,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    // У закрытого стола прошлые гости уже не при чём: постороннему незачем
    // знать, сколько человек тут сидело до него
    occupied: t.status === 'open' ? t.personas.length : 0,
    seats: seatsOf(id),
    personas: [],
    lines: [],
    payments: [],
    tips: [],
    calls: [],
    call: null,
    waiter: null,
    limited: true,
    totals: { tableTotal: 0, paidTotal: 0, remaining: 0, sharedTotal: 0, draftTotal: 0, byPersona: [] }
  }
}

/** Гость этого стола — тот, чей секрет совпал с одной из персон сессии. */
function guestOf(t: TableSession, token: unknown): Persona | null {
  if (!token) return null
  const hash = hashToken(token)
  return t.personas.find(p => p.secretHash === hash) ?? null
}

/**
 * Права персонала на поток перепроверяются на каждой рассылке: раньше токен
 * смотрели только при подключении, и вышедший или уволенный продолжал получать
 * зал, кухню и счета гостей, пока не закроет вкладку (смена №6, Б3).
 */
function stillEntitled(res: any): boolean {
  return typeof res.epRecheck !== 'function' || res.epRecheck()
}

function pushTo(subscribers: Set<any>, payload: unknown) {
  if (subscribers.size === 0) return
  const data = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of subscribers) {
    try {
      if (!stillEntitled(res)) {
        subscribers.delete(res)
        res.end()
        continue
      }
      res.write(data)
    } catch {
      subscribers.delete(res)
    }
  }
}

/** Кухня плюс признак смены: повару 403 на /api/shift, а знать, идёт ли смена, нужно. */
async function kitchenNow(store: Store) {
  const [tables, current] = await Promise.all([store.activeSessions(), store.currentShift()])
  return { ...kitchenPayload(tables), shiftOpen: !!current }
}

/** Зал целиком: столы плюс смена — открыта ли она сейчас, видно в шапке кабинета. */
async function hallNow(store: Store) {
  const [tables, shift, current] = await Promise.all([store.activeSessions(), store.shift(), store.currentShift()])
  // Смена закрыта — в шапке зала нечего показывать: раньше там оставались
  // чаевые прошлой смены, а «начало» каждый запрос становилось «сейчас»
  const shown = current ? shift : { ...shift, revenue: 0, closedRevenue: 0, debt: 0, overpaid: 0, tipsByStaff: {} }
  return {
    ...hallPayload(tables, { ...shown, open: !!current, startedAt: current?.openedAt ?? null }),
    // Пороги тревог и напоминание о закрытии — из настроек заведения
    settingsVersion: settingsVersion()
  }
}

/** Стоп-лист поменялся — он в снимке у каждого стола, где кто-то смотрит меню. */
async function broadcastEverywhere(store: Store) {
  for (const id of [...streams.keys()]) if (streams.get(id)?.size) await broadcast(store, id)
  // Столов без подписчиков нет — зал и кухня всё равно должны узнать
  if (streams.size === 0 || ![...streams.values()].some(s => s.size)) {
    if (hallStreams.size > 0) pushTo(hallStreams, await hallNow(store))
    if (kitchenStreams.size > 0) pushTo(kitchenStreams, await kitchenNow(store))
  }
}

async function broadcast(store: Store, id: string) {
  const subs = streams.get(id)
  if (subs?.size) {
    const session = await store.read(id)
    const full = snapshot(session, id)
    const stub = publicStub(session, id)
    for (const res of subs) {
      try {
        const r = res as any
        // Сотрудник вышел или уволен — поток закрываем, а не показываем пустой стол
        if (r.epStaff && !stillEntitled(r)) {
          subs.delete(res)
          res.end()
          continue
        }
        const stillFull = r.epFullView && (r.epStaff || !!guestOf(session, r.epGuestToken))
        // Был своим, перестал (убрали, стол пересел): говорим прямо, чтобы
        // клиент забыл личность, а не принял это за запоздавший кадр
        const view = stillFull ? full : r.epFullView ? { ...stub, revoked: true } : stub
        res.write(`data: ${JSON.stringify(view)}\n\n`)
      } catch {
        subs.delete(res)
      }
    }
  }
  if (hallStreams.size > 0) pushTo(hallStreams, await hallNow(store))
  if (kitchenStreams.size > 0) pushTo(kitchenStreams, await kitchenNow(store))
}

// --- HTTP helpers ---
/** 401 с причиной: «вас вытеснили» и «вы не вошли» — разные вещи для человека. */
function staffUnauthorized(req: any) {
  return wasRevoked(req.headers['x-staff-token'])
    ? { error: 'signed out elsewhere', hint: 'вы вошли на другом устройстве — войдите заново' }
    : { error: 'staff login required' }
}

function json(res: any, code: number, obj: unknown) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readBody(req: any): Promise<any> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64 * 1024) throw new Error('body too large')
  }
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
  return parsed
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
}

async function serveStatic(req: any, res: any, pathname: string) {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('dist not built')
    return
  }
  let filePath = path.normalize(path.join(DIST, pathname === '/' ? 'index.html' : pathname))
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  if (!existsSync(filePath)) filePath = path.join(DIST, 'index.html')
  try {
    const data = await readFile(filePath)
    const ext = path.extname(filePath)
    // Хешированные бандлы кэшируются вечно, index.html — всегда перепроверяется
    const hashed = filePath.includes(`${path.sep}assets${path.sep}`)
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

// --- Валидация входа ---
const NAME_MAX = 30
const ANIMALS = new Set(['fox', 'bear', 'panda', 'raccoon', 'owl', 'cat'])
const TABLE_RE = /^[A-Za-z0-9_-]{1,24}$/
const STAFF_ACTIONS = new Set([
  'serve', 'ready', 'start', 'close', 'reset', 'ack', 'dismiss', 'clean', 'cash', 'refund', 'removeGuest', 'addSeat', 'addLine'
])
const GUEST_ACTIONS = new Set([
  'lines', 'remove', 'send', 'pay', 'tip', 'call', 'cancelMine', 'cashIntent', 'cancelCash', 'leave', 'allergies', 'rate', 'cancelPay'
])
const IDEMPOTENT_ACTIONS = new Set(['join', 'lines', 'pay', 'tip', 'refund', 'addLine'])
const CALL_REASONS = new Set(['help', 'bill', 'water'])
const PAY_METHODS = new Set(['sbp', 'card', 'cash'])
// send говорит mine/all, pay — own/full. Принимаем оба словаря, чтобы разница
// между соседними ручками не стоила гостю ошибки
const PAY_SCOPE_ALIASES: Record<string, PayScope> = { mine: 'own', all: 'full' }
const MAX_QTY = 9

/**
 * Тег целиком, а не только скобки: «<img src=x onerror=…> без лука» → «без лука».
 * Только ЗАКРЫТЫЙ тег: одинокое «<» («соли <5 г, орехи нельзя!») раньше
 * съедало остаток текста — вместе с предупреждением об аллергии.
 */
const TAGS = /<[^<>]*>/g

function sanitizeName(name: unknown): string {
  return String(name ?? '')
    .replace(TAGS, '')
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, NAME_MAX)
}

const NOTE_MAX = 200

/** Заметка гостя: живой текст, но без разметки и управляющих символов. */
function sanitizeNote(note: unknown): string | null {
  // Только строка: объект превращался в «[object Object]» у гостя и в журнале
  if (typeof note !== 'string') return null
  const clean = note
    .replace(TAGS, ' ')
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, NOTE_MAX)
  return clean.length > 0 ? clean : null
}

const asId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null)
const asUid = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): MutationResult => ({
  status,
  body: { error, ...extra }
})
const ok = (body: Record<string, unknown> = { ok: true }): MutationResult => ({ status: 200, body })

/** Отменяет всё, что висит на кухне: повар должен узнать, что блюдо больше не нужно. */
function cancelPending(table: TableSession, reason: string, actor: Actor | null): { count: number; amount: number } {
  const now = Date.now()
  let count = 0
  let amount = 0
  for (const line of table.lines) {
    if (line.sent && !line.served && !line.cancelled) {
      line.cancelled = true
      line.cancelledAt = now
      // Один ярлык на два разных случая вводил в заблуждение и повара, и
      // управляющую: блюдо, снятое с огня, — это испорченный продукт, а
      // нетронутое из очереди готовить просто не начинали. Потери разные.
      line.cancelReason = line.startedAt ? `${reason}, снято с плиты` : `${reason}, не начинали`
      line.cancelledBy = actor?.id ?? null
      count += 1
      amount += line.price * line.qty
    }
  }
  return { count, amount: round2(amount) }
}

// --- Мутации: чистые функции над сессией стола ---
export function mutate(
  t: TableSession,
  tableId: string,
  action: string,
  body: any,
  actor: Actor | null,
  req: any
): MutationResult {
  // Действие должно относиться к текущей сессии стола: uid переиспользуются после закрытия.
  // Гостю и персоналу нужны разные слова: сотрудник просто перезагрузит экран,
  // а гость с полной тарелкой должен понять, что стол закрыли и надо позвать человека.
  if (body.sessionId && t.sessionId && body.sessionId !== t.sessionId) {
    // Номер новой посадки — только персоналу: заглушка стола его прячет, и 409
    // не должен выдавать его постороннему (смена №6, Б17)
    return fail(409, actor ? 'stale session' : 'session ended', actor ? { sessionId: t.sessionId } : {})
  }

  if (STAFF_ACTIONS.has(action)) return staffAction(t, tableId, action, body, actor)
  if (action === 'join') return joinGuest(t, tableId, body)
  if (!GUEST_ACTIONS.has(action)) return fail(404, 'unknown action')

  // Гостевые действия: только владелец персоны, по личному токену из join
  const token = req.headers['x-guest-token'] ?? body.guestToken
  if (!token) return fail(401, 'guest token required')
  const hash = hashToken(token)
  const persona = t.personas.find(p => p.secretHash === hash)
  if (!persona) {
    // Стол умирает двумя способами, и гость переживает их по-разному. На сбросе
    // позиции остаются с читаемой причиной, а на пересоздании сессии тот же
    // токен получал голое «unknown guest» — техническую фразу вместо объяснения.
    // Гость с полной тарелкой видел приложение, которое утверждает, что его тут нет.
    const stale = body.sessionId && t.sessionId && body.sessionId !== t.sessionId
    if (stale || t.status !== 'open') {
      return fail(409, 'session ended')
    }
    return fail(403, 'unknown guest')
  }
  if (body.personaId && body.personaId !== persona.id) return fail(403, 'not your persona')
  // Чаевые — исключение: гость ещё сидит за столом, даже если зал уже его закрыл.
  // Иначе окно для благодарности схлопывается в ноль секунд ровно у того, кто
  // заплатил за всех, — а чаевые идут официанту мимо счёта и ничего не ломают.
  const TIP_AFTER_CLOSE_MS = 30 * 60_000
  const justClosed = t.status === 'closed' && t.closedAt && Date.now() - t.closedAt < TIP_AFTER_CLOSE_MS
  // Чаевые и оценку оставляют и после закрытия стола — гость ещё на экране «Спасибо»
  // Повтор уже прошедшей оплаты (обрыв связи, а официант тем временем закрыл стол)
  // получает свой чек, а не «стол закрыт» — иначе гость думает, что деньги пропали
  const replayOfPaid =
    action === 'pay' && !!asId(body.idemKey) && t.payments.some(p => p.idemKey === `${persona.id}:${asId(body.idemKey)}`)
  if (t.status !== 'open' && !((action === 'tip' || action === 'rate' || replayOfPaid) && justClosed)) return fail(409, 'table closed')

  return guestAction(t, tableId, action, body, persona)
}

function joinGuest(t: TableSession, tableId: string, body: any): MutationResult {
  if (!isKnownTable(tableId)) return fail(404, 'unknown table')

  // Сначала все проверки, только потом открытие сессии: упавший join не должен
  // оставлять ресторану «занятый» стол без единого гостя
  if (body.animal !== undefined && !ANIMALS.has(body.animal)) {
    return fail(400, 'unknown animal', { allowed: [...ANIMALS] })
  }
  const seats = seatsOf(tableId) + (t.status === 'open' ? (t.extraSeats ?? 0) : 0)
  const seated = t.status === 'open' ? t.personas.length : 0
  if (seated >= seats) return fail(400, 'table full', { seats })

  // Молчаливое выбрасывание чужого значения — та же болезнь, что была у /call:
  // гость пишет «молоко», система оставляет пустой список, и оба уверены,
  // что предупреждение сделано. Лучше честная ошибка со списком.
  // Не список — тоже ошибка: строка «лактоза» раньше давала пустой список и
  // гостя без защиты, хотя он честно указал аллергию
  if (body.allergies !== undefined && body.allergies !== null && !Array.isArray(body.allergies)) {
    return fail(400, 'allergies must be a list', { allowed: ALLERGENS })
  }
  const rawAllergies: unknown[] = Array.isArray(body.allergies) ? (body.allergies as unknown[]) : []
  const unknownAllergies = rawAllergies.filter(a => typeof a !== 'string' || !ALLERGENS.includes(a))
  if (unknownAllergies.length > 0) {
    return fail(400, 'unknown allergen', { unknown: unknownAllergies.map(String), allowed: ALLERGENS })
  }
  const allergies: string[] = [...new Set(rawAllergies as string[])]

  if (t.status !== 'open') openSessionInPlace(t)

  // Аллергии гостя: только значения из справочника, чужое молча не принимаем
  const name = sanitizeName(body.name) || `Гость ${t.personas.length + 1}`
  const animal = ANIMALS.has(body.animal) ? body.animal : 'fox'

  // Токен показываем один раз, в базе живёт только его хеш
  const guestToken = crypto.randomBytes(18).toString('base64url')
  const persona: Persona = {
    id: crypto.randomUUID(),
    name,
    animal,
    joinedAt: Date.now(),
    allergies,
    secretHash: hashToken(guestToken)
  }
  t.personas.push(persona)
  audit(null, 'сел за стол', tableId, name, null, persona)
  return ok({ personaId: persona.id, guestToken, snapshot: snapshot(t, tableId) })
}

/**
 * Убрать гостя со стола — второй вход с того же телефона, чужое имя. Только
 * если за ним ничего нет: ни отправленных блюд, ни платежей, ни чаевых. Его
 * доля в общих блюдах переходит к остальным: он их не ел. Раньше такой
 * «призрак» навсегда входил в делёж и в число гостей смены.
 */
/** После оплаты: снять «счёт» с расплатившегося, а когда закрыт весь стол — и просьбу о наличных. */
function clearAfterPay(t: TableSession, persona: Persona | null): number {
  const paidNow = computeTotals(t, priceOf)
  const left = round2(paidNow.remaining)
  // Гость расплатился за себя — его «счёт» снимаем сразу, не дожидаясь всего стола
  if (persona && paidNow.remainingOf(persona.id) <= 0.01) {
    t.calls = settleBillCalls(t.calls, c => c.personaId === persona!.id)
  }
  // Причина вызова исчезла — снимаем его сам, иначе официант идёт с папкой
  // к гостю, который уже расплатился, а красный чип приучает игнорировать зал
  if (left <= 0.01) {
    t.calls = settleBillCalls(t.calls, () => true)
    // И просьба о наличных тоже: гость передумал и заплатил телефоном,
    // а официант всё ещё шёл к нему за купюрами, и стол горел красным
    t.cashIntent = null
  }
  return left
}

/** Журнал мутации — только если транзакция прошла (см. маршрут стола). */
async function withTableAudited(store: Store, tableId: string, apply: (t: TableSession) => MutationResult): Promise<MutationResult> {
  let own: AuditEntry[] = []
  const result = await store.withTable(tableId, session => {
    const before = pendingAudit
    pendingAudit = []
    try {
      return apply(session)
    } finally {
      own = pendingAudit
      pendingAudit = before
    }
  })
  for (const entry of own) await store.audit(entry)
  return result
}

function payDeps(store: Store): PayFlowDeps {
  return {
    read: id => store.read(id),
    withTable: (id, apply) => withTableAudited(store, id, apply),
    after: async id => {
      await flushAudit(store)
      await broadcast(store, id)
    },
    onPaid: (t, persona) => void clearAfterPay(t, persona),
    audit: (action, tableId, detail, amount, persona) => audit(null, action, tableId, detail, amount, persona)
  }
}

/** Куда эквайер вернёт гостя после оплаты: адрес стенда, а не внутренний порт. */
function publicUrlOf(req: any): string | null {
  if (process.env.EASYPAY_PUBLIC_URL) return process.env.EASYPAY_PUBLIC_URL.replace(/\/$/, '')
  // С эквайером адрес возврата берём только из настроек: Host присылает клиент,
  // и чужой домен в return_url превратил бы нашу ссылку на оплату в фишинг
  if (paymentProvider() && !process.env.EASYPAY_ALLOW_HOST_RETURN) return null
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
  const proto = String(req.headers['x-forwarded-proto'] ?? (req.socket.encrypted ? 'https' : 'http'))
  return `${proto}://${host}`
}

/** Кто-то заплатил «поровну» — дальше только поровну или весь стол (правило 6), и наличными тоже. */
function equalLocked(t: TableSession): boolean {
  return t.payments.some(p => p.scope === 'equal') || equalInFlight(t)
}

/**
 * Оплатили — вызов «счёт» снимается. Но в склеенном вызове под «счётом» мог
 * лежать текст «аллергия, подойдите»: такой вызов остаётся просьбой о помощи.
 */
function settleBillCalls(calls: Call[], paidBy: (c: Call) => boolean): Call[] {
  return calls.flatMap(c => (c.reason === 'bill' && paidBy(c) ? (c.note ? [{ ...c, reason: 'help' }] : []) : [c]))
}

/** Ключ согласия с аллергеном: кто именно согласился и на что. */
const okKey = (personaId: string, allergen: string) => `${personaId}:${allergen}`

/** Число из тела запроса — только число: `true` и `[10]` раньше молча становились 1 и 10. */
function numberOf(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  return typeof value === 'number' ? value : Number.NaN
}

function removePersona(t: TableSession, persona: Persona): string | null {
  const ownSent = t.lines.some(l => l.personaId === persona.id && l.sent && !l.cancelled)
  if (ownSent) return 'guest has orders'
  if (t.payments.some(p => p.personaId === persona.id)) return 'guest has payments'
  if (t.tips.some(x => x.personaId === persona.id)) return 'guest has payments'
  if (t.personas.length <= 1) return 'last guest'
  t.personas = t.personas.filter(p => p.id !== persona.id)
  t.lines = t.lines
    .filter(l => !(l.personaId === persona.id && !l.sent))
    .map(l => (l.shared && l.sharedWith?.includes(persona.id) ? { ...l, sharedWith: l.sharedWith.filter(id => id !== persona.id) } : l))
  t.calls = t.calls.filter(c => c.personaId !== persona.id)
  // Гостя в базе удалят вместе с оценкой — иначе её запись ссылалась бы на пустоту
  t.ratings = (t.ratings ?? []).filter(r => r.personaId !== persona.id)
  if (t.cashIntent?.personaId === persona.id) t.cashIntent = null
  return null
}

function guestAction(t: TableSession, tableId: string, action: string, body: any, persona: Persona): MutationResult {
  if (action === 'cancelPay') return cancelIntent(t, tableId, persona, (a, tid, detail, amount, p) => audit(null, a, tid, detail, amount, p))

  if (action === 'rate') {
    // Оценка визита: раньше выбор на экране «Спасибо» никуда не уходил
    const rating = body.rating
    if (rating !== 'good' && rating !== 'ok' && rating !== 'bad') return fail(400, 'bad rating', { allowed: ['good', 'ok', 'bad'] })
    const note = sanitizeNote(body.note)
    const prev = (t.ratings ?? []).find(r => r.personaId === persona.id)
    t.ratings = [...(t.ratings ?? []).filter(r => r.personaId !== persona.id), { personaId: persona.id, rating, note, at: Date.now() }]
    // Повтор той же оценки журнал не засоряет: ломатель писал десятки одинаковых строк
    if (prev && prev.rating === rating && prev.note === note) return ok({ ok: true })
    audit(null, 'оценил визит', tableId, `${persona.name}: ${{ good: 'всё отлично', ok: 'нормально', bad: 'есть замечание' }[rating]}${note ? ` — ${note}` : ''}`, null, persona)
    return ok({ ok: true })
  }

  if (action === 'allergies') {
    // Забыл отметить орехи при входе — не повод остаться без защиты до конца ужина
    if (!Array.isArray(body.allergies)) return fail(400, 'allergies must be a list', { allowed: ALLERGENS })
    const unknown = (body.allergies as unknown[]).filter(a => typeof a !== 'string' || !ALLERGENS.includes(a))
    if (unknown.length) return fail(400, 'unknown allergen', { unknown: unknown.map(String), allowed: ALLERGENS })
    persona.allergies = ALLERGENS.filter(a => (body.allergies as string[]).includes(a))
    audit(null, 'указал аллергии', tableId, `${persona.name}: ${persona.allergies.join(', ') || 'нет'}`, null, persona)
    return ok({ ok: true, allergies: persona.allergies })
  }

  if (action === 'leave') {
    const why = removePersona(t, persona)
    if (why) return fail(409, why)
    audit(null, 'вышел из-за стола', tableId, persona.name, null)
    return ok()
  }

  if (action === 'lines') {
    const dish = getDish(asId(body.dishId))
    if (!dish) return fail(400, 'unknown dish')
    if (isStopped(dish.id)) return fail(400, 'dish in stop list', { dish: dish.name })

    const qty = numberOf(body.qty, 1)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return fail(400, 'bad qty', { min: 1, max: MAX_QTY })

    const checked = checkOptions(dish, body.options)
    if (checked.error) return fail(400, checked.error)
    if (t.lines.length >= MAX_LINES) return fail(400, 'too many lines')

    // Комментарий доезжает до повара как есть. Пустой — значит его нет.
    const comment = sanitizeNote(body.comment ?? body.note)

    // Блюдо с заявленным аллергеном не заказывается «случайно»: система знает,
    // что человеку нельзя, и обязана остановить его, а не промолчать
    // Общее блюдо касается всех за столом: брускетта «на всех» при соседе с
    // лактозой — это его тарелка тоже, а раньше проверялся только заказавший
    const dishAllergens = allergensOf(dish.id, checked.options ?? {})
    // Строгое true: строка "false" раньше делала блюдо общим (смена №6, Б16)
    const shared = body.shared === true
    const concerned = shared ? t.personas : [persona]
    const people = concerned
      .map(p => ({ id: p.id, name: p.name, self: p.id === persona.id, allergens: dishAllergens.filter(a => (p.allergies ?? []).includes(a)) }))
      .filter(p => p.allergens.length > 0)
    const hits = [...new Set(people.flatMap(p => p.allergens))]
    if (hits.length > 0 && body.confirmAllergen !== true) {
      return fail(409, 'allergen warning', { allergens: hits, dish: dish.name, people })
    }

    const line = {
      uid: t.seq++,
      dishId: dish.id,
      qty,
      // Цена фиксируется в момент заказа и уже включает надбавку за модификатор
      price: priceWithOptions(dish.id, checked.options ?? {}),
      options: checked.options ?? {},
      comment,
      allergenOk: people.flatMap(p => p.allergens.map(a => okKey(p.id, a))),
      shared,
      sharedWith: [] as string[],
      personaId: persona.id,
      sent: false,
      served: false,
      cancelled: false,
      sentAt: null,
      startedAt: null,
      servedAt: null
    }
    t.lines.push(line)
    audit(null, 'добавил', tableId, `${persona.name}: ${dish.name}${qty > 1 ? ` ×${qty}` : ''}`, round2(line.price * qty), persona)
    return ok({ ok: true, uid: line.uid, line: publicLine(line) })
  }

  if (action === 'remove') {
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line) return fail(404, 'line not found')
    if (line.sent) return fail(409, 'already sent to kitchen')
    if (line.personaId !== persona.id) return fail(403, 'not yours')
    t.lines = t.lines.filter(l => l !== line)
    audit(null, 'убрал', tableId, `${persona.name}: ${dishName(line.dishId)}`, round2(line.price * line.qty), persona)
    return ok()
  }

  if (action === 'send') {
    const scope = body.scope === 'all' ? 'all' : 'mine'
    const now = Date.now()
    const sharers = t.personas.map(p => p.id)
    const drafts = t.lines.filter(l => !l.sent && !l.cancelled && (scope === 'all' || l.personaId === persona.id))
    // Корзина могла пролежать: блюдо сняли в стоп или гость указал аллергию уже
    // после того, как положил его. Проверка при заказе тут не спасает — смена №6
    const stopped = drafts.filter(l => isStopped(l.dishId))
    const stoppedMine = stopped.filter(l => l.personaId === persona.id)
    if (stoppedMine.length) return fail(409, 'dish in stop list', { dishes: [...new Set(stoppedMine.map(l => dishName(l.dishId)))] })
    const risky = drafts.flatMap(l => {
      const eaters = l.shared ? t.personas : t.personas.filter(p => p.id === l.personaId)
      const dishAllergens = allergensOf(l.dishId, l.options ?? {})
      const people = eaters
        .map(p => ({
          id: p.id,
          name: p.name,
          allergens: dishAllergens.filter(a => (p.allergies ?? []).includes(a) && !(l.allergenOk ?? []).includes(okKey(p.id, a)))
        }))
        .filter(p => p.allergens.length > 0)
      return people.length ? [{ uid: l.uid, dish: dishName(l.dishId), people }] : []
    })
    // Согласиться с аллергеном может только тот, у кого он: черновик с аллергеном
    // соседа остаётся в корзине, а не уходит по согласию отправившего
    const foreign = risky.filter(r => r.people.some(p => p.id !== persona.id))
    const mine = risky.filter(r => !foreign.includes(r))
    // Согласие — на показанные строки: блюдо, добавленное соседом, пока открыт
    // диалог, этим согласием не покрывается
    const confirmed = new Set<number>(
      Array.isArray(body.confirmUids)
        ? body.confirmUids.filter((x: unknown) => typeof x === 'number')
        : body.confirmAllergen === true
          ? mine.map(r => r.uid)
          : []
    )
    const unconfirmed = mine.filter(r => !confirmed.has(r.uid))
    if (unconfirmed.length) {
      return fail(409, 'allergen warning', {
        allergens: [...new Set(unconfirmed.flatMap(r => r.people.flatMap(p => p.allergens)))],
        lines: unconfirmed
      })
    }
    const held = new Set([...stopped.map(l => l.uid), ...foreign.map(r => r.uid)])
    const outgoing = drafts.filter(l => !held.has(l.uid))
    const heldBack = [
      ...stopped.map(l => ({ dish: dishName(l.dishId), reason: 'stop' as const, people: [] as string[] })),
      ...foreign.map(r => ({ dish: r.dish, reason: 'allergy' as const, people: r.people.map(p => p.name) }))
    ]
    let sent = 0
    for (const line of outgoing) {
      const agreed = mine.find(r => r.uid === line.uid)
      if (agreed) line.allergenOk = [...new Set([...(line.allergenOk ?? []), ...agreed.people.flatMap(p => p.allergens.map(a => okKey(p.id, a)))])]
      line.sent = true
      line.sentAt = now
      // Доля общего блюда фиксируется здесь: делят те, кто за столом в момент заказа
      if (line.shared) line.sharedWith = sharers
      sent += 1
    }
    // Гость с плохой связью жмёт кнопку дважды: заказ уже на кухне, и сказать
    // об этом надо спокойно, а не красной ошибкой на успешном действии
    if (sent === 0) return ok({ ok: true, sent: 0, alreadySent: heldBack.length === 0, heldBack })
    audit(null, 'отправил на кухню', tableId, `${persona.name}: ${sent} поз.`, null, persona)
    // Отложенное — не ошибка: чужой черновик с аллергеном соседа или снятое в стоп ждёт хозяина
    return ok({ ok: true, sent, heldBack })
  }

  if (action === 'pay') {
    // Раньше запрос без «за что платим» молча списывал весь личный счёт.
    // Для ключа идемпотентности обязательность была, для суммы — нет.
    if (body.scope === undefined) {
      return fail(400, 'scope required', { allowed: [...PAY_SCOPES, ...Object.keys(PAY_SCOPE_ALIASES)] })
    }
    const wanted = (PAY_SCOPE_ALIASES[String(body.scope)] ?? body.scope) as PayScope
    if (!PAY_SCOPES.includes(wanted)) {
      return fail(400, 'unknown pay scope', { allowed: [...PAY_SCOPES, ...Object.keys(PAY_SCOPE_ALIASES)] })
    }
    const scope: PayScope = wanted
    // Делёж счёта выключен в настройках — платят за весь стол целиком
    if (!currentSettings().pay.split && scope !== 'full' && t.personas.length > 1) return fail(409, 'split disabled')
    // Этот платёж уже был — повтор после обрыва или рестарта сервера. Кэш
    // ответов живёт в памяти 10 минут; ключ в самом платеже — пока жив стол.
    // Раньше повтор получал «нечего платить», и гость думал, что оплата не прошла
    // Ключ хранится с персоной: два гостя с одинаковым ключом не упрутся в
    // уникальность (table_session_id, idem_key) в базе
    const idem = asId(body.idemKey) ? `${persona.id}:${asId(body.idemKey)}` : null
    const prior = idem ? t.payments.find(p => p.idemKey === idem) : undefined
    // Повтор честен, только если счёт с тех пор не менялся: ключ, забытый на
    // клиенте после обрыва, иначе «оплачивал» десерт старым чеком — ничего не списав
    if (prior && (prior.scope !== scope || t.lines.some(l => isBillLine(l) && (l.sentAt ?? 0) > prior.at))) {
      return fail(409, 'stale key')
    }
    if (prior) {
      return ok({
        ok: true,
        amount: prior.amount,
        remaining: round2(computeTotals(t, priceOf).remaining),
        repeated: true,
        receipt: {
          no: prior.receiptNo,
          at: prior.at,
          amount: prior.amount,
          scope: prior.scope,
          method: prior.method,
          guest: persona.name,
          table: tableId,
          lines: prior.lines ?? [],
          venue: venueOfReceipt(),
          note: null
        }
      })
    }
    // Кто-то уже заплатил «поровну» — дальше только поровну или весь стол. Раньше это
    // держал лишь экран: «своё» после чужого «поровну» оставляло хвосты (смена №6, столы 2 и 4)
    if (scope === 'own' && equalLocked(t)) return fail(409, 'equal split in progress', { allowed: ['equal', 'full'] })
    // С телефона платят только безналом: наличные принимает официант и подтверждает сам.
    // Способ берём тот, который гость выбрал на экране: раньше любой выбор
    // записывался как СБП, и список оплат врал официанту в лицо.
    const PHONE_METHODS: PayMethod[] = ['sbp', 'card', 'tpay', 'sber', 'mir']
    // Незнакомый способ — ошибка, а не молчаливое «СБП»: иначе в отчёте осядет не то
    if (body.method !== undefined && !PHONE_METHODS.includes(body.method)) return fail(400, 'unknown method', { allowed: PHONE_METHODS })
    const method: PayMethod = PHONE_METHODS.includes(body.method) ? body.method : 'sbp'
    if (!phoneMethodAllowed(method)) return fail(409, 'method disabled')
    // С эквайером суммы считаются с учётом оплат в пути: сосед платит только остаток
    const acquiring = !!paymentProvider()
    const money = acquiring ? reservedTotals(t) : computeTotals(t, priceOf)
    const amount = round2(amountFor(money, persona.id, scope))
    if (amount <= 0) {
      // «Нечего платить», потому что свой платёж уже в пути — отдаём его, а не ошибку
      const mine = acquiring ? (t.payIntents ?? []).find(i => i.personaId === persona.id && isReserving(i)) : undefined
      if (mine) return openIntent(t, tableId, persona, { amount: mine.amount, scope, method, idem, lines: mine.lines })
      return fail(400, 'nothing to pay')
    }
    if (acquiring) return openIntent(t, tableId, persona, { amount, scope, method, idem, lines: receiptLines(t, money, persona, scope) })
    // Внесённое гостем ДО этого платежа: paidOf читает живой список платежей,
    // и после push первый же чек писал «ранее внесено» суммой текущей оплаты
    const mineBefore = round2(money.paidOf(persona.id))
    // Состав чека фиксируем в момент оплаты: за что именно списаны деньги
    const payment = {
      id: crypto.randomUUID(),
      personaId: persona.id,
      amount,
      scope,
      method,
      at: Date.now(),
      receiptNo: receiptNoOf(tableId),
      lines: receiptLines(t, money, persona, scope),
      idemKey: idem
    }
    t.payments.push(payment)
    audit(null, 'оплата', tableId, `${persona.name} · ${scope} · ${method}`, amount, persona)

    const left = clearAfterPay(t, persona)

    return ok({
      ok: true,
      amount,
      remaining: left,
      // Чек: номер, время и состав — то, что гость может сохранить или оспорить
      receipt: {
        no: payment.receiptNo,
        at: payment.at,
        amount,
        scope,
        method,
        guest: persona.name,
        table: tableId,
        lines: payment.lines,
        venue: venueOfReceipt(),
        // Строки чека не всегда равны списанному: весь стол, поровну, доплата.
        // Показываем, почему, — иначе чек выглядит как ошибка кассы
        tableTotal: round2(money.tableTotal),
        paidBefore: round2(money.paidTotal),
        paidBeforeMine: mineBefore,
        note: receiptNote(money, scope, mineBefore)
      }
    })
  }

  if (action === 'tip') {
    if (!currentSettings().pay.tips) return fail(409, 'tips disabled')
    // Проверяем уже округлённое: 0,004 ₽ проходило «> 0», округлялось в ноль
    // и роняло запись в базе (500) — смена №6
    const raw = typeof body.amount === 'number' ? body.amount : Number.NaN
    if (!Number.isFinite(raw) || round2(raw) < 1) return fail(400, 'bad amount', { min: 1 })
    const money = computeTotals(t, priceOf)
    // Потолок привязан к счёту и считается по СУММЕ чаевых стола: иначе обходится циклом
    const cap = Math.max(5000, round2(money.tableTotal))
    const already = t.tips.reduce((sum, x) => sum + x.amount, 0)
    if (round2(already + raw) > cap) return fail(400, 'tip too large', { cap, already: round2(already) })
    const amount = round2(raw)
    const waiter = waiterOfTable(tableId)
    // Чаевые — тоже списание: с чего именно, гость должен видеть в чеке
    const TIP_METHODS: PayMethod[] = ['sbp', 'card', 'tpay', 'sber', 'mir']
    if (body.method !== undefined && !TIP_METHODS.includes(body.method)) return fail(400, 'unknown method', { allowed: TIP_METHODS })
    const tipMethod: PayMethod = TIP_METHODS.includes(body.method) ? body.method : 'sbp'
    if (!phoneMethodAllowed(tipMethod)) return fail(409, 'method disabled')
    const tip = {
      id: crypto.randomUUID(),
      personaId: persona.id,
      amount,
      at: Date.now(),
      waiterId: waiter?.id ?? null,
      method: tipMethod
    }
    t.tips.push(tip)
    audit(null, 'чаевые', tableId, `${persona.name} → ${waiter?.name ?? 'официанту'}`, amount, persona)
    return ok({
      ok: true,
      amount,
      // Чаевые — тоже списание, и подтверждение по ним гостю тоже нужно
      receipt: {
        no: receiptNoOf(tableId, 'tip'),
        at: tip.at,
        amount,
        method: tipMethod,
        venue: venueOfReceipt(),
        kind: 'tip',
        guest: persona.name,
        table: tableId,
        waiter: waiter?.name ?? null
      }
    })
  }

  if (action === 'cancelMine') {
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line) return fail(404, 'line not found')
    if (line.personaId !== persona.id) return fail(403, 'not yours')
    if (line.cancelled) return fail(409, 'already cancelled')
    if (line.served) return fail(409, 'already served')
    // Кухня уже взялась — отменять поздно, продукт в работе
    if (line.startedAt) return fail(409, 'already cooking')

    line.cancelled = true
    line.cancelledAt = Date.now()
    line.cancelReason = 'гость отменил'
    audit(null, 'гость отменил блюдо', tableId, `${persona.name}: ${dishName(line.dishId)}`, round2(line.price * line.qty), persona)
    return ok()
  }

  if (action === 'cashIntent') {
    // Это ещё не деньги, а просьба принять их. Официант увидит её в зале и подойдёт.
    const wanted = PAY_SCOPE_ALIASES[String(body.scope ?? 'own')] ?? body.scope ?? 'own'
    if (!PAY_SCOPES.includes(wanted as PayScope)) return fail(400, 'unknown pay scope', { allowed: PAY_SCOPES })
    if (!currentSettings().pay.cash) return fail(409, 'method disabled')
    if (!currentSettings().pay.split && wanted !== 'full' && t.personas.length > 1) return fail(409, 'split disabled')
    if (wanted === 'own' && equalLocked(t)) return fail(409, 'equal split in progress', { allowed: ['equal', 'full'] })
    // Гость уже на странице оплаты картой — наличными за то же самое не берём
    if ((t.payIntents ?? []).some(i => i.personaId === persona.id && isReserving(i))) return fail(409, 'payment in progress')

    // Оплаты в пути уже зарезервированы — наличными только остаток
    const money = paymentProvider() ? reservedTotals(t) : computeTotals(t, priceOf)
    const amount = round2(amountFor(money, persona.id, wanted as PayScope))
    if (amount <= 0) return fail(400, 'nothing to pay')

    // Тихо перезаписывать чужую просьбу нельзя: у соседа исчезает баннер, его
    // «передумал» отвечает 403, а официант приходит с одной суммой на двоих
    if (t.cashIntent && t.cashIntent.personaId !== persona.id) {
      const who = t.personas.find(p => p.id === t.cashIntent!.personaId)?.name ?? 'гость'
      return fail(409, 'cash request pending', { by: who, amount: t.cashIntent.amount })
    }

    t.cashIntent = { personaId: persona.id, scope: wanted, amount, at: Date.now() }
    audit(null, 'просит принять наличные', tableId, `${persona.name} · ${wanted}`, amount, persona)
    return ok({ ok: true, amount, scope: wanted })
  }

  if (action === 'cancelCash') {
    // Гость передумал и платит телефоном. Без этого просьба была билетом в
    // один конец: официант всё равно шёл за наличными, которых уже не ждут.
    if (!t.cashIntent) return fail(409, 'no cash request')
    if (t.cashIntent.personaId !== persona.id) return fail(403, 'not your request')
    const was = t.cashIntent.amount
    t.cashIntent = null
    audit(null, 'передумал платить наличными', tableId, persona.name, was, persona)
    return ok()
  }

  // call
  if (body.reason !== undefined && !CALL_REASONS.has(body.reason)) {
    return fail(400, 'unknown call reason', { allowed: [...CALL_REASONS] })
  }
  const reason = body.reason ?? 'help'
  // Текст вызова — единственный способ гостя сказать «у меня аллергия». Раньше он
  // приходил в reason, не проходил вайтлист и исчезал с ответом ok
  const note = sanitizeNote(body.note ?? body.message)

  // У гостя один открытый вызов: повтор копится в нём счётчиком и свежим текстом.
  // Раньше каждая новая причина — новая строка, и пять нажатий забивали очередь стола
  const existing = t.calls.find(c => c.personaId === persona.id)
  if (existing) {
    const merged = {
      ...existing,
      // «Счёт» важнее «помогите»: официант должен идти с папкой
      reason: reason === 'bill' ? 'bill' : existing.reason,
      note: note ?? existing.note ?? null,
      repeats: (existing.repeats ?? 1) + 1,
      lastAt: Date.now()
    }
    t.calls = t.calls.map(c => (c === existing ? merged : c))
    return ok({ ok: true, callId: existing.id, at: existing.at, repeated: true, repeats: merged.repeats })
  }
  if (t.calls.length >= MAX_CALLS) return fail(400, 'too many calls')

  const call = { id: crypto.randomUUID(), at: Date.now(), personaId: persona.id, reason, note }
  t.calls.push(call)
  audit(null, 'позвал официанта', tableId, `${persona.name} · ${reason}${note ? `: ${note}` : ''}`, null, persona)
  return ok({ ok: true, callId: call.id, at: call.at, repeated: false })
}

function staffAction(t: TableSession, tableId: string, action: string, body: any, actor: Actor | null): MutationResult {
  if (!actor) return fail(401, 'staff login required')
  if (!can(actor.role, action as Permission)) return fail(403, 'role not allowed')
  // Закреплённые столы — ответственность, а не подсветка: чужой стол трогать нельзя
  // ack — подойти к гостю, а не тронуть его деньги: это можно на любом столе
  if (action !== 'ack' && !ownsTable(actor, tableId)) {
    return fail(403, 'not your table', { waiter: waiterOfTable(tableId)?.name ?? null })
  }

  if (action === 'addLine') {
    /**
     * Блюдо от официанта: гость попросил вслух, а не с телефона, или за столом
     * вообще нет телефона. Уходит на кухню сразу — официант принял заказ.
     * Аллергии проверяются так же, как у гостя: у своего блюда — гостя, у
     * общего — всех за столом; без подтверждения — 409 с именами.
     */
    const dish = getDish(asId(body.dishId))
    if (!dish) return fail(400, 'unknown dish')
    if (isStopped(dish.id)) return fail(400, 'dish in stop list', { dish: dish.name })
    const qty = numberOf(body.qty, 1)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return fail(400, 'bad qty', { min: 1, max: MAX_QTY })
    const checked = checkOptions(dish, body.options)
    if (checked.error) return fail(400, checked.error)
    if (t.lines.length >= MAX_LINES) return fail(400, 'too many lines')

    // Стол пуст — гости без телефона: сажаем безымянного гостя, его токена нет ни у кого
    if (t.status !== 'open' || t.personas.length === 0) {
      if (t.status !== 'open') openSessionInPlace(t)
      t.personas.push({
        id: crypto.randomUUID(),
        name: 'Гость',
        animal: 'bear',
        joinedAt: Date.now(),
        allergies: [],
        secretHash: hashToken(crypto.randomBytes(18).toString('base64url'))
      })
    }
    const shared = body.personaId == null
    const persona = shared ? t.personas[0] : t.personas.find(p => p.id === asId(body.personaId))
    if (!persona) return fail(404, 'guest not found')

    const dishAllergens = allergensOf(dish.id, checked.options ?? {})
    const eaters = shared ? t.personas : [persona]
    const people = eaters
      .map(p => ({ name: p.name, allergens: dishAllergens.filter(a => (p.allergies ?? []).includes(a)) }))
      .filter(p => p.allergens.length > 0)
    if (people.length > 0 && body.confirmAllergen !== true) {
      return fail(409, 'allergen warning', { allergens: [...new Set(people.flatMap(p => p.allergens))], dish: dish.name, people })
    }

    const now = Date.now()
    const line = {
      uid: t.seq++,
      dishId: dish.id,
      qty,
      price: priceWithOptions(dish.id, checked.options ?? {}),
      options: checked.options ?? {},
      comment: sanitizeNote(body.comment),
      shared,
      // Общее — на всех, кто сейчас за столом: доля фиксируется в момент отправки
      sharedWith: shared ? t.personas.map(p => p.id) : ([] as string[]),
      personaId: persona.id,
      sent: true,
      served: false,
      cancelled: false,
      sentAt: now,
      startedAt: null,
      servedAt: null
    }
    t.lines.push(line)
    audit(actor, 'добавил на стол', tableId, `${shared ? 'на стол' : persona.name}: ${dish.name}${qty > 1 ? ` ×${qty}` : ''}`, round2(line.price * qty))
    return ok({ ok: true, uid: line.uid, line: publicLine(line) })
  }

  if (action === 'addSeat') {
    if (t.status !== 'open') return fail(409, 'table closed')
    const extra = t.extraSeats ?? 0
    if (extra >= MAX_EXTRA_SEATS) return fail(409, 'too many seats', { max: MAX_EXTRA_SEATS })
    t.extraSeats = extra + 1
    audit(actor, 'приставил стул', tableId, `мест: ${seatsOf(tableId) + t.extraSeats}`)
    return ok({ ok: true, seats: seatsOf(tableId) + t.extraSeats })
  }

  if (action === 'removeGuest') {
    if (t.status !== 'open') return fail(409, 'table closed')
    const persona = t.personas.find(p => p.id === asId(body.personaId))
    if (!persona) return fail(404, 'guest not found')
    const why = removePersona(t, persona)
    if (why) return fail(409, why)
    audit(actor, 'убрал гостя', tableId, persona.name)
    return ok()
  }

  if (action === 'start' || action === 'ready' || action === 'serve') {
    if (t.status !== 'open') return fail(409, 'table closed')
    if (!body.sessionId) return fail(400, 'sessionId required')
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line) return fail(404, 'line not found')
    if (line.cancelled) return fail(409, 'line cancelled')
    if (!line.sent) return fail(400, 'not sent to kitchen yet')
    if (line.served) return fail(409, 'already served')

    if (action === 'start') {
      line.startedAt = line.startedAt ?? Date.now()
      line.startedBy = actor.id
      audit(actor, 'взял в работу', tableId, dishName(line.dishId))
      return ok({ ok: true, startedAt: line.startedAt })
    }

    if (action === 'ready') {
      // Повар закончил: блюдо стоит на раздаче и ждёт официанта
      if (!line.startedAt) return fail(409, 'not started yet')
      line.readyAt = line.readyAt ?? Date.now()
      line.readyBy = actor.id
      audit(actor, 'блюдо готово', tableId, dishName(line.dishId))
      return ok({ ok: true, readyAt: line.readyAt })
    }

    // сначала «в работу», иначе время готовки не собирается вовсе
    if (!line.startedAt) return fail(409, 'not started yet')
    // Официант унёс с раздачи. Если повар не отметил готовность (отдал из рук
    // в руки), фиксируем её этим же моментом — иначе время на раздаче соврёт.
    line.readyAt = line.readyAt ?? Date.now()
    line.served = true
    line.servedAt = Date.now()
    line.servedBy = actor.id
    audit(actor, 'подал', tableId, dishName(line.dishId))
    return ok()
  }

  if (action === 'refund') {
    /**
     * Возврат переплаты. Домен считал `overpaid` и показывал её в сводке смены
     * и в реестре чеков, но отдать деньги было нечем: управляющая видела «вернуть
     * гостям 640 ₽» и не могла закрыть этот долг в системе.
     *
     * Кому — последнему плательщику: он и переплатил. Сумму клампим переплатой,
     * чтобы возврат не превратился в выдачу из кассы.
     */
    const overpaid = round2(t.overpaid ?? 0)
    if (overpaid <= 0.01) return fail(409, 'nothing to refund')

    const wanted = numberOf(body.amount, overpaid)
    if (!Number.isFinite(wanted) || round2(wanted) <= 0) return fail(400, 'bad amount')
    const amount = round2(Math.min(wanted, overpaid))

    /**
     * Кому возвращаем: тому, кто заплатил БОЛЬШЕ всех. Переплата рождается
     * отменой блюда после оплаты, а не порядком платежей, поэтому «последний
     * плательщик» — неверная эвристика: последним мог внести сосед сто рублей,
     * а переплатил тот, кто закрыл весь стол.
     */
    const paidBy = new Map<string | null, number>()
    for (const pay of t.payments) paidBy.set(pay.personaId, (paidBy.get(pay.personaId) ?? 0) + pay.amount)
    const biggest = [...paidBy.entries()].sort((a, b) => b[1] - a[1])[0]
    const persona = t.personas.find(p => p.id === biggest?.[0]) ?? null

    // Способ возврата по умолчанию — тот же, которым платили: наличную
    // переплату естественнее вернуть наличными, а не «на карту»
    const theirMethod = [...t.payments].reverse().find(p => p.personaId === persona?.id)?.method
    const method: PayMethod =
      body.method === 'cash' || body.method === 'sbp' ? body.method : theirMethod === 'cash' ? 'cash' : 'sbp'

    t.overpaid = round2(overpaid - amount)
    t.refunds = [
      ...(t.refunds ?? []),
      { id: crypto.randomUUID(), personaId: persona?.id ?? null, amount, method, at: Date.now(), byId: actor?.id ?? null }
    ]
    audit(
      actor,
      'вернул переплату',
      tableId,
      `${persona?.name ?? 'гостю'} · ${method === 'cash' ? 'наличными' : 'на карту'}`,
      amount
    )
    return ok({ ok: true, amount, left: t.overpaid })
  }

  if (action === 'cash') {
    // Официант физически взял деньги. Только теперь они попадают в счёт —
    // и в отчёт по наличным, который вечером сверяют с ящиком кассы.
    if (t.status !== 'open') return fail(409, 'table closed')
    // Кто-то сейчас платит картой — его сумма зарезервирована, наличными берём только остаток
    const money = paymentProvider() ? reservedTotals(t) : computeTotals(t, priceOf)

    const personaId = asId(body.personaId)
    const persona = personaId ? t.personas.find(p => p.id === personaId) : null
    if (personaId && !persona) return fail(404, 'guest not found')

    const scope: PayScope =
      (PAY_SCOPE_ALIASES[String(body.scope ?? (persona ? 'own' : 'full'))] as PayScope) ??
      (body.scope as PayScope) ??
      (persona ? 'own' : 'full')
    if (!PAY_SCOPES.includes(scope)) return fail(400, 'unknown pay scope', { allowed: PAY_SCOPES })
    if (scope === 'own' && equalLocked(t)) return fail(409, 'equal split in progress', { allowed: ['equal', 'full'] })

    // Сумму считает сервер и клампит остатком: сдача — не повод списать лишнее
    const wanted = numberOf(body.amount, amountFor(money, persona?.id ?? null, scope))
    if (!Number.isFinite(wanted) || round2(wanted) <= 0) return fail(400, 'bad amount')
    const amount = round2(Math.min(wanted, money.remaining))
    if (amount <= 0) return fail(400, 'nothing to pay')

    t.payments.push({
      id: crypto.randomUUID(),
      personaId: persona?.id ?? null,
      amount,
      scope,
      method: 'cash',
      takenBy: actor.id,
      takenByName: actor.name,
      at: Date.now(),
      receiptNo: receiptNoOf(tableId),
      // Гость, заплативший наличными, тоже должен видеть, за что: раньше состав был пуст
      lines: receiptLines(t, money, persona ?? null, persona ? (scope as PayScope) : 'full')
    })
    t.cashIntent = null
    audit(actor, 'принял наличные', tableId, persona ? `от ${persona.name}` : 'за стол', amount)

    const after = computeTotals(t, priceOf)
    const left = round2(after.remaining)
    // Вызов «счёт» снимается у того, кто расплатился, а не только когда оплачен
    // весь стол: Ника заплатила наличными, а её красный вызов висел до конца
    t.calls = settleBillCalls(t.calls, c => !(left > 0.01 && !(persona && c.personaId === persona.id && after.remainingOf(persona.id) <= 0.01)))
    return ok({ ok: true, amount, remaining: left })
  }

  if (action === 'clean') {
    // Раньше стол становился свободным просто через пять минут — зал считал его
    // готовым, потому что прошло время, а не потому что его кто-то протёр
    if (t.status === 'open') return fail(409, 'table is open')
    // Двое официантов могут нажать «убрано» одновременно — время должно остаться
    // от первого, иначе непонятно, когда стол реально освободился
    if (t.cleanedAt) return ok({ ok: true, cleanedAt: t.cleanedAt, alreadyClean: true })
    t.cleanedAt = Date.now()
    audit(actor, 'убрал стол', tableId, `стол свободен`)
    return ok({ ok: true, cleanedAt: t.cleanedAt })
  }

  if (action === 'dismiss') {
    // Повар подтверждает, что увидел отмену и снял блюдо с плиты
    const uid = asUid(body.uid)
    const line = uid === null ? null : t.lines.find(l => l.uid === uid)
    if (!line || !line.cancelled) return fail(400, 'nothing to dismiss')
    if (line.cancelAck) return fail(400, 'nothing to dismiss')
    line.cancelAck = true
    audit(actor, 'снял отменённое с плиты', tableId, dishName(line.dishId), round2(line.price * line.qty))
    return ok()
  }

  if (action === 'ack') {
    // Кривой callId раньше значил «первый в очереди» — и снимал чужой вызов
    if (body.callId !== undefined && !asId(body.callId)) return fail(400, 'bad callId')
    const callId = asId(body.callId)
    // Коллега уже принял — говорим кто, а не безликое «нет вызова»
    const taken = callId ? (t.callAcks ?? []).find(a => a.id === callId) : undefined
    if (taken) return fail(409, 'already acked', { by: taken.byName })
    if (t.calls.length === 0) return fail(400, 'no call')
    const call = callId ? t.calls.find(c => c.id === callId) : t.calls[0]
    if (!call) return fail(404, 'call not found')
    t.calls = t.calls.filter(c => c !== call)
    // След для гостя: вызов не исчезает в пустоту, а превращается в «Оля идёт»
    const ACK_KEEP_MS = 15 * 60 * 1000
    t.callAcks = [
      ...(t.callAcks ?? []).filter(a => Date.now() - a.at < ACK_KEEP_MS),
      {
        id: call.id,
        personaId: call.personaId,
        reason: call.reason,
        at: Date.now(),
        byId: actor?.id ?? null,
        byName: actor?.name ?? null,
        // Ответ гостю: «пицца через 3 минуты» — официант знает, а сказать было нечем
        reply: sanitizeNote(body.reply)?.slice(0, 120) ?? null
      }
    ]
    const replied = t.callAcks.at(-1)?.reply
    audit(actor, 'принял вызов', tableId, [t.personas.find(p => p.id === call.personaId)?.name, replied && `ответ: ${replied}`].filter(Boolean).join(' · ') || null)
    return ok({ ok: true, left: t.calls.length })
  }

  if (action === 'close' || action === 'reset') {
    const closing = action === 'close'
    // Раньше отвечали ok, и менеджер оставался в уверенности, что закрыл он
    if (closing && t.status !== 'open') return fail(409, 'already closed', { closedAt: t.closedAt ?? null })
    // Гость сейчас на странице оплаты — закрыть стол значит потерять его деньги из счёта
    if (t.status === 'open' && (t.payIntents ?? []).some(i => isReserving(i)) && body.force !== true) {
      return fail(409, 'payment in progress', { pending: pendingPaysOf(t) })
    }
    if (t.status === 'open') {
      const money = computeTotals(t, priceOf)
      // Стол с долгом закрывается только осознанно: иначе выручка тихо исчезает.
      // reset подчиняется тому же правилу — иначе это чёрный ход мимо защиты.
      if (money.remaining > 0.01 && body.force !== true) {
        return fail(409, 'unpaid', { remaining: round2(money.remaining) })
      }
      // Гости заплатили и уходят, а на кухне ещё готовится их еда — закрывать
      // такой стол молча нельзя: деньги взяли, блюда не отдали
      const pending = t.lines.filter(l => isBillLine(l) && !l.served)
      if (pending.length > 0 && body.force !== true) {
        return fail(409, 'kitchen pending', {
          pending: pending.length,
          dishes: pending.map(l => dishName(l.dishId))
        })
      }

      // Долг запоминаем до отмены: отменённые позиции выпадают из счёта
      const cancelled = cancelPending(t, closing ? 'стол закрыт' : 'стол сброшен', actor)
      if (cancelled.count > 0) {
        audit(
          actor,
          'списание с кухни',
          tableId,
          // Позиции ничего не доказывают: управляющая обосновывает деньгами
          `${cancelled.count} поз. на ${round2(cancelled.amount)} ₽ снято с приготовления`,
          cancelled.amount
        )
      }

      // Отмена неподанного могла уронить счёт ниже оплаченного — это переплата гостя,
      // её нельзя прятать: по 54-ФЗ нужен возврат
      const after = computeTotals(t, priceOf)

      // Долг снимаем ПОСЛЕ отмены: гость должен за то, что получил, а не за то,
      // что успело уехать на кухню. Раньше сумма бралась до отмены и включала
      // неподанное, а витрина пыталась это компенсировать вычитанием списаний —
      // но там суммировались и позиции, отменённые самим гостём задолго до
      // закрытия, которые в долг не входили никогда.
      t.closedWithDebt = round2(after.remaining)
      const overpaid = round2(Math.max(0, after.paidTotal - after.tableTotal))
      if (overpaid > 0.01) {
        t.overpaid = overpaid
        audit(actor, 'переплата к возврату', tableId, 'за отменённое', overpaid)
      }

      // Журнал называет тот же долг, что чек и итоги смены: раньше сюда шли
      // до-отменочные числа, и одна и та же сумма расходилась на четырёх экранах
      const debt = round2(after.remaining)
      const withDebt = debt > 0.01
      // Закрытие поверх готовящейся еды — отдельное событие: гости заплатили и
      // не получили блюда. Раньше в журнале это выглядело как обычное закрытие.
      const verb = closing ? 'закрыл' : 'сбросил'
      const what = withDebt
        ? `${verb} стол с долгом`
        : cancelled.count > 0
          ? `${verb} стол, не дождавшись кухни`
          : `${verb} стол`
      audit(
        actor,
        what,
        tableId,
        `оплачено ${round2(after.paidTotal)} ₽${withDebt ? `, долг ${debt} ₽` : ''}` +
          (cancelled.count > 0 ? `, снято с кухни ${round2(cancelled.amount)} ₽` : ''),
        withDebt ? debt : round2(after.paidTotal)
      )
    }

    t.status = 'closed'
    t.closedAt = Date.now()
    // Новый цикл стола начинается грязным: метка уборки от прошлой сессии
    // делала невозможной повторную уборку — сервер отвечал «уже убран», и
    // гостей сажали за неубранный стол. Ровно то, ради чего кнопка и делалась.
    t.cleanedAt = null
    // Вызовы умирают вместе со столом: «Нина просит воды» висело в зале
    // на уже свободном столе, и официант шёл к человеку, который ушёл
    t.calls = []
    t.cashIntent = null
    // Сброс освобождает стол сразу, но чистит данные хранилище — после того,
    // как зафиксирует чек смены: иначе состав закрытой сессии теряется.
    if (!closing) t.resetRequested = true
    return ok()
  }

  return fail(404, 'unknown action')
}

/** Общая обвязка экранов персонала: GET-снапшот и SSE на одном payload. */
async function staffFeed(
  req: any,
  res: any,
  url: URL,
  payloadFn: () => Promise<unknown>,
  subscribers: Set<any>,
  permission: Permission
) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method' })
  const actor = actorFrom(req, url)
  if (!actor) return json(res, 401, staffUnauthorized(req))
  if (!allowed(actor, permission)) return json(res, 403, { error: 'role not allowed' })
  if (!url.pathname.endsWith('/stream')) return json(res, 200, await payloadFn())

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform и X-Accel-Buffering: прокси не должен сжимать и копить поток (смена №6, Б15)
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive'
  })
  res.write(`data: ${JSON.stringify(await payloadFn())}\n\n`)
  if (subscribers.size >= MAX_STAFF_STREAMS) {
    res.end()
    return
  }
  ;(res as any).epRecheck = () => allowed(actorFrom(req, url), permission)
  subscribers.add(res)
  const ping = setInterval(() => {
    try {
      if (!stillEntitled(res)) {
        subscribers.delete(res)
        res.end()
        return
      }
      res.write(': ping\n\n')
    } catch {
      /* closed */
    }
  }, 25000)
  req.on('close', () => {
    clearInterval(ping)
    subscribers.delete(res)
  })
}

// --- Роутер API ---
// Гость: 60 действий в минуту на человека (или на адрес, пока он не сел).
// Адрес целиком: 600 — за одним роутером сидит весь зал
const guestLimiter = createRateLimiter(60, 60_000)
const addressLimiter = createRateLimiter(600, 60_000)

/**
 * Адрес гостя, а не прокси. За Caddy все запросы приходят с 127.0.0.1, и лимит
 * подбора PIN по адресу был общим на весь интернет (смена №6, Б2). Caddy
 * перезаписывает X-Forwarded-For адресом клиента — доверяем ему, только если
 * запрос пришёл с этой же машины.
 */
function clientIp(req: any): string {
  const socket = String(req.socket.remoteAddress ?? 'unknown')
  const local = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1'
  // Последний адрес в цепочке — тот, что дописал сам Caddy: первый клиент может подставить сам
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim()
  return local && forwarded ? forwarded : socket
}

/**
 * Запрос пришёл из сети, а не с этой машины: снаружи всё идёт либо через прокси
 * (Caddy ставит X-Forwarded-For), либо напрямую с чужого адреса. Локальные
 * вызовы — тесты, разработка — лимитами не режем.
 */
function fromOutside(req: any): boolean {
  const socket = String(req.socket.remoteAddress ?? '')
  const local = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1'
  return !local || !!req.headers['x-forwarded-for']
}

async function handleApi(req: any, res: any, url: URL) {
  const store = await getStore()

  // Уведомление ЮKassa: только повод перечитать платёж из API — телу не верим
  if (url.pathname === '/api/pay/yookassa/webhook') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' })
    const body = await readBody(req).catch(() => null)
    const meta = body?.object?.metadata ?? {}
    const tableId = typeof meta.tableId === 'string' ? meta.tableId : null
    const intentId = asId(meta.intentId)
    // Чужое или устаревшее уведомление — 200, чтобы эквайер не повторял его сутки
    if (!tableId || !intentId || !isKnownTable(tableId)) return json(res, 200, { ok: true, ignored: true })
    try {
      const hint = typeof body?.object?.id === 'string' ? body.object.id : null
      const out = await settleIntent(payDeps(store), tableId, intentId, { hintProviderId: hint, force: true })
      // Деньги без стола — запись в журнале; 200, чтобы уведомление не повторялось сутки
      if (out.status !== 200) console.error('уведомление ЮKassa:', out.status, JSON.stringify(out.body))
      return json(res, 200, { ok: true })
    } catch (err) {
      // 5xx — эквайер повторит уведомление позже
      console.error('уведомление ЮKassa не обработано:', err)
      return json(res, 503, { error: 'retry' })
    }
  }

  if (url.pathname === '/api/staff/login') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' })
    const ip = clientIp(req)
    // Устройство важнее адреса: в ресторане вся смена за одним роутером,
    // и промахи одного планшета не должны запирать вход остальным
    const device = asId(req.headers['x-device-id'])
    if (!loginAllowed(ip, device)) {
      const wait = lockoutSeconds(ip, device)
      return json(res, 429, {
        error: 'too many attempts',
        retryAfterSec: wait,
        hint: `слишком много попыток — попробуйте через ${Math.max(1, Math.ceil(wait / 60))} мин`
      })
    }
    const body = await readBody(req).catch(() => null)
    if (body === null) return json(res, 400, { error: 'bad json' })
    const result = loginByPin(body.pin, ip, device ?? body.device)
    if (!result) return json(res, 401, { error: 'wrong pin' })
    audit({ ...result.staff, sessionId: result.sessionId }, 'вошёл в смену', null, result.device ?? null)
    await flushAudit(store)
    return json(res, 200, { token: result.token, staff: result.staff })
  }

  if (url.pathname === '/api/staff/me' || url.pathname === '/api/manager/check') {
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, staffUnauthorized(req))
    const shift = await store.shift()
    return json(res, 200, { ok: true, staff: actor, shiftTips: round2(shift.tipsByStaff[actor.id] ?? 0) })
  }

  if (url.pathname === '/api/staff/logout') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' })
    dropSession(req.headers['x-staff-token'])
    await flushAudit(store)
    return json(res, 200, { ok: true })
  }

  // Персонал из кабинета: список, новый сотрудник, PIN, увольнение
  if (await staffRoutes(req, res, url, store)) return
  // Настройки заведения: читают все, меняет менеджер
  if (await settingsRoutes(req, res, url, store)) return

  if (url.pathname === '/api/staff/roster') {
    const actor = actorFrom(req, url)
    if (!allowed(actor, 'log')) return json(res, 403, { error: 'role not allowed' })
    return json(res, 200, { staff: staffRoster() })
  }

  // Смена, реестр чеков любой смены, «требует решения»
  if (await shiftRoutes(req, res, url, store)) return

  if (url.pathname === '/api/log') {
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, staffUnauthorized(req))
    if (!allowed(actor, 'log')) return json(res, 403, { error: 'role not allowed' })
    // Журнал — за смену целиком: раньше отдавались последние 150 записей, и
    // «смена открыта» с первыми посадками пропадали через полчаса работы.
    // ?shift=all — без ограничения по смене (последние 2 000 записей)
    const current = await store.currentShift()
    const last = current ? null : (await store.shiftHistory(1))[0] ?? null
    const since = url.searchParams.get('shift') === 'all' ? null : (current?.openedAt ?? last?.openedAt ?? null)
    return json(res, 200, { entries: await store.auditEntries(2000, since), since })
  }

  // Реестр чеков смены — то, чем сводят кассу
  if (url.pathname === '/api/shift/checks') {
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, staffUnauthorized(req))
    if (!allowed(actor, 'log')) return json(res, 403, { error: 'role not allowed' })
    const shift = await store.shift()
    const openShift = await store.currentShift()
    const CHECKS_SHOWN = 100
    const [checks, checkTotals] = await Promise.all([
      store.shiftChecks(CHECKS_SHOWN),
      store.shiftCheckTotals()
    ])
    return json(res, 200, {
      shift: {
        // Смена закрыта — начала нет; раньше сюда уходило «сейчас» при каждом запросе
        startedAt: openShift?.openedAt ?? null,
        revenue: round2(shift.revenue),
        closedRevenue: round2(shift.closedRevenue),
        debt: round2(shift.debt),
        overpaid: round2(shift.overpaid),
        // Заработанное ≠ принятое: переплату придётся вернуть, поэтому в
        // выручке ей не место. Без этой строки владельцу нечего показать.
        netRevenue: round2(shift.closedRevenue - shift.overpaid),
        // Снятое с кухни: еда не отдана, это потеря продукта, а не долг гостя
        writtenOff: round2(shift.writtenOff ?? 0),
        tables: shift.tables,
        guests: shift.guestsSeen
      },
      checks,
      // Сверка: сумма чеков обязана совпасть с выручкой смены
      // Сверка кассы: сумма чеков закрытых столов обязана совпасть с их выручкой.
      // Деньги на ещё открытых столах в реестр не входят и показаны отдельно.
      // Сверка складывается из ВСЕХ чеков смены, а список на экране обрезан
      // сотней последних: иначе после сто первого закрытого стола экран начинал
      // писать «не сходится» на ровном месте.
      control: {
        checksPaid: checkTotals.paid,
        closedRevenue: round2(shift.closedRevenue),
        openPaid: round2(shift.revenue - shift.closedRevenue),
        // Сверка ловила одно поле из четырёх и при этом рапортовала «сходится» —
        // расхождение по долгу проходило мимо. Теперь сверяем всё, чем отчитываемся.
        checksDebt: checkTotals.debt,
        shiftDebt: round2(shift.debt),
        checksOverpaid: checkTotals.overpaid,
        shiftOverpaid: round2(shift.overpaid),
        checksWrittenOff: checkTotals.cancelledTotal,
        shiftWrittenOff: round2(shift.writtenOff ?? 0),
        // Сколько чеков за сверкой и сколько из них видно списком
        checksTotal: checkTotals.count,
        checksShown: Math.min(checks.length, checkTotals.count),
        debtMatches: Math.abs(checkTotals.debt - round2(shift.debt)) < 0.01,
        writtenOffMatches:
          Math.abs(checkTotals.cancelledTotal - round2(shift.writtenOff ?? 0)) < 0.01,
        overpaidMatches: Math.abs(checkTotals.overpaid - round2(shift.overpaid)) < 0.01,
        matches: Math.abs(checkTotals.paid - round2(shift.closedRevenue)) < 0.01
      }
    })
  }

  // Конструктор меню и фото блюд
  if (await menuRoutes(req, res, url, store)) return

  if (url.pathname === '/api/menu' && req.method === 'GET') {
    return json(res, 200, menuPayload())
  }

  // Стоп-лист в один тап: кухня и бар выключают блюдо, гость сразу видит «закончилось»
  if (url.pathname === '/api/menu/stop') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' })
    const actor = actorFrom(req, url)
    if (!actor) return json(res, 401, staffUnauthorized(req))
    if (!allowed(actor, 'stop')) return json(res, 403, { error: 'role not allowed' })
    const body = await readBody(req)
    const dish = getDish(asId(body.dishId))
    if (!dish) return json(res, 400, { error: 'unknown dish' })
    if (typeof body.stop !== 'boolean') return json(res, 400, { error: 'stop must be boolean' })

    await store.setStop(dish.id, body.stop, actor.id)
    setStopOverride(dish.id, body.stop, actor.name)
    audit(actor, 'стоп-лист', null, `${dish.name} — ${body.stop ? 'закончилось' : 'снова в меню'}`)
    await flushAudit(store)
    await broadcastEverywhere(store)
    return json(res, 200, { ok: true, stop: stopList() })
  }

  if (url.pathname === '/api/hall' || url.pathname === '/api/hall/stream') {
    return staffFeed(req, res, url, async () => await hallNow(store), hallStreams, 'hall')
  }
  if (url.pathname === '/api/kitchen' || url.pathname === '/api/kitchen/stream') {
    return staffFeed(req, res, url, async () => await kitchenNow(store), kitchenStreams, 'kitchen')
  }

  // /api/t/:table[/action]
  const parts = url.pathname.split('/').filter(Boolean)
  const tableId = String(parts[2] ?? '')
  if (parts[1] !== 't' || !TABLE_RE.test(tableId)) return json(res, 404, { error: 'not found' })
  const action = parts[3] ?? ''

  if (!isKnownTable(tableId)) return json(res, 404, { error: 'unknown table' })


  if (req.method === 'GET' && action === '') {
    const t = await store.read(tableId)
    const token = req.headers['x-guest-token'] ?? url.searchParams.get('g')
    // Роль решает и здесь: повару нужна очередь кухни, а не имена, аллергии
    // и счета гостей всего зала
    const staff = actorFrom(req, url)
    const maySeeAll = !!guestOf(t, token) || allowed(staff, 'table')
    return json(res, 200, maySeeAll ? snapshot(t, tableId) : publicStub(t, tableId))
  }

  if (req.method === 'GET' && action === 'stream') {
    const t = await store.read(tableId)
    const token = req.headers['x-guest-token'] ?? url.searchParams.get('g')
    // Свой видит стол целиком, посторонний — только занят он или нет.
    // Рвать подписку нельзя: гость подключается ещё до того, как представился.
    const staffFull = allowed(actorFrom(req, url), 'table')
    const full = !!guestOf(t, token) || staffFull

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive'
    })
    const view = (session: TableSession) => (full ? snapshot(session, tableId) : publicStub(session, tableId))
    res.write(`data: ${JSON.stringify(view(await store.read(tableId)))}\n\n`)
    if (!streams.has(tableId)) streams.set(tableId, new Set())
    const subs = streams.get(tableId)!
    // Помечаем подписку: рассылка выберет по ней, что этому клиенту можно видеть
    ;(res as any).epFullView = full
    // Право гостя проверяется на КАЖДОЙ рассылке: убранный со стола гость
    // (removeGuest, «я здесь по ошибке») иначе продолжал получать чужие имена,
    // блюда, платежи и аллергии до конца подписки
    ;(res as any).epStaff = staffFull
    if (staffFull) (res as any).epRecheck = () => allowed(actorFrom(req, url), 'table')
    ;(res as any).epGuestToken = staffFull ? null : token ?? null
    if (subs.size >= MAX_STREAMS_PER_TABLE) {
      res.end()
      return
    }
    subs.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        /* closed */
      }
    }, 25000)
    req.on('close', () => {
      clearInterval(ping)
      streams.get(tableId)?.delete(res)
    })
    return
  }

  // Чем кончилась оплата у эквайера: гость вернулся со страницы оплаты и спрашивает
  if (req.method === 'POST' && action === 'payStatus') {
    // Каждая проверка — запрос к эквайеру: частоту режем, как у остальных гостевых действий
    if (fromOutside(req)) {
      const wait = guestLimiter.hit(`g:${asId(req.headers['x-guest-token']) ?? clientIp(req)}`)
      if (wait > 0) return json(res, 429, { error: 'too many requests', retryAfterSec: wait })
    }
    const body = await readBody(req).catch(() => null)
    const t = await store.read(tableId)
    const persona = guestOf(t, req.headers['x-guest-token'])
    if (!persona) return json(res, 401, { error: 'guest token required' })
    const intentId = asId(body?.intentId)
    const intent = (t.payIntents ?? []).find(i => i.id === intentId)
    // Чужой платёж не показываем даже соседу по столу
    if (!intent || intent.personaId !== persona.id) return json(res, 404, { error: 'payment not found' })
    try {
      const out = await settleIntent(payDeps(store), tableId, intent.id, { publicUrl: publicUrlOf(req) })
      return json(res, out.status, out.body)
    } catch (err) {
      console.error('статус оплаты не получен:', err)
      return json(res, 200, { ok: true, status: 'pending', retry: true })
    }
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method' })
  // Гость — не скрипт: минута его работы укладывается в десяток действий.
  // Персонал не ограничиваем — официант на запаре не должен упираться в 429
  if (!actorFrom(req) && fromOutside(req)) {
    const guestKey = asId(req.headers['x-guest-token'])
    const ip = clientIp(req)
    // Сначала личный лимит, адресный — только если личный пропустил: иначе один
    // буйный гость на Wi-Fi ресторана выжигал общий бюджет всего зала. Оплату
    // адресным лимитом не режем вовсе — деньги важнее защиты от шума
    const own = guestLimiter.hit(guestKey ? `g:${guestKey}` : `ip:${ip}`)
    const wait = own > 0 ? own : action === 'pay' ? 0 : addressLimiter.hit(ip)
    if (wait > 0) return json(res, 429, { error: 'too many requests', retryAfterSec: wait })
  }
  const body = await readBody(req).catch(() => null)
  if (body === null) return json(res, 400, { error: 'bad json' })

  // Смена закрыта — новые столы не открываются. Уже открытые (перенесённые)
  // работают дальше: гостя за столом не выгоняют посреди ужина.
  if ((action === 'join' || action === 'addLine') && !(await store.currentShift())) {
    const t = await store.read(tableId)
    if (t.status !== 'open') {
      return json(res, 409, { error: 'shift closed', hint: 'ресторан ещё не открыл смену — позовите официанта' })
    }
  }

  // Для денег ключ идемпотентности обязателен: без него ретрай спишет дважды
  if ((action === 'pay' || action === 'tip') && !asId(body.idemKey)) {
    return json(res, 400, { error: 'idemKey required' })
  }
  // Ключ прислали, но он не годится (слишком длинный, не строка) — раньше он
  // молча отбрасывался, и защита от двойного нажатия исчезала незаметно
  if (IDEMPOTENT_ACTIONS.has(action) && body.idemKey !== undefined && !asId(body.idemKey)) {
    return json(res, 400, { error: 'bad idemKey', max: 64 })
  }
  const idemKey = IDEMPOTENT_ACTIONS.has(action) ? asId(body.idemKey) : null
  // Ключ — чей-то: сосед по столу с тем же ключом получал чужой ответ, а его
  // действие молча не выполнялось. Кто спрашивает — часть ключа кэша
  const who = String(req.headers['x-guest-token'] ?? body.guestToken ?? req.headers['x-staff-token'] ?? 'anon')
  const cacheKey = idemKey && `${tableId}:${action}:${hashToken(who).slice(0, 16)}:${idemKey}`
  // Оплату кэш не отвечает: повтор решает сам платёж (ключ хранится в нём) —
  // под блокировкой стола и с проверкой, что счёт с тех пор не менялся.
  // Кэш отдал бы старый чек на десерт, заказанный после первой попытки
  const cacheable = action !== 'pay'
  if (cacheKey) {
    const hit = cacheable ? idempotency.get(cacheKey) : undefined
    if (hit) return json(res, hit.status, hit.body)

    // Тот же ключ уже выполняется — не начинаем второй раз, ждём первый.
    // Без этого семь одновременных нажатий создавали семь позиций: проверка
    // кеша и запись в него происходили в разные моменты, и соседние запросы
    // успевали проскочить между ними.
    const running = inFlight.get(cacheKey)
    if (running) {
      const shared = await running
      return json(res, shared.status, shared.body)
    }
  }

  // Эквайер есть, а адреса возврата нет — не начинаем оплату, а не оставляем висящий резерв
  if (action === 'pay' && paymentProvider() && !publicUrlOf(req)) return json(res, 503, { error: 'public url not configured' })

  const actor = actorFrom(req)
  const work = (async () => {
    // Записи журнала этой мутации ловим отдельно: мутация синхронна, так что всё,
    // что попало в журнал за её время, — её. Упала транзакция — записи выбрасываем,
    // а раньше они оставались в общей очереди и уезжали в журнал со следующим
    // чужим запросом: «чаевые 0 ₽», которых не было (смена №6, О3)
    const result = await withTableAudited(store, tableId, session => mutate(session, tableId, action, body, actor, req))
    await flushAudit(store)
    // Оплата через эквайера: намерение записано — теперь платёж у ЮKassa, вне транзакции стола
    if (action === 'pay' && result.status === 200 && (result.body as any).create) {
      const publicUrl = publicUrlOf(req)
      if (!publicUrl) return { status: 503, body: { error: 'public url not configured' } }
      return startAtProvider(payDeps(store), tableId, String((result.body as any).intentId), publicUrl)
    }
    if (cacheKey && cacheable && result.status === 200) idemRemember(cacheKey, result.status, result.body)
    return result
  })()

  if (cacheKey) inFlight.set(cacheKey, work)
  let out: MutationResult
  try {
    out = await work
  } finally {
    if (cacheKey) inFlight.delete(cacheKey)
  }

  if (out.status === 200) await broadcast(store, tableId)
  return json(res, out.status, out.body)
}

const settingsRoutes = createSettingsRoutes({
  json,
  readBody,
  actorFrom,
  allowed,
  staffUnauthorized,
  audit,
  flushAudit,
  broadcastEverywhere
})

const staffRoutes = createStaffRoutes({
  json,
  readBody,
  actorFrom,
  allowed,
  staffUnauthorized,
  audit,
  flushAudit,
  broadcastEverywhere
})

const menuRoutes = createMenuRoutes({
  json,
  actorFrom,
  allowed,
  staffUnauthorized,
  audit,
  flushAudit,
  broadcastEverywhere
})

const shiftRoutes = createShiftRoutes({
  json,
  readBody,
  actorFrom,
  allowed,
  staffUnauthorized,
  audit,
  flushAudit,
  broadcastEverywhere
})

export function createServer() {
  const server = http.createServer(async (req, res) => {
    try {
      // Разбор адреса ОБЯЗАН быть внутри try. Он стоял снаружи, и запрос без
      // заголовка Host — кривой клиент, старый прокси, сканер портов —
      // выбрасывал исключение мимо обработчика и убивал процесс целиком.
      // Ресторан переставал работать от одного плохого запроса, а всё, что было
      // в полёте, повисало навсегда: повар жал «Унёс гостю» и кнопка гасла.
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
      return await serveStatic(req, res, url.pathname)
    } catch (err) {
      console.error('request failed:', err)
      // Ответ уже начат (оборвалась отдача файла, упал хвост SSE) — писать
      // заголовки поверх нельзя: writeHead кинет ERR_HTTP_HEADERS_SENT прямо
      // здесь, в catch, и уронит процесс. То есть «последний рубеж» сам
      // становился причиной падения, от которого он же и защищает.
      if (res.headersSent) return res.destroy()
      const bad = err instanceof TypeError && String((err as any).code) === 'ERR_INVALID_URL'
      return json(res, bad ? 400 : 500, { error: bad ? 'bad request' : 'internal' })
    }
  })

  // Последний рубеж: что бы ни случилось в асинхронном хвосте запроса, зал не
  // должен оставаться без сервера. Падение одного запроса — не повод ронять смену.
  server.on('clientError', (err, socket) => {
    console.error('bad client request:', (err as any)?.code ?? err)
    if ((socket as any).writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })

  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Ни один отклонённый промис не имеет права уронить смену: Node 22 гасит
  // процесс по unhandledRejection, а ресторан от этого перестаёт работать целиком
  process.on('unhandledRejection', err => console.error('unhandled rejection:', err))
  process.on('uncaughtException', err => console.error('uncaught exception:', err))

  const store = await getStore()
  createServer().listen(PORT, () => {
    console.log(`EasyPay API on :${PORT} · хранилище: ${store.kind}`)
    console.log(
      process.env.EASYPAY_MANAGER_TOKEN
        ? 'Manager token: из EASYPAY_MANAGER_TOKEN'
        : `Manager token (сгенерирован): ${MANAGER_TOKEN}`
    )
  })
}
