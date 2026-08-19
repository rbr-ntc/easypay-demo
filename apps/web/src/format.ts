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
