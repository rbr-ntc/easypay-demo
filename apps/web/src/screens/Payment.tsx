import { useEffect, useRef, useState } from 'react'
import { newIdemKey } from '../keys'
import { SBP_GRADIENT } from '../data'
import { Avatar } from '../avatars'
import { GhostButton, Mono, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore } from '../store'
import type { PayScope, PayMethod } from '../store'
import { fmt } from '../format'

const METHODS: { id: PayMethod; label: string; glyph: string }[] = [
  { id: 'card', label: 'Банковская карта', glyph: '▭' },
  { id: 'tpay', label: 'T-Pay', glyph: 'T' },
  { id: 'sber', label: 'SberPay', glyph: 'S' },
  { id: 'mir', label: 'Mir Pay', glyph: 'M' }
]

function QrStage({ amount, onBack, onPaid }: { amount: number; onBack: () => void; onPaid: () => void }) {
  const [ttl, setTtl] = useState(299)
  useEffect(() => {
    const t = setInterval(() => setTtl(x => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const mm = String(Math.floor(ttl / 60)).padStart(2, '0')
  const ss = String(ttl % 60).padStart(2, '0')

  return (
    <div className="flex flex-1 flex-col px-6 pt-4 pb-[calc(1.625rem+env(safe-area-inset-bottom))]">
      <div className="mb-2 flex items-center gap-3">
        <button className="btn btn-circle" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <div className="text-lg font-semibold">Оплата по СБП</div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {/* Плашка СБП — фирменный знак платёжной системы, поэтому цвет
            фиксированный и темой не управляется */}
        <div
          className="mb-4 flex h-6 w-15 items-center justify-center rounded-selector text-xs font-bold text-white"
          style={{ background: SBP_GRADIENT }}
        >
          СБП
        </div>
        <div className="card mb-4 bg-base-100 shadow-lg">
          <div className="card-body p-4">
            <div
              className="size-50 rounded-field border-8 border-white"
              style={{
                backgroundImage: 'repeating-conic-gradient(currentColor 0% 25%, #fff 0% 50%)',
                backgroundSize: '17px 17px'
              }}
            />
          </div>
        </div>
        <div className="mb-1.5 text-4xl font-light tracking-tight">{fmt(amount)}</div>
        <div className="mb-1 text-sm text-base-content/60">Наведите камеру или откройте приложение банка</div>
        <div className="font-mono text-xs text-base-content/60">
          Код действителен {mm}:{ss}
        </div>
      </div>
      <PrimaryButton className="border-none text-white" style={{ background: SBP_GRADIENT }} onClick={onPaid}>
        Открыть приложение банка
      </PrimaryButton>
    </div>
  )
}

export function Payment() {
  const { ui, patch, me, snap, totals, pay, askCash, cancelCash } = useStore()
  // Ключ живёт до успешной оплаты: повтор после обрыва связи не создаёт второй платёж
  const payKey = useRef(newIdemKey())
  if (!me || !snap) return null
  const amount = totals.scopeAmount(ui.payScope)
  const sbp = ui.payMethod === 'sbp'
  const cash = ui.payMethod === 'cash'
  // Просьба о наличных — это состояние стола, и гость обязан его видеть
  const myCashRequest = snap.cashIntent?.personaId === me.id ? snap.cashIntent : null

  // Кто уже оплатил (реальные платежи других гостей)
  const otherPayments = snap.payments.filter(p => p.personaId !== me.id)

  const alone = totals.participants <= 1
  const SCOPES: { id: PayScope; label: string; sub: string; disabled?: boolean }[] = alone
    ? [
        {
          id: 'own',
          label: 'Ваш заказ',
          sub: totals.sharedTotal > 0 ? `${fmt(totals.myOwn)} блюда + ${fmt(totals.myShare)} общие` : 'вы один за столом',
          disabled: totals.scopeAmount('own') <= 0
        }
      ]
    : [
        {
          id: 'own',
          label: 'Оплатить своё',
          sub: `${fmt(totals.myOwn)} ваше + ${fmt(totals.myShare)} доля общего`,
          disabled: totals.scopeAmount('own') <= 0
        },
        {
          id: 'equal',
          label: 'Разделить поровну',
          sub: `${fmt(totals.remaining)} на ${totals.participants} гостей`
        },
        { id: 'full', label: 'Оплатить весь стол', sub: 'весь неоплаченный остаток' }
      ]

  const doPay = async () => {
    patch({ payStage: 'processing' })
    const paid = await pay(ui.payScope, payKey.current, ui.payMethod)
    if (paid > 0) {
      payKey.current = newIdemKey() // следующая оплата — новый ключ
      setTimeout(() => patch({ payStage: 'form', screen: 'tips' }), 1400)
    } else {
      patch({ payStage: 'form' })
    }
  }

  if (ui.payStage === 'processing') {
    return (
      <div className="ep-screen items-center justify-center gap-5">
        <span className="loading loading-spinner loading-xl" />
        <div className="text-center">
          <div className="mb-1 text-xl font-semibold">Проводим оплату…</div>
          <div className="text-sm text-base-content/60">Не закрывайте экран</div>
        </div>
      </div>
    )
  }

  if (ui.payStage === 'qr') {
    return (
      <div className="ep-screen">
        <QrStage amount={amount} onBack={() => patch({ payStage: 'form' })} onPaid={() => void doPay()} />
      </div>
    )
  }

  return (
    <div className="ep-screen">
      <div className="ep-scroll px-5 pt-3.5 pb-5">
        <div className="mb-4 text-2xl font-bold tracking-tight">Оплата</div>

        {otherPayments.length > 0 && (
          <div className="mb-4">
            <WarnBanner>
              <Avatar animal={snap.personas.find(p => p.id === otherPayments[0].personaId)?.animal ?? 'fox'} size={26} />
              <span className="text-sm leading-snug">
                {otherPayments
                  .map(p => `${snap.personas.find(x => x.id === p.personaId)?.name ?? '?'} — ${fmt(p.amount)}`)
                  .join(', ')}{' '}
                уже оплачено. Осталось <b>{fmt(totals.remaining)}</b>
              </span>
            </WarnBanner>
          </div>
        )}

        <Mono className="mb-2">Что оплачиваем</Mono>
        {/* Радиокнопки, а не кликабельные div: выбор «за что платим» обязан
            работать с клавиатуры и читаться скринридером — на экране, где
            списываются деньги, это была единственная настоящая кнопка внизу */}
        <div className="mb-5 flex flex-col gap-2.5">
          {SCOPES.map(o => {
            const active = o.id === ui.payScope
            return (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center gap-3 rounded-box border bg-base-100 p-3.5 ${
                  active ? 'border-primary border-2' : 'border-base-300'
                } ${o.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
              >
                <input
                  type="radio"
                  name="pay-scope"
                  className="radio radio-primary"
                  checked={active}
                  disabled={o.disabled}
                  onChange={() => patch({ payScope: o.id })}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{o.label}</div>
                  <div className="mt-0.5 text-xs text-base-content/60">{o.disabled ? 'уже оплачено' : o.sub}</div>
                </div>
                <span className="font-semibold">{fmt(totals.scopeAmount(o.id))}</span>
              </label>
            )
          })}
        </div>

        <Mono className="mb-2">Способ оплаты</Mono>
        <div className="flex flex-col gap-2.5">
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-box border bg-base-100 p-3.5 ${
              sbp ? 'border-primary border-2' : 'border-base-300'
            }`}
          >
            <input
              type="radio"
              name="pay-method"
              className="radio radio-primary"
              checked={sbp}
              onChange={() => patch({ payMethod: 'sbp' })}
            />
            <div
              className="flex size-11 shrink-0 items-center justify-center rounded-field text-sm font-bold text-white"
              style={{ background: SBP_GRADIENT }}
            >
              СБП
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">СБП</span>
                <span className="badge badge-xs badge-secondary">Рекомендуем</span>
              </div>
              <div className="mt-0.5 text-xs text-base-content/60">Оплата по QR или кнопке банка</div>
            </div>
          </label>

          {/* Наличные телефон принять не может: их берёт человек. Но выбор
              способа и вызов официанта — разные шаги: тап выбирает наличные,
              а зовёт официанта только кнопка внизу. Раньше касание строки
              мгновенно отправляло просьбу, и гость об этом даже не узнавал. */}
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-box border bg-base-100 p-3.5 ${
              cash ? 'border-primary border-2' : 'border-base-300'
            }`}
          >
            <input
              type="radio"
              name="pay-method"
              className="radio radio-primary"
              checked={cash}
              onChange={() => patch({ payMethod: 'cash' })}
            />
            <div className="flex size-9 shrink-0 items-center justify-center rounded-field bg-base-200 font-semibold">
              ₽
            </div>
            <div className="flex-1">
              <div className="font-medium">Заплачу наличными</div>
              <div className="mt-0.5 text-xs text-base-content/60">позовём официанта — он примет деньги</div>
            </div>
          </label>

          {myCashRequest && (
            <div role="alert" className="alert alert-warning alert-soft flex-col items-start">
              <div className="font-semibold">Официант идёт за наличными · {fmt(myCashRequest.amount)}</div>
              <div className="text-sm">Приготовьте деньги. Если передумали — можно оплатить телефоном.</div>
              <GhostButton className="btn-sm" onClick={() => void cancelCash()}>
                Передумал, заплачу телефоном
              </GhostButton>
            </div>
          )}

          {METHODS.map(m => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-center gap-3 rounded-box border bg-base-100 p-3.5 ${
                ui.payMethod === m.id ? 'border-primary border-2' : 'border-base-300'
              }`}
            >
              <input
                type="radio"
                name="pay-method"
                className="radio radio-primary"
                checked={ui.payMethod === m.id}
                onChange={() => patch({ payMethod: m.id })}
              />
              <div className="flex size-9 shrink-0 items-center justify-center rounded-field bg-base-200 font-semibold">
                {m.glyph}
              </div>
              <span className="flex-1 font-medium">{m.label}</span>
            </label>
          ))}
        </div>
      </div>

      <StickyFooter>
        <PrimaryButton
          // Наличные не списываются с телефона: кнопка честно зовёт человека,
          // а не притворяется оплатой
          disabled={amount <= 0 || (cash && !!myCashRequest)}
          className={sbp ? 'border-none text-white' : ''}
          style={sbp ? { background: SBP_GRADIENT } : undefined}
          onClick={() =>
            cash
              ? // Тот же scope, что на кнопке: «разделить поровну» схлопывалось
                // в «своё», и официант шёл за другой суммой, чем видел гость
                void askCash(ui.payScope)
              : sbp
                ? patch({ payStage: 'qr' })
                : void doPay()
          }
        >
          {cash
            ? myCashRequest
              ? 'Официант уже идёт'
              : `Позвать официанта · ${fmt(amount)}`
            : sbp
              ? `Оплатить по СБП · ${fmt(amount)}`
              : `Оплатить ${fmt(amount)}`}
        </PrimaryButton>
      </StickyFooter>
    </div>
  )
}
