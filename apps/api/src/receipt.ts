// Чек заказа: номер, реквизиты, состав и пометки, из-за которых строки могут
// не сходиться со списанной суммой. Не фискальный документ — его пробивает касса.
//
// Смена №5 нашла четыре способа, которыми чек врал гостю: «поровну» перечислял
// весь стол без пометки, доплата показывала все позиции гостя при списании
// 428 ₽, доля общего блюда в чеке расходилась со списанием на копейку, а у
// наличных состава не было вовсе. Всё это собрано здесь, в одном месте.

import crypto from 'node:crypto'
import { isBillLine, round2, sharersOf, type MoneyTotals, type PayScope } from '@easypay/domain/money'
import { dishName, getDish } from './menu.ts'
import { currentSettings } from './settings.ts'
import type { Persona, TableSession } from './types.ts'

/**
 * Номер, который гость может назвать в споре. Раньше это был «стол-порядковый
 * номер платежа в посадке-хвост времени»: у следующих гостей за тем же столом
 * снова «2-001-…», а хвост повторялся каждые 100 секунд.
 */
export function receiptNoOf(tableId: string, kind: 'pay' | 'tip' = 'pay'): string {
  const stamp = Date.now().toString(36).toUpperCase()
  const salt = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `${tableId}-${kind === 'tip' ? 'Ч' : ''}${stamp}-${salt}`
}

/** Реквизиты заведения из настроек: без них чек — просто список блюд. */
export function venueOfReceipt() {
  const v = currentSettings().venue
  return { name: v.name, address: v.address || null, legal: v.legal || null, inn: v.inn || null }
}

/** «Прожарка: Medium rare · Гарнир: фри» вместо `{"roast":…}`. */
export function optionsText(dishId: string, options: Record<string, string>): string | null {
  const spec = getDish(dishId)?.options ?? []
  const parts = Object.entries(options ?? {}).map(([id, value]) => {
    const name = spec.find((o: any) => o.id === id)?.name
    return name ? `${name}: ${value}` : value
  })
  return parts.length ? parts.join(' · ') : null
}

export interface ReceiptLine {
  name: string
  qty: number
  price: number
  options: Record<string, string>
  optionsText: string | null
  shared: boolean
  share: number | null
}

/**
 * Строки чека. Для «своего» — свои блюда и доли общих; доли берутся из того
 * же разложения копеек, что и сумма к оплате (`shareOf`), поэтому строки
 * складываются ровно в списанное, а не расходятся на копейку.
 */
export function receiptLines(t: TableSession, money: MoneyTotals, persona: Persona | null, scope: PayScope): ReceiptLine[] {
  const ids = t.personas.map(p => p.id)
  const bill = t.lines.filter(isBillLine)
  const mine = persona && scope === 'own'
  const covered = bill.filter(l => !mine || l.personaId === persona!.id || (l.shared && sharersOf(l, ids).includes(persona!.id)))

  // Доли общих блюд персоны: сырые по позициям, хвост — на последнюю, чтобы
  // сумма совпала с shareOf, по которому считается списание
  const sharedMine = mine ? covered.filter(l => l.shared) : []
  const raw = sharedMine.map(l => (l.price * l.qty) / Math.max(1, sharersOf(l, ids).length))
  const rounded = raw.map(round2)
  if (mine && rounded.length) {
    const drift = round2(money.shareOf(persona!.id) - rounded.reduce((s, x) => s + x, 0))
    rounded[rounded.length - 1] = round2(rounded[rounded.length - 1] + drift)
  }

  return covered.map(l => {
    const i = sharedMine.indexOf(l)
    return {
      name: dishName(l.dishId),
      qty: l.qty,
      price: l.price,
      options: l.options ?? {},
      optionsText: optionsText(l.dishId, l.options ?? {}),
      shared: !!l.shared,
      share: l.shared ? (i >= 0 ? rounded[i] : round2((l.price * l.qty) / Math.max(1, sharersOf(l, ids).length))) : null
    }
  })
}

/**
 * Почему строки чека не равны списанному — словами. Раньше пометка была
 * только у «весь стол»: «поровну» и доплата выглядели как ошибка кассы.
 */
export function receiptNote(money: MoneyTotals, scope: PayScope, before: number): string | null {
  if (scope === 'full') return money.paidTotal > 0 ? 'оплачен остаток по столу' : null
  if (scope === 'equal') {
    const share = round2(money.tableTotal / Math.max(1, money.participants))
    return `поровну: доля ${share.toLocaleString('ru-RU')} ₽ из ${round2(money.tableTotal).toLocaleString('ru-RU')} ₽ на ${money.participants}` +
      (before > 0 ? `, ранее внесено ${before.toLocaleString('ru-RU')} ₽` : '') +
      `; в чеке — весь стол`
  }
  return before > 0.01 ? `доплата: ранее внесено ${round2(before).toLocaleString('ru-RU')} ₽` : null
}
