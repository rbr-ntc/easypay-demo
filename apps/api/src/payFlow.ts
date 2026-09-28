// Оплата через эквайера. Раньше `pay` просто дописывал «оплачено» со слов
// телефона (смена №6, Б5). Теперь — три шага:
//
// 1. Намерение (внутри транзакции стола): сумма, состав чека, резерв — сосед
//    платит только остаток.
// 2. Заморозка у эквайера: гость на странице ЮKassa, деньги держатся, но не
//    списаны (`capture: false`).
// 3. Списание (снова под блокировкой стола): сервер решает, сколько взять —
//    не больше остатка. Стол закрыт или уже оплачен — заморозка снимается,
//    деньги гостю не списываются. Поздний платёж не теряется и не дублируется.
//
// Статусу из уведомления не верим: уведомление — повод перечитать платёж из API.

import crypto from 'node:crypto'
import { computeTotals, round2, type MoneyTotals } from '@easypay/domain/money'
import { priceOf } from './menu.ts'
import { paymentProvider, ProviderError, type ProviderPayment } from './payments/index.ts'
import { receiptNoOf, venueOfReceipt } from './receipt.ts'
import type { MutationResult, PayIntent, PayMethod, Payment, Persona, ReceiptLine, TableSession } from './types.ts'

/** Сколько держим резерв без ответа эквайера: дольше гость на странице оплаты не сидит. */
const RESERVE_MS = 20 * 60_000
/** Завершённые намерения помним сутки: повтор проверки статуса вернёт чек. */
const KEEP_MS = 24 * 60 * 60_000
/** Намерение, которое прямо сейчас создаётся у эквайера: второй запрос его не дублирует. */
const CREATING_MS = 30_000
/** Чаще не переспрашиваем эквайера об одном платеже: квота API не бесконечна. */
const RECHECK_MS = Number(process.env.EASYPAY_PAY_RECHECK_MS ?? 2_000)
/** Отмена гостем: такая заморозка только снимается, никогда не списывается. */
export const GUEST_CANCELED = 'гость отменил оплату'
/** Сколько сверх резерва держит сумму заморозка, которую решили списать. */
const AUTHORIZED_MS = 10 * 60_000

const ok = (body: Record<string, unknown> = { ok: true }): MutationResult => ({ status: 200, body })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): MutationResult => ({ status, body: { error, ...extra } })

/** Намерение держит сумму: ждём гостя или решаем, сколько списать. */
export function isReserving(i: PayIntent, now = Date.now()): boolean {
  // Решение о списании держит сумму дольше, но не вечно: зависшее списание
  // перепроверяется у эквайера следующей проверкой статуса
  if (i.status === 'authorized') return now - i.at < RESERVE_MS + AUTHORIZED_MS
  return (i.status === 'creating' || i.status === 'pending') && now - i.at < RESERVE_MS
}

/** Итоги стола, где оплаты в пути уже считаются внесёнными: сосед платит только остаток. */
export function reservedTotals(t: TableSession, except: string | null = null): MoneyTotals {
  const now = Date.now()
  const virtual = (t.payIntents ?? [])
    .filter(i => i.id !== except && isReserving(i, now))
    .map(i => ({ id: i.id, personaId: i.personaId, amount: i.amount, scope: i.scope, at: i.at }))
  return computeTotals({ ...t, payments: [...t.payments, ...virtual] }, priceOf)
}

/** «Поровну» уже идёт — оплаченное или в пути: дальше только поровну или весь стол. */
export function equalInFlight(t: TableSession): boolean {
  return (t.payIntents ?? []).some(i => i.scope === 'equal' && isReserving(i))
}

const pendingBody = (i: PayIntent, create: boolean) => ({
  ok: true,
  pending: true,
  intentId: i.id,
  amount: i.amount,
  confirmationUrl: i.confirmationUrl,
  create
})

/**
 * Шаг 1, внутри транзакции стола. У гостя одна оплата в пути: вторая «попытка»
 * с новым ключом отдаёт первую, а не создаёт второй платёж.
 */
