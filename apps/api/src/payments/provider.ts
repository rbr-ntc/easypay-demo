// Провайдер оплаты — граница между правилами стола и эквайером. Сумму и то,
// за что платят, решает сервер (money.ts); провайдер только берёт деньги.
// Сейчас это ЮKassa (тестовый магазин), в проде — Т-Касса: замена провайдера
// не должна трогать ничего, кроме этой папки.

export type ProviderStatus = 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'

export interface ProviderPayment {
  id: string
  status: ProviderStatus
  amount: number
  /** Куда отправить гостя платить: страница эквайера. */
  confirmationUrl: string | null
  /** Чем заплатил на самом деле: карта, СБП, кошелёк — узнаём после оплаты. */
  method: string | null
  /** Почему отменён: «недостаточно средств», «отказ банка» — гостю словами. */
  cancelReason: string | null
  metadata: Record<string, string>
}

export interface CreatePayment {
  amount: number
  description: string
  /** Ключ идемпотентности: повтор запроса не создаёт второй платёж. */
  idemKey: string
  returnUrl: string
  metadata: Record<string, string>
}

/**
 * Оплата двухстадийная: эквайер сначала только замораживает деньги
 * (`waiting_for_capture`), а списывает сервер, когда под блокировкой стола
 * решит сколько. Так поздний платёж за уже закрытый стол не теряется и не
 * списывается лишний раз — заморозка просто снимается (ревью оплаты, C1/H5).
 */
export interface PaymentProvider {
  readonly name: string
  create(req: CreatePayment): Promise<ProviderPayment>
  get(id: string): Promise<ProviderPayment>
  /** Списать замороженное — ровно столько, сколько решил сервер (не больше заморозки). */
  capture(id: string, amount: number, idemKey: string): Promise<ProviderPayment>
  /** Снять заморозку: стол закрыт или уже оплачен — деньги гостю не списываются. */
  cancel(id: string, idemKey: string): Promise<ProviderPayment>
  refund(paymentId: string, amount: number, idemKey: string): Promise<{ id: string; status: string }>
}

/** Ошибка эквайера: код и человеческий текст, без внутренностей API. */
export class ProviderError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}
