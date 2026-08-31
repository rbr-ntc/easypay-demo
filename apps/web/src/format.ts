export function fmt(n: number): string {
  const neg = n < 0
  const abs = Math.abs(n)
  const r = Math.round(abs * 100) / 100
  const isInt = Math.abs(r - Math.round(r)) < 0.005
  let out: string
  if (isInt) {
    out = Math.round(r).toLocaleString('ru-RU')
  } else {
    const [int, frac] = r.toFixed(2).split('.')
    out = Number(int).toLocaleString('ru-RU') + ',' + frac
  }
  return (neg ? '−' : '') + out + ' ₽'
}

/**
 * Перечисление имён по-русски: «Глеб и Мила», «Глеб, Мила и Ника».
 * Простой join через « и » давал «Глеб и Глеб и Глеб» — читается как заикание.
 */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
}
