import { useState } from 'react'
import { fmt, plural } from '../../format'
import { useStore } from '../../store'
import { go } from '../route'
import { Empty, Panel } from '../ui'
import { closeShift, errorText, fetchShift, openShift, useLoad, type Blocker, type Decision, type ShiftState, type ZReport } from './adminApi'
import { DecisionCard } from './DecisionCard'
import { hm, Loading, METHOD_LABEL, Row } from './parts'

/**
 * Закрытие смены — три шага: столы → деньги → Z-отчёт. Раньше смену нельзя
 * было закрыть вовсе: реестр копил всё с первого дня, долги висели числом.
 *
 * Открытый стол — выбор управляющей: закрыть сейчас или перенести в
 * следующую смену (гостя посреди ужина не выгоняют). Долг — каждый должен
 * получить решение. Касса — пересчёт, а расхождение только с объяснением.
 */

const STEPS = ['Столы и кухня', 'Деньги и касса', 'Z-отчёт'] as const

export function CloseShift() {
  const state = useLoad(fetchShift, [], 10_000)
  const [step, setStep] = useState(0)
  const [carry, setCarry] = useState<Set<string>>(new Set())
  const [cash, setCash] = useState('')
  const [note, setNote] = useState('')
  const [done, setDone] = useState<ZReport | null>(null)

  if (done) return <Closed z={done} />
  if (!state.data) return <Loading failed={state.failed} />
  const d = state.data
  if (!d.shift) return <Empty>Смена уже закрыта. Открыть новую можно на странице «Обзор».</Empty>

  const undecided = d.blockers.filter(b => !carry.has(b.tableId))
  const unresolved = d.debts.filter(x => x.left > 0.01)
  const counted = cash.trim() === '' ? null : Number(cash.replace(',', '.').replace(/\s/g, ''))
  const diff = counted === null || !Number.isFinite(counted) ? null : Math.round((counted - d.cash.system) * 100) / 100
  const cashOk = diff !== null && counted! >= 0 && (Math.abs(diff) < 0.01 || note.trim().length >= 4)

  const canNext = step === 0 ? undecided.length === 0 : step === 1 ? unresolved.length === 0 && cashOk : true
  const hint =
    step === 0
      ? undecided.length > 0 && `Решите по ${undecided.length} ${plural(undecided.length, 'столу', 'столам', 'столам')}: закрыть или перенести`
      : step === 1
        ? unresolved.length > 0
          ? `Долгов без решения: ${unresolved.length}`
          : diff === null
            ? 'Введите, сколько наличных в кассе'
            : !cashOk && 'Расхождение — напишите, откуда оно'
        : null

  return (
    <div className="mx-auto max-w-[880px]">
      <ol className="mb-6 grid grid-cols-3 gap-2.5" aria-label="Шаги закрытия">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined}>
            <div className="h-1.5 rounded-full" style={{ background: i <= step ? '#1B1A17' : '#E6E2DA' }} />
            <div className={`mt-2 text-[13px] ${i === step ? 'font-bold' : 'text-c-mute'}`}>
              {i + 1}. {label}
            </div>
          </li>
        ))}
      </ol>

      {step === 0 && <StepTables blockers={d.blockers} carry={carry} onCarry={id => setCarry(new Set([...carry, id]))} />}
      {step === 1 && (
        <StepMoney state={d} cash={cash} setCash={setCash} note={note} setNote={setNote} diff={diff} onChanged={() => void state.reload()} />
      )}
      {step === 2 && <StepZ state={d} counted={counted ?? 0} diff={diff ?? 0} note={note} onClosed={setDone} />}

      <div className="mt-6 flex items-center gap-3 border-t border-c-line pt-5">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)} className="h-11 rounded-xl border border-c-line bg-c-card px-4.5 text-[15px]">
            ← Назад
          </button>
        ) : (
          <button onClick={() => go({ ws: 'admin', page: 'overview' })} className="h-11 rounded-xl border border-c-line bg-c-card px-4.5 text-[15px]">
            Отмена
          </button>
        )}
        <span className="flex-1 text-right text-[13px] text-c-mute">{hint || ''}</span>
        {step < 2 && (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canNext}
            className="h-11 rounded-xl bg-c-ink px-5.5 text-[15px] font-bold text-white disabled:opacity-40"
          >
            Дальше →
          </button>
        )}
      </div>
    </div>
  )
}

