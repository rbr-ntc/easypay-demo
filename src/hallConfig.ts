import hallJson from './hall.json'

export interface HallTableConfig {
  id: string
  seats: number
}

export interface HallZoneConfig {
  id: string
  name: string
  tables: HallTableConfig[]
}

export interface HallConfig {
  restaurant: string
  zones: HallZoneConfig[]
}

export const HALL = hallJson as HallConfig

const BY_TABLE = new Map<string, { zone: HallZoneConfig; table: HallTableConfig }>()
for (const zone of HALL.zones) {
  for (const table of zone.tables) BY_TABLE.set(String(table.id), { zone, table })
}

/** Зона стола из плана зала. Для стола вне плана — null. */
export function zoneOfTable(id: string): string | null {
  return BY_TABLE.get(id)?.zone.name ?? null
}

export function seatsOfTable(id: string): number | null {
  return BY_TABLE.get(id)?.table.seats ?? null
}