export function openIntent(
  t: TableSession,
  tableId: string,
  persona: Persona,
  p: { amount: number; scope: string; method: PayMethod; idem: string | null; lines: ReceiptLine[] }
): MutationResult {
  const now = Date.now()
  const intents = (t.payIntents ?? []).filter(i => now - i.at < KEEP_MS)
  const inFlight = intents.find(i => i.personaId === persona.id && isReserving(i, now))
  if (inFlight) {
    // Создаётся прямо сейчас соседним запросом — не запускаем второй раз, клиент подождёт
    const create = !inFlight.providerId && inFlight.status === 'creating' && now - inFlight.at >= CREATING_MS
    // scope начатой оплаты — чтобы экран сказал «у вас уже начата оплата», а не молча подменил выбор (П6)
    return ok({ ...pendingBody(inFlight, create), resumed: true, scope: inFlight.scope })
  }

  const intent: PayIntent = {
    id: crypto.randomUUID(),
    personaId: persona.id,
    amount: p.amount,
    scope: p.scope,
    method: p.method,
    idemKey: p.idem,
    providerId: null,
    confirmationUrl: null,
    status: 'creating',
    cancelReason: null,
    lines: p.lines,
    receiptNo: receiptNoOf(tableId),
    at: now
  }
  t.payIntents = [...intents, intent]
  return ok(pendingBody(intent, true))
}

export interface PayFlowDeps {
  read: (tableId: string) => Promise<TableSession>
  withTable: (tableId: string, apply: (t: TableSession) => MutationResult) => Promise<MutationResult>
  /** Журнал и рассылка после изменения стола. */
  after: (tableId: string) => Promise<void>
  /** Что делает мгновенная оплата после зачисления: снять «счёт», просьбу о наличных. */
  onPaid: (t: TableSession, persona: Persona | null) => void
  audit: (action: string, tableId: string, detail: string, amount: number | null, persona: Persona | null) => void
}

const intentOf = (t: TableSession, id: string) => (t.payIntents ?? []).find(i => i.id === id)

const patchIntent = (t: TableSession, id: string, patch: Partial<PayIntent>) => {
  t.payIntents = (t.payIntents ?? []).map(i => (i.id === id ? { ...i, ...patch } : i))
}

/** Окончательный отказ эквайера (4xx), а не сбой связи: повтор с тем же ключом не поможет. */
const definitive = (err: unknown) => err instanceof ProviderError && err.status >= 400 && err.status < 500

/** Шаг 2, вне транзакции: платёж у эквайера и ссылка, куда вести гостя. */
export async function startAtProvider(deps: PayFlowDeps, tableId: string, intentId: string, publicUrl: string): Promise<MutationResult> {
  const provider = paymentProvider()
  if (!provider) return fail(503, 'payment provider unavailable')
  const t = await deps.read(tableId)
  const intent = intentOf(t, intentId)
  if (!intent) return fail(404, 'payment not found')
  try {
    const pp = await provider.create({
      amount: intent.amount,
      description: `${venueOfReceipt().name} · стол ${tableId} · чек ${intent.receiptNo}`,
      // Ключ — номер намерения: повтор после сбоя вернёт тот же платёж, а не второй
      idemKey: intent.id,
      returnUrl: `${publicUrl}/?t=${encodeURIComponent(tableId)}&pay=${intent.id}`,
      metadata: { tableId, intentId: intent.id, sessionId: String(t.sessionId ?? '') }
    })
    const res = await deps.withTable(tableId, s => {
      const cur = intentOf(s, intent.id)
      if (!cur) return fail(404, 'payment not found')
      // Пока ходили к эквайеру, уведомление могло уже всё решить — назад не откатываем
      if (cur.status === 'creating') patchIntent(s, intent.id, { providerId: pp.id, confirmationUrl: pp.confirmationUrl, status: 'pending' })
      // Гость отменил, пока создавался платёж: номер всё равно запоминаем — чтобы снять
      // заморозку, если он всё же заплатит, — а ссылку на оплату не отдаём
      else if (cur.status === 'canceled') {
        patchIntent(s, intent.id, { providerId: pp.id })
        return ok({ ok: true, status: 'canceled', reason: cur.cancelReason ?? 'оплата отменена' })
      }
      return ok(pendingBody({ ...cur, providerId: pp.id, confirmationUrl: pp.confirmationUrl }, false))
    })
    await deps.after(tableId)
    return res
  } catch (err) {
    console.error('эквайер не создал платёж:', err instanceof Error ? err.message : err)
    // Сбой связи или «ещё обрабатываю»: платёж у эквайера мог появиться. Намерение
    // остаётся — повтор пойдёт с тем же ключом и получит тот же платёж
    if (!definitive(err)) return fail(502, 'payment provider unavailable', { retry: true })
    await deps.withTable(tableId, s => {
      if (intentOf(s, intent.id)?.status === 'creating') patchIntent(s, intent.id, { status: 'canceled', cancelReason: 'платёжный сервис отклонил запрос' })
      return ok()
    })
    await deps.after(tableId)
    return fail(502, 'payment provider unavailable')
  }
}

