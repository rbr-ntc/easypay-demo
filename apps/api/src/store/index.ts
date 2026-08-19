// Выбор хранилища: память по умолчанию (тесты, демо без базы), Postgres в проде.
// Переключается переменной EASYPAY_STORE=postgres.
import { createMemoryStore } from './memory.ts'
import type { Store } from './types.ts'

export type { Store } from './types.ts'
export { emptySession } from './memory.ts'

export async function createStore(kind = process.env.EASYPAY_STORE ?? 'memory'): Promise<Store> {
  if (kind === 'postgres') {
    // Драйвер подгружается только когда он действительно нужен: демо на памяти
    // не должно требовать установленного postgres.js
    const { createPostgresStore } = await import('./postgres.ts')
    return createPostgresStore()
  }
  return createMemoryStore()
}
