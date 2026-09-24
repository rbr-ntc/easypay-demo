import { useEffect, useRef, useState } from 'react'
import { newIdemKey } from '../keys'
import { useStore } from '../store'
import type { PayMethod, PayScope } from '../store'
import { tableId } from '../api'
import type { ServerLine, Snapshot } from '../api'
import { fmt, listNames } from '../format'
import { sharersOf } from '@easypay/domain/money'
import { dishPhoto } from '../guest/showcase'
import { SETTINGS } from '../settings'

/**
 * Оплата: сумма, за кого, чем — и удержание кнопки.
 *
 * Удержание, а не тап: деньги не должны уходить от случайного касания.
 * Обычное нажатие — с клавиатуры, экранной читалкой или просто коротким
 * тапом — не игнорируется, а открывает шаг «Оплатить X?»: два осознанных
 * действия вместо одного долгого.
 */

// ── Ключ платежа ────────────────────────────────────────────────────────
// Живёт ДО успешной оплаты — в том числе через уход на «Стол» и перезагрузку.
// Экран ошибки сам советует «обновите экран»; ключ в памяти компонента на
// этом терялся, и повтор после обновления становился новым платежом.
// Сервер запоминает по ключу только успешный ответ, поэтому отказ банка
// долгоживущий ключ не «заклинит».
const PAY_KEY = `easypay-paykey-${tableId}`
let memKey: { key: string; base: number } | null = null

function readAttempt(): { key: string; base: number } | null {
  try {
    const raw = sessionStorage.getItem(PAY_KEY)
    return raw ? JSON.parse(raw) : memKey
  } catch {
    return memKey
  }
}

/** Ключ текущей попытки; `base` — сколько гость внёс ДО неё. */
function attemptFor(myPaid: number): { key: string; base: number } {
  const cur = readAttempt()
  if (cur) return cur
  const next = { key: newIdemKey(), base: myPaid }
  memKey = next
  try {
    sessionStorage.setItem(PAY_KEY, JSON.stringify(next))
  } catch {
    /* приватный режим — живём на памяти */
  }
  return next
}

function finishAttempt() {
  memKey = null
  try {
    sessionStorage.removeItem(PAY_KEY)
  } catch {
    /* нечего чистить */
  }
}

/** Сколько гость внёс сам — по платежам снапшота, а не по остатку. */
function paidBy(snap: Snapshot, personaId: string): number {
  return snap.payments.filter(p => p.personaId === personaId).reduce((a, p) => a + p.amount, 0)
}

const HOLD_MS = 900

const METHODS: { id: PayMethod; label: string; sub: string; glyph: string }[] = [
  { id: 'sbp', label: 'СБП', sub: 'Откроется приложение банка · быстрее всего', glyph: 'СБП' },
  { id: 'card', label: 'Карта', sub: 'Ввод реквизитов', glyph: '▭' },
  { id: 'cash', label: 'Наличными официанту', sub: 'Официант подойдёт и подтвердит', glyph: '₽' }
]

const SCOPE_NAME: Record<PayScope, string> = { own: 'Своё', equal: 'Поровну', full: 'Весь стол' }

/** Способы, включённые в настройках заведения: выключенный сервер всё равно не примет. */
const allowedMethods = () => METHODS.filter(m => SETTINGS.pay[m.id as 'sbp' | 'card' | 'cash'])

/**
 * Делёж выключен — за столом на нескольких платят только целиком. Кто-то уже
 * заплатил «поровну» — остальным тоже поровну: смесь «поровну» и «своё»
 * оставляла копеечные хвосты и путала суммы (живой стол 3).
 */
const allowedScopes = (alone: boolean, equalMode: boolean): PayScope[] =>
  alone ? ['own'] : !SETTINGS.pay.split ? ['full'] : equalMode ? ['equal', 'full'] : ['own', 'equal', 'full']