/** Чек платежа через эквайера — той же формы, что у мгновенной оплаты. */
function receiptOf(tableId: string, payment: Payment, persona: Persona | null, money: MoneyTotals, mineBefore: number) {
  return {
    no: payment.receiptNo,
    at: payment.at,
    amount: payment.amount,
    scope: payment.scope,
    method: payment.method,
    guest: persona?.name ?? null,
    table: tableId,
    lines: payment.lines ?? [],
    venue: venueOfReceipt(),
    tableTotal: round2(money.tableTotal),
    paidBefore: round2(money.paidTotal),
    paidBeforeMine: mineBefore,
    note: mineBefore > 0.01 ? `доплата: ранее внесено ${mineBefore.toLocaleString('ru-RU')} ₽` : null
  }
}

const doneBody = (t: TableSession, tableId: string, intent: PayIntent) => {
  const paid = t.payments.find(p => p.providerId === intent.providerId)
  const persona = t.personas.find(p => p.id === intent.personaId) ?? null
  return ok({ ok: true, status: 'succeeded', amount: paid?.amount ?? intent.amount, receipt: paid ? receiptOf(tableId, paid, persona, computeTotals(t, priceOf), 0) : null })
}

/** Отметить отказ: платёж не прошёл или заморозка снята. */
function markCanceled(deps: PayFlowDeps, t: TableSession, tableId: string, intentId: string, reason: string): MutationResult {
  const intent = intentOf(t, intentId)
  if (!intent) return fail(404, 'payment not found')
  if (intent.status === 'succeeded') return doneBody(t, tableId, intent)
  if (intent.status !== 'canceled') {
    const persona = t.personas.find(p => p.id === intent.personaId) ?? null
    patchIntent(t, intentId, { status: 'canceled', cancelReason: reason })
    deps.audit('оплата не прошла', tableId, `${persona?.name ?? 'гость'}: ${reason}`, intent.amount, persona)
  }
  return ok({ ok: true, status: 'canceled', reason })
}

/**
 * Шаг 3а, под блокировкой: сколько списать из заморозки. Не больше остатка
 * стола без учёта этой же оплаты — поэтому поздний или второй платёж не
 * создаёт переплату. Стол закрыт или пересел — не списываем ничего.
 */
function decideCapture(t: TableSession, intentId: string, pp: ProviderPayment): { capture: number } | { cancel: string } | { done: true } {
  const intent = intentOf(t, intentId)
  if (!intent) return { cancel: 'стол уже закрыт — деньги не списаны' }
  if (intent.status === 'succeeded' || t.payments.some(p => p.providerId === pp.id)) return { done: true }
  // Гость сам отменил и заплатил иначе — даже если дожал оплату на старой вкладке
  // банка, списывать нельзя: иначе его карта закрыла бы долю соседей (смена №7, П1)
  if (intent.status === 'canceled' && intent.cancelReason === GUEST_CANCELED) return { cancel: 'оплата картой была отменена — деньги не списаны' }
  if (t.status !== 'open') return { cancel: 'стол уже закрыт — деньги не списаны' }
  const left = round2(reservedTotals(t, intent.id).remaining)
  const amount = round2(Math.min(pp.amount, left))
  if (amount < 1) return { cancel: 'счёт уже оплачен — деньги не списаны' }
  patchIntent(t, intentId, { status: 'authorized' })
  return { capture: amount }
}

