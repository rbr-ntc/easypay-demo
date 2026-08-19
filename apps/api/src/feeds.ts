// Витрины персонала: карточки зала и очередь кухни. Считаются из состояния столов.
import { computeTotals, isBillLine, round2 } from '@easypay/domain/money'
import { summarizeHall } from '@easypay/domain/hall'
import { sortTickets, summarizeKitchen, ticketUrgency } from '@easypay/domain/kitchen'
import { dishName, priceOf, stationOf, allergensOf, removedAllergensOf } from './menu.ts'
import { HALL, metaOf, planTables } from './hallplan.ts'
import { waiterOfTable } from './staff.ts'
import type { Call, TableSession } from './types.ts'


function firstCall(table: TableSession) {
  const call = (table.calls ?? [])[0]
  if (!call) return null
  return {
    // id нужен, чтобы снять вызов одним запросом: раньше официант шёл за ним в стол
    id: call.id,
    at: call.at,
    reason: call.reason,
    // Текст гостя: «аллергия на орехи» — официант идёт подготовленным
    note: call.note ?? null,
    name: table.personas.find(p => p.id === call.personaId)?.name ?? 'Гость'
  }
}

/** Компактная карточка стола: из неё shared/hall.js считает статус, таймеры и алерты. */
export function hallCard(id: string, table: TableSession) {
  const meta = metaOf(id)
  const money = computeTotals(table, priceOf)
  const pending = table.lines.filter(l => isBillLine(l) && !l.served)
  const sentAts = table.lines.filter(l => l.sentAt && !l.cancelled).map(l => l.sentAt)
  const servedAts = table.lines.filter(l => l.servedAt).map(l => l.servedAt)
  const payAts = table.payments.map(p => p.at)
  const waiter = waiterOfTable(id)

  return {
    id,
    zoneId: meta?.zoneId ?? 'other',
    zoneName: meta?.zoneName ?? 'Вне плана',
    seats: meta?.seats ?? 0,
    waiterId: waiter?.id ?? null,
    waiterName: waiter?.name ?? null,
    status: table.status,
    openedAt: table.openedAt,
    closedAt: table.closedAt,
    // Стол свободен, когда его убрали, а не когда прошло пять минут
    cleanedAt: table.cleanedAt ?? null,
    guests: table.personas.length,
    personas: table.personas.map(p => ({ name: p.name, animal: p.animal })),
    tableTotal: round2(money.tableTotal),
    paidTotal: round2(money.paidTotal),
    remaining: round2(money.remaining),
    draftTotal: round2(money.draftTotal),
    sentCount: table.lines.filter(isBillLine).length,
    kitchenPending: pending.length,
    // Готово и ждёт официанта: между плитой и столом раньше была дыра
    readyCount: pending.filter(l => l.readyAt && !l.served).length,
    oldestPendingSentAt: pending.length ? Math.min(...pending.map(l => l.sentAt ?? 0)) : null,
    lastSentAt: sentAts.length ? Math.max(...(sentAts as number[])) : null,
    lastServedAt: servedAts.length ? Math.max(...(servedAts as number[])) : null,
    lastPaidAt: payAts.length ? Math.max(...payAts) : null,
    tipsTotal: round2(table.tips.reduce((s, t) => s + t.amount, 0)),
    call: firstCall(table),
    calls: (table.calls ?? []).length,
    // Гость просит принять наличные: официант должен увидеть это в зале,
    // а не проваливаться в каждый стол по очереди
    cashIntent: table.cashIntent
      ? {
          amount: round2(table.cashIntent.amount),
          at: table.cashIntent.at,
          scope: table.cashIntent.scope,
          personaId: table.cashIntent.personaId,
          name: table.personas.find(p => p.id === table.cashIntent!.personaId)?.name ?? 'Гость'
        }
      : null
  }
}