export function Payment() {
  const { ui, patch, me, snap, totals, pay, askCash, cancelCash, menuRev } = useStore()
  const doneTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(doneTimer.current), [])
  // Менеджер выключил способ или делёж посреди ужина — выбор гостя поправляем сами
  const alone = totals.participants <= 1
  // Ключ, оставшийся от прошлой попытки, которая всё-таки прошла: гость с тех
  // пор внёс больше, чем до неё, — значит, это уже новая оплата и новый ключ
  const myPaidNow = me && snap ? paidBy(snap, me.id) : 0
  useEffect(() => {
    const cur = readAttempt()
    if (cur && myPaidNow > cur.base + 0.01) finishAttempt()
  }, [myPaidNow])
  useEffect(() => {
    const methods = allowedMethods().map(m => m.id)
    const scopes = allowedScopes(alone, totals.equalMode)
    const fix: { payMethod?: PayMethod; payScope?: PayScope } = {}
    if (methods.length && !methods.includes(ui.payMethod)) fix.payMethod = methods[0]
    if (!scopes.includes(ui.payScope)) fix.payScope = scopes[0]
    if (fix.payMethod || fix.payScope) patch(fix)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.payMethod, ui.payScope, alone, menuRev, totals.equalMode])
  if (!me || !snap) return null

  const amount = totals.scopeAmount(ui.payScope)

  const doPay = async () => {
    const attempt = attemptFor(paidBy(snap, me.id))
    patch({ payStage: 'processing', payError: null })
    const res = await pay(ui.payScope, attempt.key, ui.payMethod)
    if (res.paid > 0) {
      finishAttempt() // следующая оплата — новый ключ
      doneTimer.current = setTimeout(() => patch({ payStage: 'form', screen: 'done' }), 1400)
      return
    }
    // Ключ НЕ меняем: повтор идёт тем же — двойного списания не будет.
    // Причину показываем настоящую: «банк не подтвердил» и «связь оборвалась»
    // это разные вещи, и во втором случае деньги могли уйти.
    // Ключ прошлой попытки устарел (счёт с тех пор изменился) — следующая
    // попытка пойдёт с новым, иначе старый чек «оплачивал» бы новое блюдо
    if (res.code === 'stale key') finishAttempt()
    patch({ payStage: 'failed', payError: res.error, payUnknown: res.unknown })
  }

  if (ui.payStage === 'processing') {
    return (
      <div className="g-anim-fade absolute inset-0 flex flex-col items-center justify-center gap-6 px-8 text-center">
        <span
          className="g-spin size-16 rounded-full"
          style={{ border: '4px solid rgba(255,255,255,.1)', borderTopColor: 'var(--g-acc)' }}
        />
        <div>
          <div className="text-[20px] font-bold">Проводим оплату</div>
          <div className="mt-1.5 text-[15px] text-g-mute">Не закрывайте экран</div>
        </div>
      </div>
    )
  }

  if (ui.payStage === 'qr') {
    return <SbpCode amount={amount} onBack={() => patch({ payStage: 'form' })} onPaid={() => void doPay()} />
  }

  if (ui.payStage === 'failed') {
    return <Failed amount={amount} onRetry={() => void doPay()} base={readAttempt()?.base ?? null} mine={paidBy(snap, me.id)} />
  }

  return <PayForm amount={amount} onPay={() => void doPay()} askCash={askCash} cancelCash={cancelCash} />
}

