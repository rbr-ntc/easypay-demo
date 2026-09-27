import { useEffect, useMemo, useRef, useState } from 'react'
import { optionsLabel, WAITER_NAME } from '../data'
import { useStore, tipAmount } from '../store'
import { newIdemKey } from '../keys'
import { fmt } from '../format'
import { artSet, currentSeason, seasonConfig } from '../guest/showcase'
import { Slideshow } from '../guest/parts'
import { tipPresets } from '@easypay/domain/settings'
import { SETTINGS } from '../settings'

/**
 * «Спасибо» — оплата, чаевые, отзыв и чек на одном экране.
 *
 * Чаевые — рублями или процентом от оплаченного (настройка заведения) и
 * только если заведение их принимает. Уходят напрямую официанту, мимо
 * счёта — так и написано.
 */

const RATES: { id: 'good' | 'ok' | 'bad'; label: string }[] = [
  { id: 'good', label: 'Всё отлично' },
  { id: 'ok', label: 'Нормально' },
  { id: 'bad', label: 'Есть замечание' }
]

export function Done() {
  const { ui, patch, me, snap, totals, leaveTip, rateVisit } = useStore()
  const [busy, setBusy] = useState(false)
  const [tipSent, setTipSent] = useState(0)
  const [checkOpen, setCheckOpen] = useState(false)
  // Оценка уходит на сервер: менеджер видит её в чеке и в обзоре смены
  const rated = !!me && (snap?.rated ?? []).includes(me.id)
  const [rate, setRate] = useState<'good' | 'ok' | 'bad' | null>(null)
  const [note, setNote] = useState('')
  const [rateSent, setRateSent] = useState(rated)
  const tipKey = useRef(newIdemKey())
  const bye = useMemo(() => seasonConfig(currentSeason()).bye, [])

  const tip = tipAmount(ui)
  const receipt = ui.lastReceipt
  const waiter = snap?.waiter?.name ?? WAITER_NAME
  const method = ui.payMethod === 'sbp' ? 'СБП' : ui.payMethod === 'cash' ? 'наличными' : 'картой'
  const paid = receipt?.amount ?? ui.lastPaid
  const tips = tipPresets(SETTINGS.pay.tipMode, paid)
  // Процентные варианты зависят от суммы: предвыбор — средний вариант
  useEffect(() => {
    if (!tips.some(t => t.amount === ui.tip)) patch({ tip: tips[2]?.amount ?? 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid])

  const sendTip = async () => {
    if (busy || tip <= 0) return
    setBusy(true)
    // Если не дошло, гость не должен уйти с ощущением, что деньги отданы:
    // кнопка остаётся, тост объяснит причину
    // Показываем сумму, которую подтвердил сервер, а не ту, что нажали
    const sent = await leaveTip(tip, tipKey.current)
    setBusy(false)
    if (sent > 0) setTipSent(sent)
  }

  return (
    <div className="g-anim-fade g-noscroll absolute inset-0 overflow-y-auto">
      <div className="relative h-130 overflow-hidden">
        <Slideshow images={artSet('done')} position="50% 15%" offset={2} />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(14,13,12,0) 30%, color-mix(in oklch, var(--g-paper) 55%, transparent) 62%, var(--g-paper) 96%)'
          }}
        />
        <div className="absolute right-5 bottom-2 left-5 text-center">
          <span className="g-cta inline-flex size-14 items-center justify-center rounded-full text-2xl" aria-hidden>
            ✓
          </span>
          <h1 className="g-serif mt-4 text-[48px] text-balance text-g-fg">
            Спасибо{me?.name ? `, ${me.name}` : ''}
          </h1>
          <div className="g-num mt-2.5 text-[15px] text-g-soft">
            Оплачено {fmt(paid)} · {method}
          </div>
        </div>
      </div>

      {SETTINGS.pay.tips && (
      <div className="px-5 pt-7 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-g-s1 text-[15px] font-bold text-g-tan">
            {waiter.slice(0, 1)}
          </span>
          <span className="text-[17px] font-bold">Чаевые · {waiter}</span>
        </div>
        <div className="mt-1 text-[13px] text-g-mute">напрямую официанту, мимо счёта</div>

        {tipSent > 0 ? (
          <div className="mt-4 text-[15px] font-bold text-g-tan">✓ {fmt(tipSent)} ушли официанту — спасибо!</div>
        ) : (
          <>
            <div className="mt-4 flex justify-center gap-2.5">
              {tips.map(({ label, amount: t }) => {
                const on = tip === t
                return (
                  <button
                    key={label}
                    onClick={() => patch({ tip: t })}
                    aria-pressed={on}
                    className="size-18 rounded-full text-[15px] font-bold"
                    style={
                      on
                        ? { background: '#F3F0EA', color: '#1A1612', border: '1px solid #F3F0EA' }
                        : { background: 'var(--g-s1)', color: '#F3F0EA', border: '1px solid rgba(255,255,255,.1)' }
                    }
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => void sendTip()}
              disabled={busy || tip <= 0}
              className="g-cta mt-4.5 h-14 w-full rounded-full text-[17px] disabled:opacity-40"
            >
              {busy ? 'Отправляем…' : tip > 0 ? `Оставить ${fmt(tip)}` : 'Выберите сумму'}
            </button>
          </>
        )}
      </div>
      )}

      <div className="mx-5 mt-9 text-center">
        <h2 className="g-serif text-[28px]">как всё прошло?</h2>
        <div className="mt-3.5 flex flex-wrap justify-center gap-2">
          {RATES.map(({ id: r, label }) => {
            const on = rate === r
            return (
              <button
                key={r}
                onClick={() => {
                  setRate(r)
                  // «Есть замечание» — сначала текст, остальное уходит сразу
                  if (r !== 'bad') void rateVisit(r).then(ok => ok && setRateSent(true))
                  else setRateSent(false)
                }}
                aria-pressed={on}
                className="h-11 rounded-full px-4 text-[15px]"
                style={
                  on
                    ? { background: '#F3F0EA', color: '#1A1612', border: '1px solid #F3F0EA' }
                    : { background: 'var(--g-s1)', color: '#F3F0EA', border: '1px solid rgba(255,255,255,.1)' }
                }
              >
                {label}
              </button>
            )
          })}
        </div>
        {rate === 'bad' && !rateSent && (
          <div className="mt-3.5 flex gap-2">
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={200}
              placeholder="Что было не так?"
              aria-label="Замечание"
              className="h-12 min-w-0 flex-1 rounded-full bg-g-s1 px-4 text-[15px] text-g-fg outline-none placeholder:text-g-mute"
              style={{ border: '1px solid rgba(255,255,255,.1)' }}
            />
            <button onClick={() => void rateVisit('bad', note).then(ok => ok && setRateSent(true))} className="g-cta h-12 rounded-full px-5 text-[15px]">
              Отправить
            </button>
          </div>
        )}
        {rateSent && <div className="mt-3 text-[13px] text-g-tan">Спасибо — управляющая это увидит</div>}
      </div>

      <div className="mx-4 mt-9 rounded-3xl bg-g-s1 px-4.5 py-1">
        <button
          onClick={() => setCheckOpen(x => !x)}
          aria-expanded={checkOpen}
          className="flex h-14 w-full items-center text-g-fg"
        >
          <span className="g-num flex-1 text-left text-[15px] font-bold">
            Чек {receipt ? `№${receipt.no}` : 'заказа'} · {fmt(paid)}
          </span>
          <span className="text-[13px] text-g-mute">{checkOpen ? 'Свернуть' : 'Показать'}</span>
        </button>
        {checkOpen && (
          <div className="pb-3.5">
            {(receipt?.lines ?? []).map((l, i) => (
              <div key={`${l.name}-${i}`} className="flex gap-2.5 py-1.5 text-[15px] text-g-soft">
                <span className="flex-1">
                  {l.name}
                  {l.qty > 1 ? ` ×${l.qty}` : ''}
                  {l.optionsText ? ` · ${l.optionsText}` : optionsLabel(l.options) ? ` · ${optionsLabel(l.options)}` : ''}
                  {l.shared ? ' · ваша доля' : ''}
                </span>
                <span className="g-num">{fmt(l.shared && l.share !== null ? l.share : l.price * l.qty)}</span>
              </div>
            ))}
            <div
              className="mt-1.5 flex gap-2.5 pt-2.5 text-[15px] font-bold"
              style={{ borderTop: '1px solid rgba(255,255,255,.1)' }}
            >
              <span className="flex-1">Оплачено · {method}</span>
              <span className="g-num">{fmt(paid)}</span>
            </div>
            {/* Честно: это чек заказа, а не документ по 54-ФЗ — его пробивает касса */}
            <div className="mt-2 text-[12px] text-g-mute">Это чек заказа. Фискальный чек выдаёт касса ресторана.</div>
            {receipt?.note && <div className="mt-1.5 text-[13px] text-g-tan">{receipt.note}</div>}
            {(() => {
              // Реквизиты — из чека (как было в момент оплаты), иначе из настроек
              const v = receipt?.venue ?? { name: SETTINGS.venue.name, legal: SETTINGS.venue.legal, inn: SETTINGS.venue.inn, address: SETTINGS.venue.address }
              const parts = [v.name, v.legal, v.inn && `ИНН ${v.inn}`, v.address].filter(Boolean)
              return parts.length ? <div className="mt-1.5 text-[12px] leading-snug text-g-mute">{parts.join(' · ')}</div> : null
            })()}
          </div>
        )}
      </div>

      {totals.remaining > 0.01 && (
        <p className="g-num mx-5 mt-4 text-center text-[13px] text-g-mute">
          Ваша часть оплачена. По столу осталось <b className="text-g-fg">{fmt(totals.remaining)}</b>
        </p>
      )}

      <div className="px-5 pt-10 pb-[calc(2.25rem+env(safe-area-inset-bottom))] text-center">
        <div className="g-serif text-[28px] leading-tight text-balance text-g-tan italic">{bye}</div>
        <button onClick={() => patch({ screen: 'menu' })} className="mt-4 h-11 px-4.5 text-[15px] text-g-mute underline">
          вернуться в меню
        </button>
      </div>
    </div>
  )
}