export function hallPayload(tables: Map<string, TableSession>, shift: any) {
  const now = Date.now()
  const cards = planTables().map(t => hallCard(t.id, tables.get(t.id) ?? emptyLike()))
  // Столы вне плана (подделанный QR или тестовый прогон) показываем отдельно
  for (const [id, table] of tables) {
    if (!metaOf(id) && table.status === 'open') cards.push(hallCard(id, table))
  }

  const summary = summarizeHall(cards, shift, now)
  return {
    restaurant: HALL.restaurant,
    zones: HALL.zones.map(z => ({ id: z.id, name: z.name })),
    tables: cards,
    shift: {
      tables: shift.tables,
      // Все деньги смены: закрытые столы плюс уже оплаченное на открытых
      revenue: round2(shift.revenue),
      // Только закрытые столы — именно с этим числом сходится реестр чеков
      closedRevenue: round2(shift.closedRevenue),
      guests: shift.guestsSeen,
      debt: round2(shift.debt),
      // Снятое с кухни: еду не отдали, ингредиенты потеряли — это не долг гостя
      writtenOff: round2(shift.writtenOff ?? 0),
      tips: round2(Object.values(shift.tipsByStaff ?? {}).reduce((s: number, x: any) => s + Number(x), 0)),
      overpaid: round2(shift.overpaid),
      tablesWithRevenue: shift.tablesWithRevenue,
      startedAt: shift.startedAt
    },
    summary,
    now
  }
}

function emptyLike(): TableSession {
  return { sessionId: null, status: 'closed', openedAt: null, closedAt: null, personas: [], lines: [], payments: [], tips: [], calls: [], seq: 1 }
}

/** Тикет = отправленная, но ещё не поданная позиция. Кухня видит весь ресторан сразу. */
export function kitchenPayload(tables: Map<string, TableSession>) {
  const now = Date.now()
  const tickets: any[] = []
  const cancelled: any[] = []

  for (const [id, table] of tables) {
    const meta = metaOf(id)
    const waiter = waiterOfTable(id)
    for (const line of table.lines) {
      if (!line.sent) continue
      const persona = table.personas.find(p => p.id === line.personaId)
      const base = {
        tableId: id,
        sessionId: table.sessionId,
        zoneName: meta?.zoneName ?? 'Вне плана',
        waiterName: waiter?.name ?? null,
        uid: line.uid,
        dishId: line.dishId,
        name: dishName(line.dishId),
        station: stationOf(line.dishId),
        allergens: allergensOf(line.dishId, line.options ?? {}),
        // Аллергены, снятые модификатором: для повара это не пожелание, а запрет
        removedAllergens: removedAllergensOf(line.dishId, line.options ?? {}),
        // Живой текст гостя: «аллергия на орехи, критично»
        comment: line.comment ?? null,
        qty: line.qty,
        options: line.options ?? {},
        shared: !!line.shared,
        guest: persona?.name ?? 'Гость',
        animal: persona?.animal ?? 'fox',
        sentAt: line.sentAt,
        startedAt: line.startedAt ?? null,
        readyAt: line.readyAt ?? null,
        // Позиции одной отправки идут вместе: это «волна» подачи
        waveAt: line.sentAt
      }

      if (line.cancelled) {
        // Отмена висит, пока повар её не подтвердит: блюдо может быть уже на плите,
        // а таймер молча снимал запись раньше, чем повар подходил к экрану
        if (!line.cancelAck) {
          cancelled.push({
            ...base,
            cancelledAt: line.cancelledAt,
            reason: line.cancelReason ?? 'стол закрыт',
            // Блюдо уже было на плите — это потеря продукта, а не просто вычерк
            wasCooking: !!line.startedAt
          })
        }
        continue
      }
      if (line.served) continue
      if (table.status !== 'open') continue
      tickets.push(base)
    }
  }

  const sorted = sortTickets(tickets)
  return {
    tickets: sorted,
    cancelled: cancelled.sort((a, b) => b.cancelledAt - a.cancelledAt),
    summary: {
      ...summarizeKitchen(sorted, now),
      bar: sorted.filter(t => t.station === 'bar').length,
      kitchen: sorted.filter(t => t.station === 'kitchen').length,
      cancelled: cancelled.length,
      warn: sorted.filter(x => ticketUrgency(x as any, now) === 'warn').length,
      // Сколько тарелок стоит на раздаче и ждёт официанта
      ready: sorted.filter(x => x.readyAt).length
    },
    now
  }
}
