// Настройки заведения — одна схема для сервера, кабинета и гостя.
//
// Каждая настройка здесь что-то делает: пороги красят зал и кухню, способы
// оплаты и чаевые включают экраны гостя и проверки сервера, правила смены
// решают, можно ли закрыть её с долгом. Настройка, которая ничего не меняет,
// хуже её отсутствия: менеджер думает, что управляет, а не управляет.

import { setHallThresholds } from './hall.ts'
import { setStationThresholds } from './kitchen.ts'
import { setVenueTz } from './shift.ts'

export const TIMEZONES = [
  { id: 'Europe/Kaliningrad', label: 'Калининград, UTC+2' },
  { id: 'Europe/Moscow', label: 'Москва, UTC+3' },
  { id: 'Europe/Samara', label: 'Самара, UTC+4' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург, UTC+5' },
  { id: 'Asia/Novosibirsk', label: 'Новосибирск, UTC+7' },
  { id: 'Asia/Vladivostok', label: 'Владивосток, UTC+10' }
] as const

export type SeasonSetting = 'auto' | 'autumn' | 'winter' | 'spring' | 'summer'
export const SEASONS: SeasonSetting[] = ['auto', 'autumn', 'winter', 'spring', 'summer']
export const REMIND_AT = ['02:00', '04:00', '06:00'] as const

export interface VenueSettings {
  venue: { name: string; address: string; legal: string; inn: string; tz: string }
  alerts: {
    /** Сели и не заказали, мин. */
    noOrderMin: number
    /** Блюдо на кухне дольше, мин: билет краснеет, стол получает отметку. */
    kitchenMin: number
    /** Вызов официанта без ответа, мин. */
    callMin: number
    /** Наличные не приняты, мин. */
    cashMin: number
    /** Стол открыт дольше, ч — попадает в «требует решения». */
    longTableH: number
  }
  pay: { sbp: boolean; card: boolean; cash: boolean; split: boolean; tips: boolean; tipMode: 'rub' | 'pct' }
  shift: { remindAt: string | null; debtBlocksClose: boolean; noteOnDiff: boolean }
  guest: { season: SeasonSetting; photos: boolean; askAllergy: boolean }
}

export const DEFAULT_SETTINGS: VenueSettings = {
  venue: { name: '', address: '', legal: '', inn: '', tz: 'Europe/Moscow' },
  alerts: { noOrderMin: 7, kitchenMin: 20, callMin: 3, cashMin: 5, longTableH: 4 },
  pay: { sbp: true, card: true, cash: true, split: true, tips: true, tipMode: 'rub' },
  shift: { remindAt: '04:00', debtBlocksClose: true, noteOnDiff: true },
  guest: { season: 'auto', photos: true, askAllergy: true }
}

/** Границы чисел: порог «0 минут» превратил бы весь зал в красный. */
export const ALERT_LIMITS: Record<keyof VenueSettings['alerts'], [number, number]> = {
  noOrderMin: [2, 60],
  kitchenMin: [5, 120],
  callMin: [1, 30],
  cashMin: [1, 30],
  longTableH: [1, 12]
}

const text = (v: unknown, max: number, fallback: string) => (typeof v === 'string' ? v.trim().slice(0, max) : fallback)
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

/**
 * Собрать настройки из присланного поверх текущих: незнакомые поля
 * отбрасываются, числа зажимаются в границы. Ошибки — только там, где
 * «подправить молча» было бы враньём: ни одного способа оплаты, кривой ИНН.
 */
export function checkSettings(raw: unknown, base: VenueSettings = DEFAULT_SETTINGS): { settings: VenueSettings; errors: string[] } {
  const r = (raw ?? {}) as Partial<Record<keyof VenueSettings, Record<string, unknown>>>
  const errors: string[] = []
  const v = r.venue ?? {}
  const a = r.alerts ?? {}
  const p = r.pay ?? {}
  const s = r.shift ?? {}
  const g = r.guest ?? {}

  const inn = text(v.inn, 12, base.venue.inn).replace(/\s/g, '')
  if (inn && !/^\d{10}(\d{2})?$/.test(inn)) errors.push('bad inn')
  const tz = TIMEZONES.some(t => t.id === v.tz) ? String(v.tz) : base.venue.tz
  const name = text(v.name, 60, base.venue.name)
  if (!name) errors.push('name required')

  const alerts = { ...base.alerts }
  for (const key of Object.keys(ALERT_LIMITS) as (keyof VenueSettings['alerts'])[]) {
    const n = Number(a[key])
    if (a[key] === undefined || !Number.isFinite(n)) continue
    const [lo, hi] = ALERT_LIMITS[key]
    alerts[key] = Math.min(hi, Math.max(lo, Math.round(n)))
  }

  const pay = {
    sbp: bool(p.sbp, base.pay.sbp),
    card: bool(p.card, base.pay.card),
    cash: bool(p.cash, base.pay.cash),
    split: bool(p.split, base.pay.split),
    tips: bool(p.tips, base.pay.tips),
    tipMode: p.tipMode === 'pct' || p.tipMode === 'rub' ? p.tipMode : base.pay.tipMode
  }
  if (!pay.sbp && !pay.card && !pay.cash) errors.push('no payment method')

  const remindAt = s.remindAt === null ? null : (REMIND_AT as readonly string[]).includes(String(s.remindAt)) ? String(s.remindAt) : base.shift.remindAt

  return {
    settings: {
      venue: { name, address: text(v.address, 120, base.venue.address), legal: text(v.legal, 80, base.venue.legal), inn, tz },
      alerts,
      pay,
      shift: { remindAt, debtBlocksClose: bool(s.debtBlocksClose, base.shift.debtBlocksClose), noteOnDiff: bool(s.noteOnDiff, base.shift.noteOnDiff) },
      guest: {
        season: SEASONS.includes(g.season as SeasonSetting) ? (g.season as SeasonSetting) : base.guest.season,
        photos: bool(g.photos, base.guest.photos),
        askAllergy: bool(g.askAllergy, base.guest.askAllergy)
      }
    },
    errors
  }
}

/**
 * Применить настройки к правилам домена: пороги зала и кухни, пояс отчёта.
 * Вызывают и сервер (при старте и сохранении), и клиент (получив настройки).
 */
export function applySettings(s: VenueSettings) {
  const min = 60_000
  setHallThresholds({ noOrderMs: s.alerts.noOrderMin * min, kitchenSlowMs: s.alerts.kitchenMin * min, callMs: s.alerts.callMin * min, cashMs: s.alerts.cashMin * min })
  // Кухня желтеет на половине порога, краснеет на пороге; бар — вдвое быстрее кухни
  setStationThresholds('kitchen', { warnMs: (s.alerts.kitchenMin * min) / 2, dangerMs: s.alerts.kitchenMin * min })
  setVenueTz(s.venue.tz)
}

/** Варианты чаевых на экране гостя: рубли — как есть, проценты — от оплаченного. */
export function tipPresets(mode: 'rub' | 'pct', paid: number): { label: string; amount: number }[] {
  if (mode === 'rub') return [0, 100, 200, 300].map(a => ({ label: a ? `${a} ₽` : 'Нет', amount: a }))
  return [0, 5, 10, 15].map(pct => ({
    label: pct ? `${pct}%` : 'Нет',
    // До десяти рублей: «57,35 ₽ чаевых» выглядит как ошибка
    amount: pct ? Math.max(10, Math.round((paid * pct) / 100 / 10) * 10) : 0
  }))
}
