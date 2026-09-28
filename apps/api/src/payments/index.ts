import type { PaymentProvider } from './provider.ts'
import { createYooKassa } from './yookassa.ts'

export type { PaymentProvider, ProviderPayment } from './provider.ts'
export { ProviderError } from './provider.ts'

let override: PaymentProvider | null | undefined

/**
 * Эквайер из окружения: есть ключи ЮKassa — платим через неё, нет — демо, где
 * «оплата» просто записывается (как было до эквайринга). Ключи живут только в
 * окружении службы на стенде, не в репозитории.
 */
export function paymentProvider(): PaymentProvider | null {
  if (override !== undefined) return override
  const shopId = process.env.YOOKASSA_SHOP_ID
  const key = process.env.YOOKASSA_SECRET_KEY
  return shopId && key ? createYooKassa(shopId, key) : null
}

/** Для тестов: подменить эквайера (null — демо без эквайера). */
export function setPaymentProvider(p: PaymentProvider | null | undefined) {
  override = p
}