/** Шаг 3б, под блокировкой: списанное — в счёт. Ровно та сумма, что взял эквайер. */
function record(deps: PayFlowDeps, t: TableSession, tableId: string, intentId: string, pp: ProviderPayment): MutationResult {
  const intent = intentOf(t, intentId)
  if (!intent) {
    // Деньги взяты, а стола уже нет — не теряем молча: пусть видит управляющая
    deps.audit('оплата без стола', tableId, `ЮKassa ${pp.id}: ${pp.amount} ₽ — вернуть гостю`, pp.amount, null)
    return fail(409, 'payment without table', { providerId: pp.id })
  }
  if (t.payments.some(p => p.providerId === pp.id)) {
    patchIntent(t, intentId, { status: 'succeeded' })
    return doneBody(t, tableId, { ...intent, status: 'succeeded' })
  }
  const persona = t.personas.find(p => p.id === intent.personaId) ?? null
  const money = computeTotals(t, priceOf)
  const mineBefore = round2(persona ? money.paidOf(persona.id) : 0)
  const payment: Payment = {
    id: crypto.randomUUID(),
    personaId: intent.personaId,
    amount: round2(pp.amount),
    scope: intent.scope,
    method: (pp.method as PayMethod | null) ?? intent.method,
    at: Date.now(),
    receiptNo: intent.receiptNo,
    lines: intent.lines,
    idemKey: intent.idemKey,
    providerId: pp.id
  }
  t.payments = [...t.payments, payment]
  patchIntent(t, intentId, { status: 'succeeded' })
  deps.audit('оплата', tableId, `${persona?.name ?? 'гость'} · ${intent.scope} · ${payment.method} · ЮKassa`, payment.amount, persona)
  const after = computeTotals(t, priceOf)
  // Между решением и списанием сняли блюдо — переплату видно сразу, а не на закрытии
  if (after.paidTotal - after.tableTotal > 0.01) {
    deps.audit('переплата к возврату', tableId, `ЮKassa ${pp.id}`, round2(after.paidTotal - after.tableTotal), persona)
  }
  deps.onPaid(t, persona)
  return ok({ ok: true, status: 'succeeded', amount: payment.amount, receipt: receiptOf(tableId, payment, persona, money, mineBefore) })
}

const lastCheck = new Map<string, number>()

/**
 * Чем кончилась оплата: гость вернулся со страницы эквайера, пришло уведомление
 * или клиент переспрашивает. Все пути сходятся сюда. `hintProviderId` — номер
 * платежа из уведомления: по нему снимаем заморозку, если стола уже нет.
 */
