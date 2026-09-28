// Визит для «Гости и качество» из живой сессии стола — для хранилища в памяти
// и для столов, которые ещё открыты. Postgres собирает то же самое запросом.

import type { QualityVisit } from '@easypay/domain/quality'
import { metaOf } from './hallplan.ts'
import { staffName, waiterOfTable } from './staff.ts'
import type { TableSession } from './types.ts'

export interface Resolution {
  at: number
  by: string | null
  text: string
}

/** Кто обслуживал посадку: кому ушли чаевые, кто подходил на вызовы; иначе — чей стол сейчас. */
function servedBy(tableId: string, t: TableSession): { id: string | null; name: string | null } {
  const tipper = t.tips.find(x => x.waiterId)?.waiterId
  const acks = (t.callAcks ?? []).map(a => a.byId).filter((x): x is string => !!x && x !== 'token')
  const top = [...acks].sort((a, b) => acks.filter(x => x === b).length - acks.filter(x => x === a).length)[0]
  const id = tipper ?? top ?? null
  if (id && staffName(id)) return { id, name: staffName(id) }
  const now = waiterOfTable(tableId)
  return { id: now?.id ?? null, name: now?.name ?? null }
}

export const resolutionKey = (sessionId: string, guestId: string) => `${sessionId}:${guestId}`

export function visitOf(tableId: string, t: TableSession, resolutions: Map<string, Resolution>): QualityVisit | null {
  if (!t.sessionId || !t.openedAt) return null
  const nameOf = (id: string) => t.personas.find(p => p.id === id)?.name ?? null
  const waiter = servedBy(tableId, t)
  return {
    sessionId: t.sessionId,
    tableId,
    zone: metaOf(tableId)?.zoneName ?? null,
    openedAt: t.openedAt,
    closedAt: t.closedAt ?? null,
    guests: t.personas.length,
    waiterId: waiter?.id ?? null,
    waiter: waiter?.name ?? null,
    ratings: (t.ratings ?? []).map(r => {
      const found = resolutions.get(resolutionKey(t.sessionId!, r.personaId))
      // Гость переоценил после «разобрано» — это новая оценка, старая отметка к ней не относится
      const res = found && found.at >= r.at ? found : undefined
      return {
        guestId: r.personaId,
        guest: nameOf(r.personaId),
        rating: r.rating,
        note: r.note,
        at: r.at,
        resolvedAt: res?.at ?? null,
        resolvedBy: res?.by ?? null,
        resolution: res?.text ?? null
      }
    }),
    // Только вызовы, принятые человеком: снятые системой (гость заплатил) — не ожидание
    callWaits: t.callWaits ?? [],
    kitchenWaits: t.lines.filter(l => l.sentAt && l.servedAt && !l.cancelled).map(l => l.servedAt! - l.sentAt!),
    tips: t.tips.reduce((a, x) => a + x.amount, 0)
  }
}