function StepTables({ blockers, carry, onCarry }: { blockers: Blocker[]; carry: Set<string>; onCarry: (id: string) => void }) {
  if (blockers.length === 0) return <Empty>Все столы закрыты, кухня пуста — можно дальше.</Empty>
  return (
    <div className="flex flex-col gap-2.5">
      <p className="mb-1 text-[14px] text-c-soft">
        Открытый стол можно закрыть сейчас или перенести в следующую смену — гости доужинают, их счёт уйдёт в новую смену.
      </p>
      {blockers.map(b => {
        const carried = carry.has(b.tableId)
        const facts = [
          `${b.guests} гост.`,
          b.openedAt ? `с ${hm(b.openedAt)}` : null,
          b.remaining > 0 ? `к оплате ${fmt(b.remaining)}` : 'оплачен',
          b.kitchen.length ? `на кухне: ${b.kitchen.join(', ')}` : null,
          b.cash > 0 ? `ждут официанта с наличными ${fmt(b.cash)}` : null,
          b.calls > 0 ? `вызовов: ${b.calls}` : null
        ].filter(Boolean)
        return (
          <div key={b.tableId} className="c-card flex flex-wrap items-center gap-3 p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-c-chip text-[17px] font-bold">{b.tableId}</span>
            <div className="min-w-0 flex-1 basis-56">
              <div className="text-[15px] font-bold">Стол {b.tableId}</div>
              <div className="text-[13px] text-c-mute">{facts.join(' · ')}</div>
            </div>
            {carried ? (
              <span className="ml-auto flex h-10 items-center rounded-xl bg-c-ok-bg px-3.5 text-[14px] font-bold text-c-ok-fg">✓ Переносим</span>
            ) : (
              <div className="ml-auto flex gap-2">
                <button onClick={() => go({ ws: 'hall', table: b.tableId })} className="h-10 rounded-xl border border-c-line bg-c-card px-3.5 text-[14px]">
                  Закрыть стол
                </button>
                <button onClick={() => onCarry(b.tableId)} className="h-10 rounded-xl bg-c-ink px-3.5 text-[14px] font-bold text-white">
                  Перенести
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepMoney(props: {
  state: ShiftState
  cash: string
  setCash: (v: string) => void
  note: string
  setNote: (v: string) => void
  diff: number | null
  onChanged: () => void
}) {
  const { state, diff } = props
  const debts: Decision[] = state.debts
    .filter(x => x.left > 0.01)
    .map(x => ({
      id: `debt:${x.sessionId}`,
      kind: 'debt',
      sessionId: x.sessionId,
      tableId: x.tableId,
      title: `Стол ${x.tableId} закрыт с долгом`,
      meta: [x.waiter, x.closedAt ? `закрыт в ${hm(x.closedAt)}` : null, `${x.guests} гост.`].filter(Boolean).join(' · '),
      amount: x.left,
      at: x.closedAt
    }))
  const refunds: Decision[] = state.refunds.map(x => ({
    id: `refund:${x.sessionId}`,
    kind: 'refund',
    sessionId: x.sessionId,
    tableId: x.tableId,
    title: `Стол ${x.tableId} — переплата не возвращена`,
    meta: 'Если не вернуть сейчас, уйдёт в Z-отчёт как долг заведения',
    amount: x.amount,
    at: x.closedAt
  }))

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-2.5 text-[16px] font-bold">Долги смены</h2>
        {debts.length === 0 ? (
          <Empty>Долгов нет — все закрытые столы оплачены.</Empty>
        ) : (
          <div className="flex flex-col gap-2.5">
            {debts.map(item => (
              <DecisionCard key={item.id} item={item} onDone={props.onChanged} />
            ))}
          </div>
        )}
        <p className="mt-2.5 text-[12px] text-c-mute">
          Удержать долг из зарплаты официанта нельзя без его письменного согласия и отдельной процедуры (ТК РФ, ст. 137, 138, 241) — этот
          вариант появится после консультации юриста.
        </p>
      </section>

      {refunds.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[16px] font-bold">Переплаты гостей</h2>
          <div className="flex flex-col gap-2.5">
            {refunds.map(item => (
              <DecisionCard key={item.id} item={item} onDone={props.onChanged} />
            ))}
          </div>
        </section>
      )}

      <Panel title="Касса: наличные">
        <div className="grid gap-4 p-4.5 sm:grid-cols-3">
          <div>
            <div className="text-[12px] text-c-mute">По системе</div>
            <div className="c-num mt-1 text-[22px] font-bold">{fmt(state.cash.system)}</div>
            {state.cash.collected > 0 && <div className="text-[12px] text-c-mute">из них взыскано долгов {fmt(state.cash.collected)}</div>}
          </div>
          <label className="block">
            <span className="text-[12px] text-c-mute">Пересчитали в кассе, ₽</span>
            <input
              inputMode="decimal"
              value={props.cash}
              onChange={e => props.setCash(e.target.value.replace(/[^\d.,\s]/g, ''))}
              placeholder="0"
              className="c-num mt-1 h-11 w-full rounded-xl border border-c-line bg-c-bg px-3 text-[20px] font-bold outline-none focus:border-c-ink"
            />
          </label>
          <div>
            <div className="text-[12px] text-c-mute">Расхождение</div>
            <div
              className={`c-num mt-1 text-[22px] font-bold ${diff === null ? 'text-c-mute' : Math.abs(diff) < 0.01 ? 'text-c-ok-ink' : 'text-c-bad-ink'}`}
            >
              {diff === null ? '—' : Math.abs(diff) < 0.01 ? 'сходится' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
            </div>
          </div>
        </div>
        {diff !== null && Math.abs(diff) >= 0.01 && (
          <div className="border-t border-c-line2 p-4.5">
            <label className="text-[13px] font-bold" htmlFor="cash-note">
              {diff > 0 ? 'Излишек' : 'Недостача'} — откуда? Без объяснения смену не закрыть
            </label>
            <textarea
              id="cash-note"
              value={props.note}
              onChange={e => props.setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Например: сдача с 5000 выдана дважды, разбираемся с Олей"
              className="mt-2 w-full resize-none rounded-xl border border-c-line bg-c-bg p-3 text-[14px] outline-none focus:border-c-ink"
            />
          </div>
        )}
      </Panel>
    </div>
  )
}

function StepZ({ state, counted, diff, note, onClosed }: { state: ShiftState; counted: number; diff: number; note: string; onClosed: (z: ZReport) => void }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const close = async () => {
    setBusy(true)
    const r = await closeShift(counted, note.trim())
    setBusy(false)
    if (!r.ok) return toast(errorText(r))
    onClosed((r.body as { z: ZReport }).z)
  }
  return (
    <div>
      <ZTable z={{ report: state.report, carried: state.blockers, settlements: [], cash: { system: state.cash.system, counted, diff, note: note || null } }} />
      <button
        onClick={close}
        disabled={busy}
        className="mt-5 h-13 w-full rounded-xl bg-c-ink text-[16px] font-bold text-white disabled:opacity-50"
      >
        {busy ? 'Закрываем…' : 'Закрыть смену и сформировать Z-отчёт'}
      </button>
    </div>
  )
}

/** Z-отчёт строками — и в мастере, и в карточке закрытой смены. */
export function ZTable({ z }: { z: ZReport }) {
  const r = z.report
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Panel title="Выручка">
        <div className="px-4.5 py-1">
          <Row label="Выручка" value={fmt(r.revenue)} strong />
          {Object.entries(r.byMethod).map(([k, v]) => (
            <Row key={k} label={`· ${METHOD_LABEL[k] ?? k}`} value={fmt(v)} />
          ))}
          <Row label="Возвраты гостям" value={fmt(r.refunds)} />
          <Row label="Чистая выручка" value={fmt(r.netRevenue)} strong />
          <Row label="Чаевые (мимо кассы)" value={fmt(r.tips)} />
        </div>
      </Panel>
      <Panel title="Смена">
        <div className="px-4.5 py-1">
          <Row label="Чеков" value={r.checks} />
          <Row label="Гостей" value={r.guests} />
          <Row label="Средний чек" value={fmt(r.avgCheck)} />
          <Row label="Долг (решён)" value={fmt(r.debt)} tone={r.debt > 0 ? 'bad' : undefined} />
          <Row label="Снято с кухни" value={fmt(r.writtenOff)} />
          <Row label="Перенесено столов" value={z.carried.length} />
        </div>
      </Panel>
      {z.cash && (
        <Panel title="Касса" className="md:col-span-2">
          <div className="px-4.5 py-1">
            <Row label="Наличные по системе" value={fmt(z.cash.system)} />
            <Row label="Пересчитано" value={fmt(z.cash.counted)} />
            <Row
              label={z.cash.note ? `Расхождение · ${z.cash.note}` : 'Расхождение'}
              value={Math.abs(z.cash.diff) < 0.01 ? 'нет' : `${z.cash.diff > 0 ? '+' : ''}${fmt(z.cash.diff)}`}
              tone={Math.abs(z.cash.diff) < 0.01 ? 'ok' : 'bad'}
              strong
            />
          </div>
        </Panel>
      )}
    </div>
  )
}

function Closed({ z }: { z: ZReport }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const reopen = async () => {
    setBusy(true)
    const r = await openShift()
    setBusy(false)
    if (!r.ok) return toast(errorText(r))
    toast('Новая смена открыта')
    go({ ws: 'admin', page: 'overview' })
  }
  return (
    <div className="mx-auto max-w-[880px]">
      <div className="c-card mb-5 flex flex-wrap items-center gap-4 p-5.5">
        <span className="flex size-12 items-center justify-center rounded-full bg-c-ok-bg text-[22px] text-c-ok-fg">✓</span>
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-bold">Смена закрыта</div>
          <div className="text-[14px] text-c-mute">
            Z-отчёт сохранён в истории смен.
            {z.carried.length > 0 && ` Перенесено столов: ${z.carried.length} — они откроются в новой смене.`}
          </div>
        </div>
        <button onClick={() => window.print()} className="h-11 rounded-xl border border-c-line bg-c-card px-4 text-[15px]">
          Распечатать
        </button>
        <button onClick={reopen} disabled={busy} className="h-11 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold text-white disabled:opacity-50">
          {busy ? 'Секунду…' : 'Открыть новую смену'}
        </button>
      </div>
      <ZTable z={z} />
    </div>
  )
}
