import { useRef, useState } from 'react'
import { newIdemKey } from '../keys'
import { WAITER_NAME } from '../data'
import { PrimaryButton, StickyFooter } from '../ui'
import { Avatar } from '../avatars'
import { useStore, tipAmount } from '../store'
import { fmt } from '../format'

const PRESETS: { v: '0' | '5' | '10' | '15' | 'custom'; label: string; popular?: boolean }[] = [
  { v: '5', label: '5%' },
  { v: '10', label: '10%', popular: true },
  { v: '15', label: '15%' },
  { v: 'custom', label: 'Своя' }
]

export function Tips() {
  const { ui, patch, snap, leaveTip } = useStore()
  const [busy, setBusy] = useState(false)
  const tipKey = useRef(newIdemKey())
  const paidNow = ui.lastPaid
  const tip = tipAmount(ui)

  // Чаевые уходят на сервер отдельной строкой — официант видит их у себя на экране
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    if (tip > 0) await leaveTip(tip, tipKey.current)
    patch({ screen: 'done' })
  }

  return (
    <div className="ep-screen">
      <div className="ep-scroll px-6 pt-6 pb-5">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="badge badge-success badge-lg mb-4">✓ Оплачено · {fmt(paidNow)}</div>
          {/* Продуктовый инвариант: аватары иллюстрированные, не эмодзи.
              Здесь вдобавок стоял повар на экране благодарности официанту. */}
          <div className="avatar mb-3.5">
            <div className="flex size-22 items-center justify-center rounded-full bg-base-200">
              <Avatar animal="fox" size={64} label={snap?.waiter?.name ?? WAITER_NAME} />
            </div>
          </div>
          <div className="badge badge-outline mb-4 gap-1.5">
            <span className="text-warning">★</span>
            <span className="font-semibold">4.9</span>
            <span className="text-base-content/60">· официант {snap?.waiter?.name ?? WAITER_NAME}</span>
          </div>
          <div className="text-3xl leading-tight font-light tracking-tight">
            Поблагодарить
            <br />
            официанта?
          </div>
        </div>

        <div className="join mb-4 w-full">
          {PRESETS.map(p => (
            <div key={p.v} className="indicator join-item flex-1">
              {p.popular && <span className="indicator-item indicator-center badge badge-xs badge-success">популярно</span>}
              <button
                className={`btn join-item w-full ${ui.tip === p.v ? 'btn-active btn-primary' : ''}`}
                onClick={() => patch({ tip: p.v })}
              >
                {p.label}
              </button>
            </div>
          ))}
        </div>

        {ui.tip === 'custom' && (
          <label className="input input-lg mb-4 w-full">
            <input
              placeholder="Введите сумму"
              inputMode="numeric"
              value={ui.tipCustom || ''}
              onChange={e => patch({ tipCustom: Number(e.target.value.replace(/\D/g, '')) || 0 })}
            />
            <span className="label">₽</span>
          </label>
        )}

        {tip > 0 && <div className="my-2 text-center text-5xl font-light tracking-tight">{fmt(tip)}</div>}

        <div className="text-center text-xs text-base-content/60">Чаевые поступают напрямую официанту</div>
      </div>

      <StickyFooter>
        <PrimaryButton onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Отправляем…' : tip > 0 ? `Оставить ${fmt(tip)}` : 'Оставить чаевые'}
        </PrimaryButton>
        <button className="btn btn-ghost btn-block" onClick={() => patch({ tip: '0', screen: 'done' })}>
          Пропустить
        </button>
      </StickyFooter>
    </div>
  )
}