function PayForm({
  amount,
  onPay,
  askCash,
  cancelCash
}: {
  amount: number
  onPay: () => void
  askCash: (scope: PayScope) => Promise<number>
  cancelCash: () => Promise<void>
}) {
  const { ui, patch, me, snap, totals } = useStore()
  if (!me || !snap) return null

  const cash = ui.payMethod === 'cash'
  const sbp = ui.payMethod === 'sbp'
  const myCashRequest = snap.cashIntent?.personaId === me.id ? snap.cashIntent : null
  const alone = totals.participants <= 1
  const scopes = allowedScopes(alone, totals.equalMode)
  const otherPayments = snap.payments.filter(p => p.personaId !== me.id)
  const nameOf = (pid: string) => snap.personas.find(p => p.id === pid)?.name ?? 'Гость'

  // Три моих блюда веером — «за что я плачу» узнаётся по фото быстрее, чем по списку
  const personaIds = snap.personas.map(p => p.id)
  const isMine = (l: ServerLine) =>
    !l.cancelled && l.sent && (l.personaId === me.id || (l.shared && sharersOf(l as any, personaIds).includes(me.id)))
  const photos = Array.from(new Set(snap.lines.filter(isMine).map(l => l.dishId))).slice(0, 3)
  const fan =
    photos.length === 1 ? ['none'] : ['rotate(-9deg) translate(-78px,14px)', 'rotate(8deg) translate(78px,14px)', 'none']

  const title = ui.payScope === 'full' ? 'К оплате за весь стол' : ui.payScope === 'equal' ? 'К оплате — поровну' : 'К оплате с вас'
  const others = snap.personas.filter(p => p.id !== me.id).map(p => p.name)
  const breakdown =
    ui.payScope === 'own'
      ? totals.myPaid > 0.01
        ? `вы уже внесли ${fmt(totals.myPaid)}`
        : totals.myShare > 0
          ? `${fmt(totals.myOwn)} ваше + ${fmt(totals.myShare)} доля общих блюд`
          : 'только ваши блюда — считает сервер'
      : ui.payScope === 'equal'
        ? totals.myPaid > 0.01
          ? `${fmt(totals.tableTotal)} поровну на ${totals.equalSplit} — по ${fmt(totals.tableTotal / totals.equalSplit)}, вы уже внесли ${fmt(totals.myPaid)}`
          : `${fmt(totals.tableTotal)} поровну на ${totals.equalSplit} — по ${fmt(totals.tableTotal / totals.equalSplit)}`
        : others.length
          ? `${listNames(others)} ${others.length === 1 ? 'увидит' : 'увидят'}, что стол оплачен`
          : 'Весь счёт стола'

  return (
    <div className="g-anim-fade absolute inset-0 flex flex-col">
      <div className="g-noscroll flex-1 overflow-y-auto pb-5">
        <div className="relative h-70 overflow-hidden">
          <div className="absolute top-17.5 left-1/2 size-0">
            {photos.map((id, i) => (
              <div
                key={id}
                className="absolute top-0 -left-17.5 h-43.75 w-35 overflow-hidden rounded-[22px] bg-g-s1"
                style={{
                  transform: fan[photos.length === 1 ? 0 : i] ?? 'none',
                  boxShadow: '0 20px 40px -18px rgba(0,0,0,.8)',
                  border: '3px solid var(--g-s1)'
                }}
              >
                <img src={dishPhoto(id)} alt="" className="size-full object-cover" />
              </div>
            ))}
          </div>
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgba(14,13,12,0) 55%, var(--g-paper) 100%)' }}
          />
          <button
            aria-label="Назад к столу"
            onClick={() => patch({ screen: 'table' })}
            className="absolute top-3.5 left-4 size-11 rounded-full bg-g-s1 text-lg text-g-fg"
          >
            ←
          </button>
        </div>

        <div className="px-5 text-center">
          <div className="text-[15px] text-g-mute">{title}</div>
          <div className="g-num mt-1.5 text-[48px] leading-none font-bold tracking-tight">{fmt(amount)}</div>
          <div className="mt-2.5 text-[13px] text-balance text-g-mute">{breakdown}</div>
          {otherPayments.length > 0 && (
            <div className="g-num mt-2 text-[13px] text-g-soft">
              {/* Без глагола в прошедшем времени: «Лиза внёс» из имени не угадать */}
              уже оплачено: {otherPayments.map(p => `${nameOf(p.personaId)} ${fmt(p.amount)}`).join(', ')} · по столу
              осталось {fmt(totals.remaining)}
            </div>
          )}
        </div>

        {scopes.length > 1 && (
          <div className="mt-5.5 flex flex-wrap justify-center gap-2 px-4">
            {scopes.map(s => {
              const on = s === ui.payScope
              return (
                <button
                  key={s}
                  onClick={() => patch({ payScope: s })}
                  aria-pressed={on}
                  className={`g-num h-10 rounded-full px-4 text-[15px] ${on ? 'font-bold text-g-on-acc' : 'text-g-soft'}`}
                  style={on ? { background: '#F3F0EA' } : { border: '1px solid rgba(255,255,255,.1)' }}
                >
                  {on ? SCOPE_NAME[s] : `${SCOPE_NAME[s]} · ${fmt(totals.scopeAmount(s))}`}
                </button>
              )
            })}
          </div>
        )}

        <div className="mx-4 mt-7 overflow-hidden rounded-3xl bg-g-s1" role="radiogroup" aria-label="Способ оплаты">
          {allowedMethods().map((m, i) => {
            const on = ui.payMethod === m.id
            return (
              <button
                key={m.id}
                role="radio"
                aria-checked={on}
                onClick={() => patch({ payMethod: m.id })}
                className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left text-g-fg"
                style={i ? { borderTop: '1px solid rgba(255,255,255,.1)' } : undefined}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold ${m.id === 'sbp' ? 'g-sbp' : 'bg-g-sand text-g-fg'}`}
                >
                  {m.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{m.label}</span>
                  <span className="block text-[13px] text-g-mute">{m.sub}</span>
                </span>
                <span
                  className="size-5.5 shrink-0 rounded-full"
                  style={{ border: on ? '7px solid var(--g-acc)' : '1.5px solid #6E685F' }}
                />
              </button>
            )
          })}
        </div>

        {/* Просьба про наличные видна при ЛЮБОМ выбранном способе: иначе,
            переключившись на СБП, гость о ней забывал, а официант шёл зря */}
        {myCashRequest && (
          <div className="mx-4 mt-3 rounded-3xl bg-g-s1 p-4">
            <div className="text-[17px] font-bold">{snap.waiter?.name ?? 'Официант'} идёт за наличными</div>
            <div className="g-num mt-1 text-[15px] text-g-tan">{fmt(myCashRequest.amount)}</div>
            <div className="mt-1.5 text-[13px] leading-normal text-g-mute">
              В счёте пока ничего не изменилось. Официант возьмёт деньги и подтвердит — тогда оплата появится у всех за
              столом.
            </div>
            <button onClick={() => void cancelCash()} className="mt-2.5 h-10 text-[15px] font-bold text-g-tan">
              Лучше заплачу телефоном
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 bg-g-paper px-4 pt-3 pb-[calc(1.125rem+env(safe-area-inset-bottom))]">
        {cash ? (
          <button
            disabled={amount <= 0 || !!myCashRequest}
            onClick={() => void askCash(ui.payScope)}
            className="g-cta g-num h-15 w-full rounded-full text-[17px] disabled:opacity-45"
          >
            {myCashRequest ? 'Официант уже идёт' : `Позвать официанта · ${fmt(amount)}`}
          </button>
        ) : (
          <PayButton
            disabled={amount <= 0}
            sbp={sbp}
            amount={amount}
            onDone={() => (sbp ? patch({ payStage: 'qr' }) : onPay())}
          />
        )}
      </div>
    </div>
  )
}

/** Удержание или «нажал → подтвердил»: оплата — всегда два осознанных действия. */
function PayButton({
  sbp,
  amount,
  disabled,
  onDone
}: {
  sbp: boolean
  amount: number
  disabled: boolean
  onDone: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const label = `Оплатить ${sbp ? 'по СБП ' : ''}· ${fmt(amount)}`

  if (confirming) {
    return (
      <div role="group" aria-label="Подтвердите оплату">
        <div className="g-num mb-2.5 text-center text-[15px] text-g-fg">
          Оплатить {fmt(amount)}
          {sbp ? ' по СБП' : ''}?
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirming(false)}
            className="h-15 flex-1 rounded-full bg-g-s1 text-[17px] text-g-fg"
          >
            Отмена
          </button>
          <button
            autoFocus
            onClick={() => {
              setConfirming(false)
              onDone()
            }}
            className={`g-num h-15 flex-[2] rounded-full text-[17px] font-bold ${sbp ? 'g-sbp' : 'bg-g-sand text-g-fg'}`}
          >
            Да, оплатить
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <HoldButton
        label={label}
        sbp={sbp}
        disabled={disabled}
        onDone={onDone}
        onTap={() => setConfirming(true)}
      />
      <div id="pay-hold-hint" className="mt-2 text-center text-[12px] text-g-mute">
        Удерживайте — так не оплатите случайно. Или нажмите и подтвердите
      </div>
    </>
  )
}

function HoldButton({
  label,
  sbp,
  disabled,
  onDone,
  onTap
}: {
  label: string
  sbp: boolean
  disabled: boolean
  onDone: () => void
  onTap: () => void
}) {
  const [p, setP] = useState(0)
  const raf = useRef(0)
  const fired = useRef(false)
  const holding = useRef(false)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const start = (e: React.PointerEvent) => {
    // Второй палец не запускает второй цикл поверх первого
    if (disabled || holding.current) return
    holding.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    fired.current = false
    const t0 = performance.now()
    const tick = () => {
      const v = Math.min(1, (performance.now() - t0) / HOLD_MS)
      setP(v)
      if (v >= 1) {
        fired.current = true
        holding.current = false
        setP(0)
        onDone()
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const stop = () => {
    cancelAnimationFrame(raf.current)
    holding.current = false
    if (!fired.current) setP(0)
  }

  return (
    <button
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      // Удержание не состоялось — короткий тап, клавиатура, VoiceOver. Не
      // игнорируем и не платим сразу: открываем подтверждение
      onClick={() => {
        if (!disabled && !fired.current) onTap()
        fired.current = false
      }}
      aria-describedby="pay-hold-hint"
      onContextMenu={e => e.preventDefault()}
      className={`g-num relative h-15 w-full touch-none overflow-hidden rounded-full text-[17px] font-bold select-none disabled:opacity-45 ${sbp ? 'g-sbp' : 'bg-g-sand text-g-fg'}`}
    >
      <span className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${Math.round(p * 100)}%` }} />
      <span className="relative">{p > 0 ? 'Держите…' : label}</span>
    </button>
  )
}

/** Оплата по СБП: код живёт пять минут, дальше его надо перевыпустить. */
function SbpCode({ amount, onBack, onPaid }: { amount: number; onBack: () => void; onPaid: () => void }) {
  const [ttl, setTtl] = useState(299)
  useEffect(() => {
    const t = setInterval(() => setTtl(x => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const mm = String(Math.floor(ttl / 60)).padStart(2, '0')
  const ss = String(ttl % 60).padStart(2, '0')
  const expired = ttl === 0

  return (
    <div className="g-anim-fade absolute inset-0 flex flex-col px-5 pt-3.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-3">
        <button aria-label="Назад" onClick={onBack} className="size-11 rounded-full bg-g-sand text-lg text-g-fg">
          ←
        </button>
        <h1 className="g-serif text-[34px]">оплата по СБП</h1>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {/* Заглушка до эквайринга: настоящий код СБП выдаёт банк. Узор нарочно
            не сканируется — рабочий QR с выдуманной ссылкой хуже, чем никакой. */}
        <div className="relative rounded-[28px] bg-white p-4.5" style={{ opacity: expired ? 0.3 : 1 }}>
          <div
            className="size-55 rounded-md"
            style={{
              backgroundImage: 'repeating-conic-gradient(#14120F 0% 25%, #FFFFFF 0% 50%)',
              backgroundSize: '18px 18px'
            }}
          />
          <span
            className="g-sbp absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[14px] text-[13px] font-bold"
            style={{ boxShadow: '0 0 0 6px #FFFFFF' }}
          >
            СБП
          </span>
        </div>
        <div className="g-num mt-6.5 text-[44px] leading-none tracking-tight">{fmt(amount)}</div>
        <div className="mt-2.5 text-[15px] text-g-mute">Наведите камеру или откройте приложение банка</div>
        <div className="g-num mt-1 text-[13px] text-g-mute">
          {expired ? 'код истёк' : `код действует ${mm}:${ss}`}
        </div>
      </div>

      {expired ? (
        <button onClick={() => setTtl(299)} className="g-cta h-15 w-full rounded-full text-[17px]">
          Выпустить новый код
        </button>
      ) : (
        <button onClick={onPaid} className="g-sbp h-15 w-full rounded-full text-[17px] font-bold">
          Открыть приложение банка
        </button>
      )}
      <button onClick={onBack} className="mt-2 h-11 text-[15px] text-g-mute">
        Другой способ
      </button>
    </div>
  )
}

function Failed({
  amount,
  onRetry,
  base,
  mine
}: {
  amount: number
  onRetry: () => void
  /** Сколько гость внёс ДО этой попытки. */
  base: number | null
  /** Сколько внёс сейчас — по платежам снапшота. */
  mine: number
}) {
  const { ui, patch } = useStore()
  /**
   * Списались деньги или нет — знает снапшот, а не мы. Но «прошла» — только
   * если ответа не было И собственные платежи гостя выросли за эту попытку.
   * Раньше смотрели на «личный остаток ноль»: гость, заплативший своё раньше,
   * получал отказ банка на оплате всего стола — и видел «всё-таки прошла».
   */
  const grew = base !== null ? mine - base : 0
  const settled = ui.payUnknown && grew > 0.01
  const method = ui.payMethod === 'sbp' ? 'СБП' : ui.payMethod === 'cash' ? 'Наличные' : 'Карта'

  if (settled) {
    return (
      <div className="g-anim-fade absolute inset-0 flex flex-col px-5 pt-10 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex-1">
          <h1 className="g-serif text-[44px]">оплата всё-таки прошла</h1>
          <div className="mt-3 text-[17px] leading-normal text-g-body">
            Ответ потерялся по дороге, но {fmt(grew)} уже в счёте — платить ещё раз не нужно.
          </div>
        </div>
        <button
          onClick={() => {
            finishAttempt()
            // Чека от сервера нет — ответ потерялся; сумму знаем по снапшоту
            patch({ payStage: 'form', screen: 'done', lastPaid: grew, lastReceipt: null })
          }}
          className="g-cta h-15 w-full rounded-full text-[17px]"
        >
          К чеку
        </button>
      </div>
    )
  }

  return (
    <div className="g-anim-fade absolute inset-0 flex flex-col px-5 pt-10 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      <div className="flex-1">
        <h1 className="g-serif text-[44px]">оплата не прошла</h1>
        <div className="mt-3 text-[17px] leading-normal text-g-body">
          {ui.payUnknown
            ? 'Мы не получили ответ. Не платите вторым способом — сначала обновите экран или спросите официанта.'
            : `${ui.payError ?? 'Банк не подтвердил платёж'}. Деньги не списаны.`}
        </div>
        <div className="mt-6 rounded-[20px] bg-g-s1 px-4.5 py-1.5">
          <div className="flex py-3 text-[15px]">
            <span className="flex-1 text-g-mute">Сумма</span>
            <span className="g-num">{fmt(amount)}</span>
          </div>
          <div className="flex py-3 text-[15px]" style={{ borderTop: '1px solid rgba(255,255,255,.1)' }}>
            <span className="flex-1 text-g-mute">Способ</span>
            <span>{method}</span>
          </div>
          <div className="py-3 text-[13px] text-g-ok" style={{ borderTop: '1px solid rgba(255,255,255,.1)' }}>
            Повтор идёт той же попыткой — двойного списания не будет
          </div>
        </div>
      </div>
      <button onClick={onRetry} className="g-sbp g-num h-15 w-full rounded-full text-[17px] font-bold">
        Повторить · {fmt(amount)}
      </button>
      <button onClick={() => patch({ payStage: 'form' })} className="mt-2 h-12 text-[15px] text-g-fg">
        Выбрать другой способ
      </button>
    </div>
  )
}
