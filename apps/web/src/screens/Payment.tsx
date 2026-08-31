import { useEffect, useRef, useState } from 'react'
import { newIdemKey } from '../keys'
import { SBP_GRADIENT } from '../data'
import { Avatar } from '../avatars'
import { useStore } from '../store'
import type { PayScope, PayMethod } from '../store'
import { fmt } from '../format'

const METHODS: { id: PayMethod; label: string; sub: string; glyph: string }[] = [
  { id: 'card', label: 'Карта', sub: 'Ввод реквизитов', glyph: '▭' },
  { id: 'cash', label: 'Наличными официанту', sub: 'Он подойдёт и подтвердит', glyph: '₽' }
]

const SCOPE_LABEL: Record<PayScope, string> = {
  own: 'Своё',
  equal: 'Поровну',
  full: 'Весь стол'
}

/** Оплата по СБП: код живёт пять минут, дальше его надо перевыпустить. */
function QrStage({ amount, onBack, onPaid }: { amount: number; onBack: () => void; onPaid: () => void }) {
  const [ttl, setTtl] = useState(299)
  useEffect(() => {
    const t = setInterval(() => setTtl(x => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const mm = String(Math.floor(ttl / 60)).padStart(2, '0')
  const ss = String(ttl % 60).padStart(2, '0')

  return (
    <div className="ep-forest flex flex-1 flex-col px-5 pt-4 pb-[calc(1.375rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-3">
        <button
          aria-label="Назад"
          onClick={onBack}
          className="size-11 shrink-0 rounded-full text-lg font-extrabold"
          style={{ border: '1px solid rgba(250,245,234,.22)' }}
        >
          ←
        </button>
        <div className="text-[20px] font-extrabold tracking-tight">Оплата по СБП</div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {/* QR всегда чёрный на белом: его сканируют камерой, в том числе с бумаги */}
        <div className="rounded-[22px] bg-[#FAF5EA] p-4">
          <div
            className="size-52"
            style={{
              backgroundImage: 'repeating-conic-gradient(#062119 0% 25%, #fff 0% 50%)',
              backgroundSize: '17px 17px'
            }}
          />
        </div>
        <div className="ep-moment ep-sum mt-5 text-[52px] leading-none">{fmt(amount)}</div>
        <div className="mt-2 text-[14px] font-semibold" style={{ color: '#8CA396' }}>
          Наведите камеру или откройте приложение банка
        </div>
        <div className="ep-sum mt-1 font-mono text-[13px]" style={{ color: '#8CA396' }}>
          Код действителен {mm}:{ss}
        </div>
      </div>

      <button
        onClick={onPaid}
        className="h-15 w-full rounded-field text-[16px] font-extrabold text-white"
        style={{ background: SBP_GRADIENT }}
      >
        Открыть приложение банка
      </button>
      <button onClick={onBack} className="mt-2 h-11 text-[14px] font-bold" style={{ color: '#8CA396' }}>
        Оплатить другим способом
      </button>
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
  const myCashRequest = snap.cashIntent?.personaId === me.id ? snap.cashIntent : null
  const alone = totals.participants <= 1
  const scopes: PayScope[] = alone ? ['own'] : ['own', 'equal', 'full']
  const otherPayments = snap.payments.filter(p => p.personaId !== me.id)

  const doPay = async () => {
    patch({ payStage: 'processing', payError: null })
    const paid = await pay(ui.payScope, payKey.current, ui.payMethod)
    if (paid > 0) {
      payKey.current = newIdemKey() // следующая оплата — новый ключ
      // Чаевые больше не отдельный экран: они на «Спасибо» вместе с чеком
      setTimeout(() => patch({ payStage: 'form', screen: 'done' }), 1400)
    } else {
      // Ключ НЕ меняем: повтор идёт тем же — двойного списания не будет
      patch({ payStage: 'failed', payError: 'Банк не подтвердил оплату' })
    }
  }

  if (ui.payStage === 'processing') {
    return (
      <div className="ep-screen ep-forest items-center justify-center gap-6 px-8 text-center">
        <div className="relative flex size-24 items-center justify-center">
          <span
            className="ep-pulse absolute inset-0 rounded-full"
            style={{ border: '2px solid rgba(213,249,78,.4)' }}
          />
          <span className="loading loading-spinner loading-lg" style={{ color: '#D5F94E' }} />
        </div>
        <div>
          <div className="text-[21px] font-extrabold">Проводим оплату…</div>
          <div className="mt-1.5 text-[14px] font-semibold" style={{ color: '#8CA396' }}>
            Не закрывайте экран
          </div>
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

  // Банк отказал. Главное здесь — сказать, что деньги НЕ списаны, и что
  // повтор пойдёт тем же ключом: иначе гость боится нажать второй раз.
  if (ui.payStage === 'failed') {
    return (
      <div className="ep-screen">
        <div className="ep-scroll flex flex-col gap-4 px-5 pt-6 pb-5">
          <div className="rounded-box p-5 text-center" style={{ background: '#F6E3DA' }}>
            <div className="text-[21px] font-extrabold" style={{ color: '#7A2A12' }}>
              {ui.payError ?? 'Банк не подтвердил оплату'}
            </div>
            <div className="mt-2 text-[15px] font-bold" style={{ color: '#7A2A12' }}>
              Деньги не списаны
            </div>
          </div>

          <div className="rounded-box bg-white p-4" style={{ border: '1px solid #E3DCCB' }}>
            <div className="ep-brow mb-3">Попытка</div>
            <Row label="Сумма" value={fmt(amount)} />
            <Row label="Способ" value={sbp ? 'СБП' : cash ? 'Наличные' : 'Карта'} />
            <Row label="Ключ платежа" value={payKey.current.slice(0, 14) + '…'} mono />
            <div className="mt-3 rounded-field p-3 text-[13px] font-semibold" style={{ background: '#DCEDE2', color: '#0E3F2B' }}>
              У стола нет второго платежа — счёт не изменился
            </div>
          </div>

          <button
            onClick={() => patch({ payStage: 'form' })}
            className="h-13 rounded-field text-[15px] font-bold"
            style={{ border: '1px solid #DFD6C3' }}
          >
            Выбрать другой способ
          </button>
        </div>

        <div className="shrink-0 px-5 pt-3 pb-[calc(1.375rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => void doPay()}
            className="h-15 w-full rounded-field text-[16px] font-extrabold text-white"
            style={{ background: SBP_GRADIENT }}
          >
            Повторить · {fmt(amount)}
          </button>
          <p className="mt-2 text-center text-[12px] font-semibold text-muted-soft">
            Та же попытка — двойного списания не будет
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="ep-screen">
      <div className="flex shrink-0 items-center gap-3 px-5 pt-4 pb-2">
        <button
          aria-label="Назад к столу"
          onClick={() => patch({ screen: 'table' })}
          className="size-11 shrink-0 rounded-full text-lg font-extrabold"
          style={{ border: '1.5px solid #DFD6C3' }}
        >
          ←
        </button>
        <div className="text-[20px] font-extrabold tracking-tight">Оплата</div>
      </div>

      <div className="ep-scroll px-5 pt-2 pb-5">
        {/* Сумма, за которой гость сюда и пришёл — «момент» засечками */}
        <div className="ep-forest relative overflow-hidden rounded-[26px] px-5 pt-6 pb-5.5 text-center">
          <div
            className="pointer-events-none absolute -top-17 -right-12 size-45 rounded-full"
            style={{ background: 'rgba(213,249,78,.14)', filter: 'blur(6px)' }}
          />
          <div className="text-[14px] font-semibold" style={{ color: '#8CA396' }}>
            К оплате с вас
          </div>
          <div className="ep-moment ep-sum mt-1 text-[60px] leading-none">{fmt(amount)}</div>
          {totals.myShare > 0 && (
            <div className="mt-2 text-[13px] font-semibold" style={{ color: '#8CA396' }}>
              {fmt(totals.myOwn)} ваше + {fmt(totals.myShare)} доля общего
            </div>
          )}

          {otherPayments.length > 0 && (
            <div
              className="mt-4 flex items-center gap-2.5 rounded-field px-3.5 py-3 text-left"
              style={{ background: 'rgba(250,245,234,.08)', border: '1px solid rgba(250,245,234,.14)' }}
            >
              <Avatar
                animal={snap.personas.find(p => p.id === otherPayments[0].personaId)?.animal ?? 'fox'}
                size={32}
              />
              <div className="text-[13px] leading-snug font-semibold" style={{ color: '#C6D5CC' }}>
                {otherPayments
                  .map(p => `${snap.personas.find(x => x.id === p.personaId)?.name ?? 'Гость'} внёс ${fmt(p.amount)}`)
                  .join(', ')}{' '}
                · по столу осталось{' '}
                <b className="ep-sum" style={{ color: '#D5F94E' }}>
                  {fmt(totals.remaining)}
                </b>
              </div>
            </div>
          )}
        </div>

        {!alone && (
          <>
            <div className="ep-brow mt-5 mb-2.5">Платите за</div>
            {/* В каждом сегменте своя сумма — это и есть списываемое: считает
                сервер, клиент только показывает */}
            <div className="flex gap-2 rounded-[18px] p-1.5" style={{ background: '#F1EBDD' }}>
              {scopes.map(s => {
                const active = s === ui.payScope
                return (
                  <button
                    key={s}
                    onClick={() => patch({ payScope: s })}
                    className="flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px]"
                    style={active ? { background: '#D5F94E' } : undefined}
                  >
                    <span
                      className="text-[15px] font-extrabold"
                      style={{ color: active ? '#062119' : '#4A5B51' }}
                    >
                      {SCOPE_LABEL[s]}
                    </span>
                    <span
                      className="ep-sum text-[13px] font-bold"
                      style={{ color: active ? '#2C4A3C' : '#4A5B51' }}
                    >
                      {fmt(totals.scopeAmount(s))}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div className="ep-brow mt-5.5 mb-2.5">Чем платите</div>
        <div className="flex flex-col gap-2.5">
          <MethodRow
            active={sbp}
            onSelect={() => patch({ payMethod: 'sbp' })}
            glyph="СБП"
            glyphStyle={{ background: SBP_GRADIENT, color: '#fff', fontSize: 13 }}
            label="СБП"
            sub="Откроется приложение банка"
            badge="быстрее всего"
          />
          {METHODS.map(m => (
            <MethodRow
              key={m.id}
              active={ui.payMethod === m.id}
              onSelect={() => patch({ payMethod: m.id })}
              glyph={m.glyph}
              glyphStyle={{ background: '#F1EBDD', color: '#26382F' }}
              label={m.label}
              sub={m.sub}
            />
          ))}
        </div>

        {myCashRequest && (
          <div className="ep-forest mt-3 rounded-box p-4">
            <div className="text-[15px] font-extrabold" style={{ color: '#D5F94E' }}>
              Официант идёт за наличными
            </div>
            <div className="ep-moment ep-sum mt-1 text-[44px] leading-none">{fmt(myCashRequest.amount)}</div>
            <ol className="mt-3 flex flex-col gap-2 text-[13px] font-semibold" style={{ color: '#C6D5CC' }}>
              <li>1 · Вы попросили — в счёте пока ничего не изменилось</li>
              <li>2 · Официант подтвердит, что взял деньги</li>
            </ol>
            <button
              onClick={() => void cancelCash()}
              className="mt-3.5 h-12 w-full rounded-field text-[14px] font-bold"
              style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }}
            >
              Передумал, заплачу телефоном
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pt-3 pb-[calc(1.375rem+env(safe-area-inset-bottom))]">
        <button
          disabled={amount <= 0 || (cash && !!myCashRequest)}
          onClick={() =>
            cash
              ? void askCash(ui.payScope)
              : sbp
                ? patch({ payStage: 'qr' })
                : void doPay()
          }
          className="h-15 w-full rounded-field text-[16px] font-extrabold disabled:opacity-45"
          style={
            sbp
              ? { background: SBP_GRADIENT, color: '#fff' }
              : { background: '#D5F94E', color: '#062119', boxShadow: '0 12px 26px -14px rgba(6,33,25,.9)' }
          }
        >
          {cash
            ? myCashRequest
              ? 'Официант уже идёт'
              : `Позвать официанта · ${fmt(amount)}`
            : `Оплатить ${sbp ? 'по СБП · ' : ''}${fmt(amount)}`}
        </button>
        <p className="mt-2 text-center text-[12px] font-semibold text-muted-soft">
          Спишется ровно эта сумма
        </p>
      </div>
    </div>
  )
}

function MethodRow({
  active,
  onSelect,
  glyph,
  glyphStyle,
  label,
  sub,
  badge
}: {
  active: boolean
  onSelect: () => void
  glyph: string
  glyphStyle: React.CSSProperties
  label: string
  sub: string
  badge?: string
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-3.5 rounded-[20px] p-4"
      style={
        active
          ? { border: '2px solid #062119', background: '#FFFFFF' }
          : { border: '1.5px solid #E3DCCB', background: '#FFFCF8' }
      }
    >
      <input type="radio" name="pay-method" className="sr-only" checked={active} onChange={onSelect} />
      <div
        className="flex size-11.5 shrink-0 items-center justify-center rounded-field text-lg font-extrabold"
        style={glyphStyle}
      >
        {glyph}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-extrabold">{label}</span>
          {badge && (
            <span
              className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold"
              style={{ background: '#D5F94E', color: '#062119' }}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[13px] font-semibold text-muted">{sub}</div>
      </div>
      {active && (
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold"
          style={{ background: '#062119', color: '#D5F94E' }}
        >
          ✓
        </span>
      )}
    </label>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-[14px]">
      <span className="font-semibold text-muted">{label}</span>
      <span className={`font-bold ${mono ? 'font-mono text-[13px]' : 'ep-sum'}`}>{value}</span>
    </div>
  )
}
