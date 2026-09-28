// Ограничение частоты по адресу: скользящее окно в памяти одного процесса.
// Гость за столом делает десяток действий в минуту, скрипт — сотни. Смена №6
// (Б7): гостевые действия шли без всякого потолка — стол можно было засыпать
// позициями и вызовами из интернета.

interface Bucket {
  count: number
  resetAt: number
}

export function createRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, Bucket>()

  const sweep = () => {
    const now = Date.now()
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key)
  }

  return {
    /** Сколько секунд ждать, если лимит исчерпан, иначе 0 — и попытка засчитана. */
    hit(key: string): number {
      const now = Date.now()
      if (buckets.size > 10_000) sweep()
      const b = buckets.get(key)
      if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return 0
      }
      if (b.count >= limit) return Math.ceil((b.resetAt - now) / 1000)
      buckets.set(key, { count: b.count + 1, resetAt: b.resetAt })
      return 0
    }
  }
}