export async function settleIntent(
  deps: PayFlowDeps,
  tableId: string,
  intentId: string,
  opts: { hintProviderId?: string | null; force?: boolean; publicUrl?: string | null } = {}
): Promise<MutationResult> {
  const provider = paymentProvider()
  const t = await deps.read(tableId)
  const intent = intentOf(t, intentId)

  if (!intent) {
    if (provider && opts.hintProviderId) {
      // Номер из уведомления может быть выдуманным — это не ошибка сервера, а «не найдено»
      const pp = await provider.get(opts.hintProviderId).catch(() => null)
      if (!pp) return fail(404, 'payment not found')
      if (pp.metadata.intentId === intentId && pp.metadata.tableId === tableId) {
        // Стол закрыли и пересадили, а заморозка осталась: снимаем, чтобы деньги вернулись гостю
        if (pp.status === 'waiting_for_capture') await provider.cancel(pp.id, `${intentId}-cancel`)
        // Деньги уже списаны, а стола нет — не теряем молча: пусть видит управляющая
        if (pp.status === 'succeeded') {
          await deps.withTable(tableId, () => {
            deps.audit('оплата без стола', tableId, `ЮKassa ${pp.id}: ${pp.amount} ₽ — вернуть гостю или найти чек`, pp.amount, null)
            return ok()
          })
          await deps.after(tableId)
        }
      }
    }
    return fail(404, 'payment not found')
  }
  // Создание у эквайера сорвалось по связи — проверка статуса доводит его тем же ключом
  if (provider && !intent.providerId && intent.status === 'creating' && Date.now() - intent.at >= CREATING_MS && opts.publicUrl) {
    return startAtProvider(deps, tableId, intent.id, opts.publicUrl)
  }
  if (intent.status === 'succeeded') return doneBody(t, tableId, intent)
  if (!provider || !intent.providerId) {
    return intent.status === 'canceled' ? ok({ ok: true, status: 'canceled', reason: intent.cancelReason ?? 'платёж не прошёл' }) : ok({ ok: true, status: 'pending' })
  }

  const now = Date.now()
  // Уведомление эквайера не притормаживаем: иначе оно тонет в опросе гостя и не повторяется
  if (!opts.force && now - (lastCheck.get(intent.id) ?? 0) < RECHECK_MS && intent.status !== 'authorized') {
    return intent.status === 'canceled'
      ? ok({ ok: true, status: 'canceled', reason: intent.cancelReason ?? 'платёж не прошёл' })
      : ok({ ok: true, status: 'pending', confirmationUrl: intent.confirmationUrl })
  }
  lastCheck.set(intent.id, now)
  if (lastCheck.size > 5_000) lastCheck.clear()

  // Перечитываем и отменённое: сбой при создании мог отметить отказ, а гость заплатил
  const pp = await provider.get(intent.providerId)
  if (pp.id !== intent.providerId || (pp.metadata.intentId && pp.metadata.intentId !== intent.id)) return fail(409, 'payment mismatch')

  if (pp.status === 'pending') {
    // Отменённое гостем больше не предлагаем оплатить: ссылка банка может быть жива, но это уже не наш платёж
    if (intent.status === 'canceled') return ok({ ok: true, status: 'canceled', reason: intent.cancelReason ?? 'платёж отменён' })
    return ok({ ok: true, status: 'pending', confirmationUrl: intent.confirmationUrl })
  }

  if (pp.status === 'canceled') {
    const res = await deps.withTable(tableId, s => markCanceled(deps, s, tableId, intent.id, pp.cancelReason ?? 'платёж не прошёл'))
    await deps.after(tableId)
    return res
  }

  let captured = pp
  if (pp.status === 'waiting_for_capture') {
    const box: { decision: ReturnType<typeof decideCapture> } = { decision: { done: true } }
    await deps.withTable(tableId, s => {
      box.decision = decideCapture(s, intent.id, pp)
      return ok()
    })
    const decision = box.decision
    if ('cancel' in decision) {
      const reason = decision.cancel
      await provider.cancel(pp.id, `${intent.id}-cancel`)
      const res = await deps.withTable(tableId, s => markCanceled(deps, s, tableId, intent.id, reason))
      await deps.after(tableId)
      return res
    }
    if ('capture' in decision) captured = await provider.capture(pp.id, decision.capture, `${intent.id}-capture`)
  }

  if (captured.status !== 'succeeded') return ok({ ok: true, status: 'pending' })
  const res = await deps.withTable(tableId, s => record(deps, s, tableId, intent.id, captured))
  await deps.after(tableId)
  return res
}

/** Для снимка стола: кто сейчас платит и сколько зарезервировано. Без ссылок на оплату. */
export function pendingPaysOf(t: TableSession) {
  const now = Date.now()
  return (t.payIntents ?? []).filter(i => isReserving(i, now)).map(i => ({ personaId: i.personaId, amount: i.amount, scope: i.scope, at: i.at }))
}

/** Остатки с учётом резерва: столько сервер и спишет, если гость нажмёт «Оплатить». */
export function reservedView(t: TableSession) {
  const money = reservedTotals(t)
  return {
    remaining: round2(money.remaining),
    byPersona: t.personas.map(p => ({ personaId: p.id, paid: round2(money.paidOf(p.id)), remaining: round2(money.remainingOf(p.id)) }))
  }
}

/**
 * Гость передумал платить картой (ушёл со страницы банка, решил наличными).
 * Заморозку снимать не нужно: если банк всё же подтвердит, списание решит,
 * что счёт уже оплачен, и снимет её само.
 */
export function cancelIntent(t: TableSession, tableId: string, persona: Persona, audit: PayFlowDeps['audit']): MutationResult {
  const mine = (t.payIntents ?? []).filter(i => i.personaId === persona.id && isReserving(i) && i.status !== 'authorized')
  if (!mine.length) return fail(409, 'nothing to cancel')
  for (const i of mine) patchIntent(t, i.id, { status: 'canceled', cancelReason: GUEST_CANCELED })
  audit('отменил оплату картой', tableId, persona.name, mine.reduce((a, i) => a + i.amount, 0), persona)
  return ok({ ok: true })
}
