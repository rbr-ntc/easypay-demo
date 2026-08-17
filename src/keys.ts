// Ключ идемпотентности для мутаций. crypto.randomUUID() недоступен в незащищённом
// контексте (демо работает по http, без домена и TLS), поэтому собираем ключ сами.
export function newIdemKey(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  if (typeof c?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
