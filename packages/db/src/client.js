// Подключение к Postgres. Строка берётся из DATABASE_URL — по умолчанию локальный docker-compose.
import postgres from 'postgres'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://easypay:easypay@127.0.0.1:5433/easypay'

/** Соединение. `max: 1` для миграций и тестов, больше — для сервера. */
export function connect({ max = 10, url = DATABASE_URL } = {}) {
  return postgres(url, {
    max,
    // Деньги приходят как строки, чтобы не терять копейки на float
    types: { numeric: { to: 1700, from: [1700], serialize: String, parse: String } },
    onnotice: () => {}
  })
}
