import { ProviderError, type CreatePayment, type PaymentProvider, type ProviderPayment, type ProviderStatus } from './provider.ts'

// ЮKassa API v3: https://yookassa.ru/developers/api
// Аутентификация — Basic shopId:секретный ключ, повторы — заголовок Idempotence-Key
// (живёт 24 часа). Статус платежа после оплаты мы НЕ берём из уведомления на веру:
// уведомление — только повод перечитать платёж из API.

const API = 'https://api.yookassa.ru/v3'
const TIMEOUT_MS = 15_000

/** Причины отмены — гостю словами, а не кодами. */
const CANCEL_REASONS: Record<string, string> = {
  insufficient_funds: 'недостаточно средств',
  card_expired: 'истёк срок карты',
  expired_on_confirmation: 'время на оплату вышло',
  expired_on_capture: 'время на подтверждение вышло',
  permission_revoked: 'оплата отменена',
  fraud_suspected: 'банк заподозрил мошенничество',
  general_decline: 'банк отклонил платёж',
  invalid_card_number: 'неверный номер карты',
  invalid_csc: 'неверный код CVC',
  issuer_unavailable: 'банк недоступен',
  payment_method_limit_exceeded: 'превышен лимит по карте',
  payment_method_restricted: 'способ оплаты ограничен',
  country_forbidden: 'оплата из этой страны недоступна',
  '3d_secure_failed': 'не пройдена проверка 3-D Secure',
  canceled_by_merchant: 'оплата отменена'
}

const METHODS: Record<string, string> = { bank_card: 'card', sbp: 'sbp', yoo_money: 'card', sberbank: 'sber', tinkoff_bank: 'tpay' }

function toPayment(raw: any): ProviderPayment {
  return {
    id: String(raw.id),
    status: raw.status as ProviderStatus,
    amount: Number(raw.amount?.value ?? 0),
    confirmationUrl: raw.confirmation?.confirmation_url ?? null,
    method: raw.payment_method?.type ? (METHODS[raw.payment_method.type] ?? 'card') : null,
    cancelReason: raw.cancellation_details?.reason ? (CANCEL_REASONS[raw.cancellation_details.reason] ?? 'платёж не прошёл') : null,
    metadata: raw.metadata ?? {}
  }
}

export function createYooKassa(shopId: string, secretKey: string, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const auth = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64')

  async function call(method: 'GET' | 'POST', path: string, body?: object, idemKey?: string): Promise<any> {
    const headers: Record<string, string> = { Authorization: auth, 'Content-Type': 'application/json' }
    if (idemKey) headers['Idempotence-Key'] = idemKey
    let res: Response
    try {
      res = await fetchImpl(API + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (err) {
      throw new ProviderError('эквайер не ответил', 504, err instanceof Error ? err.name : null)
    }
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new ProviderError(data.description ?? `эквайер ответил ${res.status}`, res.status, data.code ?? null)
    // 202 «ещё обрабатываю» на повтор с тем же ключом — это не платёж, а просьба повторить позже
    if (res.status === 202 || (data.type === 'processing' && !data.id)) throw new ProviderError('эквайер ещё обрабатывает запрос', 503, 'processing')
    return data
  }

  return {
    name: 'yookassa',
    async create(req: CreatePayment) {
      const raw = await call(
        'POST',
        '/payments',
        {
          amount: { value: req.amount.toFixed(2), currency: 'RUB' },
          // Двухстадийно: замораживаем, а списывает сервер, решив сумму под блокировкой стола.
          // СБП двухстадийную не умеет — для неё в проде понадобится capture:true и возврат переплаты
          capture: false,
          confirmation: { type: 'redirect', return_url: req.returnUrl },
          description: req.description.slice(0, 128),
          metadata: req.metadata
        },
        req.idemKey
      )
      return toPayment(raw)
    },
    async get(id: string) {
      return toPayment(await call('GET', `/payments/${encodeURIComponent(id)}`))
    },
    async capture(id: string, amount: number, idemKey: string) {
      const raw = await call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount: { value: amount.toFixed(2), currency: 'RUB' } }, idemKey)
      return toPayment(raw)
    },
    async cancel(id: string, idemKey: string) {
      return toPayment(await call('POST', `/payments/${encodeURIComponent(id)}/cancel`, {}, idemKey))
    },
    async refund(paymentId: string, amount: number, idemKey: string) {
      const raw = await call('POST', '/refunds', { payment_id: paymentId, amount: { value: amount.toFixed(2), currency: 'RUB' } }, idemKey)
      return { id: String(raw.id), status: String(raw.status) }
    }
  }
}
