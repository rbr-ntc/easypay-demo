import { useRef, useState } from 'react'
import { optionsLabel, WAITER_NAME } from '../data'
import { Avatar } from '../avatars'
import { useStore, tipAmount } from '../store'
import { newIdemKey } from '../keys'
import { fmt } from '../format'

/**
 * «Спасибо» — оплата, чаевые и чек на одном экране.
 *
 * Чаевые были отдельным шагом между оплатой и чеком: гость платил, попадал на
 * экран благодарности, оттуда на чек — три экрана подряд ради одного решения.
 * Здесь чек уже виден, пока гость думает про чаевые.
 */

const PRESETS: { v: '5' | '10' | '15'; hint: string }[] = [
  { v: '5', hint: '5%' },
  { v: '10', hint: '10% · чаще всего' },
  { v: '15', hint: '15%' }
]

export function Done() {
  const { ui, patch, snap, totals, leaveTip } = useStore()
  const [busy, setBusy] = useState(false)
  const tipKey = useRef(newIdemKey())
  const tip = tipAmount(ui)
  const receipt = ui.lastReceipt
  const remaining = totals.remaining
  const waiter = snap?.waiter?.name ?? WAITER_NAME

  const percentOf = (p: string) => Math.round((ui.lastPaid * Number(p)) / 100)

  const finish = async () => {
    if (busy) return
    setBusy(true)
    // Чаевые уходят отдельной строкой — официант видит их у себя на экране
    if (tip > 0) await leaveTip(tip, tipKey.current)
    patch({ screen: 'menu', tip: '10', tipCustom: 0 })
  }

  return (
    <div className="ep-screen ep-forest relative">
      {/* Приглушённое фото сверху — стол, за которым только что ели */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-85 overflow-hidden">
        <img src="./dishes/tomyam.jpg" alt="" className="size-full object-cover opacity-50" />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(6,33,25,.45) 0%, #062119 88%)' }}
        />
      </div>

      <div className="ep-scroll relative px-5 pt-9 pb-5">
        <div className="text-center">
          <div
            className="ep-pop mx-auto flex size-19 items-center justify-center rounded-full text-[34px] font-bold"
            style={{ background: '#D5F94E', color: '#062119' }}
          >
            ✓
          </div>
          <div className="ep-moment mt-4.5 text-[42px] leading-[1.05]">
            Спасибо,
            <br />
            было вкусно?
          </div>
          <div className="ep-sum mt-2.5 text-[15px] font-semibold" style={{ color: '#A9BCB0' }}>
            Списано {fmt(ui.lastPaid)}
            {receipt ? ` · ${new Date(receipt.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        </div>

        {/* Чаевые — в рублях: гость решает про деньги, а не про проценты */}
        <div
          className="mt-6.5 rounded-[24px] p-4.5"
          style={{
            background:
              'linear-gradient(158deg, rgba(250,245,234,.26) 0%, rgba(250,245,234,.08) 60%, rgba(250,245,234,.13) 100%)',
            border: '1px solid rgba(255,255,255,.32)',
            backdropFilter: 'blur(32px) saturate(1.6)',
            boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,.34), 0 18px 40px -22px rgba(0,0,0,.75)'
          }}
        >
          <div className="flex items-center gap-3.5">
            <span className="shrink-0 rounded-full" style={{ boxShadow: '0 0 0 2px #D5F94E' }}>
              <Avatar animal="fox" size={52} label={waiter} />
            </span>
            <div className="flex-1">
              <div className="text-[17px] font-extrabold text-white">Ваш официант · {waiter}</div>
              <div className="mt-0.5 text-[13px] font-semibold" style={{ color: '#C6D5CC' }}>
                ★ 4.9 · чаевые уходят напрямую, мимо счёта
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            {PRESETS.map(p => {
              const active = ui.tip === p.v
              return (
                <button
                  key={p.v}
                  onClick={() => patch({ tip: p.v })}
                  className="flex h-16.5 flex-1 flex-col items-center justify-center gap-px rounded-field"
                  style={
                    active
                      ? { background: '#D5F94E' }
                      : { border: '1px solid rgba(250,245,234,.28)' }
                  }
                >
                  <span
                    className="ep-sum text-[17px] font-extrabold"
                    style={{ color: active ? '#062119' : '#FFFFFF' }}
                  >
                    {fmt(percentOf(p.v))}
                  </span>
                  <span
                    className="text-[12px] font-semibold"
                    style={{ color: active ? '#2C4A3C' : '#A9BCB0' }}
                  >
                    {p.hint}
                  </span>
                </button>
              )
            })}
            <button
              onClick={() => patch({ tip: 'custom' })}
              className="h-16.5 w-15.5 rounded-field text-[14px] font-bold"
              style={
                ui.tip === 'custom'
                  ? { background: '#D5F94E', color: '#062119' }
                  : { border: '1px solid rgba(250,245,234,.28)', color: '#A9BCB0' }
              }
            >
              своя
            </button>
          </div>

          {ui.tip === 'custom' && (
            <label
              className="mt-3 flex h-14 items-center gap-2 rounded-field px-4"
              style={{ background: 'rgba(6,33,25,.35)', border: '1px solid rgba(250,245,234,.22)' }}
            >
              <input
                inputMode="numeric"
                autoFocus
                placeholder="Введите сумму"
                value={ui.tipCustom || ''}
                onChange={e => patch({ tipCustom: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                className="w-full bg-transparent text-[18px] font-bold text-white outline-none placeholder:text-[#8CA396]"
              />
              <span className="text-[18px]" style={{ color: '#A9BCB0' }}>
                ₽
              </span>
            </label>
          )}
        </div>

        {/* Чек заказа. Фискальный по 54-ФЗ пробивает касса — это разные бумаги */}
        <div className="mt-4 rounded-[24px] p-4.5" style={{ background: '#FAF5EA', color: '#062119' }}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[16px] font-extrabold">Чек {receipt ? `№ ${receipt.no}` : 'заказа'}</div>
            <div className="font-mono text-[12px] font-semibold" style={{ color: '#5A6A61' }}>
              {receipt
                ? new Date(receipt.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                : 'сохраните номер'}
            </div>
          </div>

          {receipt && receipt.lines.length > 0 && (
            <div className="mt-3.5 flex flex-col gap-2">
              {receipt.lines.map((l, i) => (
                <div key={`${l.name}-${i}`} className="flex justify-between gap-3 text-[14px] font-semibold">
                  <span style={{ color: '#4A5B51' }}>
                    {l.name}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                    {optionsLabel(l.options) ? ` · ${optionsLabel(l.options)}` : ''}
                    {l.shared ? ' · ваша доля' : ''}
                  </span>
                  <span className="ep-sum">{fmt(l.shared && l.share !== null ? l.share : l.price * l.qty)}</span>
                </div>
              ))}
            </div>
          )}

          <div
            className="mt-3.5 flex justify-between pt-3.5 text-[15px] font-extrabold"
            style={{ borderTop: '1px dashed #D8CFBC' }}
          >
            <span>Списано</span>
            <span className="ep-sum">{fmt(receipt?.amount ?? ui.lastPaid)}</span>
          </div>
          {tip > 0 && (
            <div className="mt-1.5 flex justify-between text-[13px] font-semibold" style={{ color: '#4A5B51' }}>
              <span>Чаевые официанту — мимо счёта</span>
              <span className="ep-sum">{fmt(tip)}</span>
            </div>
          )}
        </div>

        {remaining > 0.01 && (
          <p className="mt-3.5 text-center text-[13px] font-semibold" style={{ color: '#A9BCB0' }}>
            Ваша часть оплачена. По столу осталось{' '}
            <b className="ep-sum" style={{ color: '#D5F94E' }}>
              {fmt(remaining)}
            </b>
          </p>
        )}
      </div>

      <div className="relative shrink-0 px-5 pt-3 pb-[calc(1.375rem+env(safe-area-inset-bottom))]">
        <button
          disabled={busy}
          onClick={() => void finish()}
          className="ep-sum h-15 w-full rounded-field text-[16px] font-extrabold disabled:opacity-45"
          style={{ background: '#D5F94E', color: '#062119' }}
        >
          {busy ? 'Отправляем…' : tip > 0 ? `Оставить ${fmt(tip)} и закончить` : 'Закончить'}
        </button>
        <button
          onClick={() => patch({ tip: '0', screen: 'menu' })}
          className="mt-2 h-11 w-full text-[14px] font-bold"
          style={{ color: '#A9BCB0' }}
        >
          Без чаевых
        </button>
      </div>
    </div>
  )
}
