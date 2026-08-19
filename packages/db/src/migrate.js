// Простой миграционный раннер: файлы из migrations/ применяются по порядку один раз.
// Явный SQL выбран осознанно — в деньгах важнее читаемость запроса, чем краткость ORM.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

export async function migrate(sql) {
  await sql`
    create table if not exists schema_migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    )
  `
  const applied = new Set((await sql`select name from schema_migrations`).map(r => r.name))
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  const fresh = []
  for (const file of files) {
    if (applied.has(file)) continue
    const body = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    await sql.begin(async tx => {
      await tx.unsafe(body)
      await tx`insert into schema_migrations (name) values (${file})`
    })
    fresh.push(file)
  }
  return fresh
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = connect({ max: 1 })
  try {
    const applied = await migrate(sql)
    console.log(applied.length ? `применены миграции: ${applied.join(', ')}` : 'миграции уже применены')
  } finally {
    await sql.end()
  }
}
