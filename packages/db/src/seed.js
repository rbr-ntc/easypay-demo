// Наполнение базы данными заведения из packages/config.
// Это мост между нынешними файлами и БД: пока кабинета нет, план зала и персонал
// заводятся отсюда. Повторный запуск безопасен — всё через upsert по естественным ключам.
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hall, staff as staffConfig } from '@easypay/config'
import { connect } from './client.js'

/** PIN хранится хешем: в файле он был только для демо. */
export function hashPin(pin, salt = 'easypay') {
  return crypto.scryptSync(String(pin), salt, 32).toString('base64')
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

// Те же перекрытия PIN, что и у сервера: EASYPAY_STAFF_PINS="max=4821,boss=7390"
const pinOverrides = Object.fromEntries(
  String(process.env.EASYPAY_STAFF_PINS ?? '')
    .split(',')
    .map(pair => pair.split('=').map(x => x.trim()))
    .filter(([id, pin]) => id && pin)
)

export async function seed(sql, { orgName = 'EasyPay', venueName = hall.restaurant } = {}) {
  return sql.begin(async tx => {
    const [organization] = await tx`
      insert into organizations (name) values (${orgName})
      on conflict (name) do update set name = excluded.name
      returning *
    `

    const [venue] = await tx`
      insert into venues (org_id, name) values (${organization.id}, ${venueName})
      on conflict (org_id, name) do update set name = excluded.name
      returning *
    `

    // Зоны и столы из плана зала
    let tables = 0
    for (const [sort, zoneCfg] of hall.zones.entries()) {
      const [existingZone] = await tx`
        select * from zones where venue_id = ${venue.id} and name = ${zoneCfg.name} limit 1
      `
      const zone =
        existingZone ??
        (
          await tx`
            insert into zones (venue_id, name, sort) values (${venue.id}, ${zoneCfg.name}, ${sort})
            returning *
          `
        )[0]

      for (const t of zoneCfg.tables) {
        const number = String(t.id)
        // Слаг глобально уникален: QR одной точки не должен открывать стол в другой
        const slug = `${venue.id.slice(0, 8)}-${number}`
        await tx`
          insert into restaurant_tables (venue_id, zone_id, number, seats, qr_slug)
          values (${venue.id}, ${zone.id}, ${number}, ${t.seats}, ${slug})
          on conflict (venue_id, number) do update
            set zone_id = excluded.zone_id, seats = excluded.seats
        `
        tables += 1
      }
    }

    // Персонал: PIN превращается в хеш, закрепление столов — в связь
    let staffCount = 0
    for (const person of staffConfig.staff) {
      const [existing] = await tx`
        select * from staff where org_id = ${organization.id} and (ext_id = ${person.id} or name = ${person.name}) limit 1
      `
      const row =
        existing ??
        (
          await tx`
            insert into staff (org_id, venue_id, name, role, pin_hash, ext_id)
            values (${organization.id}, ${venue.id}, ${person.name}, ${person.role}, ${hashPin(pinOverrides[person.id] ?? person.pin)}, ${person.id})
            returning *
          `
        )[0]

      // PIN уже заведённого сотрудника не трогаем: менеджер мог сменить его в кабинете,
      // а повторный сид молча возвращал публичные демо-коды (смена №6, Б1)
      await tx`update staff set ext_id = ${person.id} where id = ${row.id}`

      await tx`delete from staff_tables where staff_id = ${row.id}`
      for (const number of person.tables ?? []) {
        await tx`
          insert into staff_tables (staff_id, table_id)
          select ${row.id}, id from restaurant_tables
          where venue_id = ${venue.id} and number = ${String(number)}
          on conflict do nothing
        `
      }
      staffCount += 1
    }

    return { organization: organization.name, venue: venue.name, venueId: venue.id, tables, staff: staffCount }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = connect({ max: 1 })
  try {
    const result = await seed(sql)
    console.log(
      `организация «${result.organization}», точка «${result.venue}»: столов ${result.tables}, сотрудников ${result.staff}`
    )
  } finally {
    await sql.end()
  }
}
