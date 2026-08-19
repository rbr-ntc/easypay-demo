// План зала: какие столы существуют, в какой зоне и на сколько мест.
import { hall } from '@easypay/config'

export const HALL = hall

const TABLE_META = new Map<string, { zoneId: string; zoneName: string; seats: number }>()
for (const zone of HALL.zones) {
  for (const table of zone.tables) {
    TABLE_META.set(String(table.id), { zoneId: zone.id, zoneName: zone.name, seats: table.seats })
  }
}

/** Столы вне плана обычно означают подделанный QR. В тестах разрешаем переменной. */
const ALLOW_ANY_TABLE = process.env.EASYPAY_ANY_TABLE === '1'

export function metaOf(id: string) {
  return TABLE_META.get(String(id)) ?? null
}

export function isKnownTable(id: string) {
  return TABLE_META.has(String(id)) || ALLOW_ANY_TABLE
}

export function planTables() {
  return [...TABLE_META.entries()].map(([id, meta]) => ({ id, ...meta }))
}

export function seatsOf(id: string) {
  return TABLE_META.get(String(id))?.seats ?? 12
}
