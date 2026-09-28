// Секрет стола в QR. Раньше в QR был только номер стола: из интернета можно было
// сесть за любой стол, прочитать имена и аллергии гостей, заказать общее блюдо
// за их счёт и занять все места (смена №6, Б4). Теперь в QR — подпись стола:
// сесть можно, только отсканировав тент на столе. Кто уже сидит, работает по
// своему личному токену, как раньше.
//
// Подпись — HMAC от номера стола и версии: сменить все тенты разом (утёк снимок
// QR) — поднять EASYPAY_QR_VERSION и распечатать заново.

import crypto from 'node:crypto'

/** Проверка включена, если задан секрет: в тестах и разработке — нет. */
export const qrRequired = () => !!process.env.EASYPAY_QR_SECRET

export function tableKey(tableId: string): string {
  const secret = process.env.EASYPAY_QR_SECRET ?? ''
  const version = process.env.EASYPAY_QR_VERSION ?? '1'
  return crypto.createHmac('sha256', secret).update(`table:${tableId}:v${version}`).digest('base64url').slice(0, 12)
}

export function keyMatches(tableId: string, key: unknown): boolean {
  if (!qrRequired()) return true
  if (typeof key !== 'string') return false
  // Сравниваем байты, а не символы: «ё» — два байта, и длина в символах обманула бы
  const given = Buffer.from(key, 'utf8')
  const want = Buffer.from(tableKey(tableId), 'utf8')
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

/** Чтобы защита не оказалась выключенной незаметно: в логе при старте видно, что с ней. */
export function describeQrCheck(): string {
  if (!qrRequired()) return 'QR-подпись столов: выключена (нет EASYPAY_QR_SECRET) — за стол садятся по номеру'
  const weak = (process.env.EASYPAY_QR_SECRET ?? '').length < 32 ? ' — секрет короче 32 символов, замените' : ''
  return `QR-подпись столов: включена, версия ${process.env.EASYPAY_QR_VERSION ?? '1'}${weak}`
}
