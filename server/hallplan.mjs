// План зала: какие столы существуют, в какой зоне и на сколько мест.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const HALL = JSON.parse(readFileSync(path.join(__dirname, '..', 'src', 'hall.json'), 'utf8'))

const TABLE_META = new Map()
for (const zone of HALL.zones) {
  for (const table of zone.tables) {
    TABLE_META.set(String(table.id), { zoneId: zone.id, zoneName: zone.name, seats: table.seats })
  }
}

/** Столы вне плана обычно означают подделанный QR. В тестах разрешаем переменной. */
const ALLOW_ANY_TABLE = process.env.EASYPAY_ANY_TABLE === '1'

export function metaOf(id) {
  return TABLE_META.get(String(id)) ?? null
}

export function isKnownTable(id) {
  return TABLE_META.has(String(id)) || ALLOW_ANY_TABLE
}

export function planTables() {
  return [...TABLE_META.entries()].map(([id, meta]) => ({ id, ...meta }))
}

export function seatsOf(id) {
  return TABLE_META.get(String(id))?.seats ?? 12
}
