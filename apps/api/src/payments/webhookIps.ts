// Уведомления ЮKassa приходят только с её адресов (https://yookassa.ru/developers/using-api/webhooks).
// Без проверки любой мог слать поддельные уведомления, и на каждое сервер ходил
// в API эквайера — квоту можно было выжечь снаружи (смена №7, Б1).

const V4 = ['185.71.76.0/27', '185.71.77.0/27', '77.75.153.0/25', '77.75.156.11/32', '77.75.156.35/32', '77.75.154.128/25']
const V6_PREFIX = '2a02:5180:'

const toInt = (ip: string) => ip.split('.').reduce((a, x) => (a << 8) + Number(x), 0) >>> 0

function inCidr(ip: string, cidr: string): boolean {
  const [net, bits] = cidr.split('/')
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (toInt(ip) & mask) === (toInt(net) & mask)
}

export function isYooKassaIp(raw: string): boolean {
  const ip = raw.replace(/^::ffff:/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return V4.some(c => inCidr(ip, c))
  return ip.toLowerCase().startsWith(V6_PREFIX)
}
