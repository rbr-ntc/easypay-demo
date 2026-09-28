import { useRef, useState } from 'react'
import { fmt } from '../../format'
import { newIdemKey } from '../../keys'
import { useStore } from '../../store'
import { go } from '../route'
import { tableAction, type StaffResult } from '../staffApi'
import { Confirm } from '../ui'
import { errorText, noteDecision, settleDebt, type Decision } from './adminApi'

/**
 * Карточка «требует решения»: долг закрытого стола, невозвращённая переплата,
 * стол, открытый слишком долго. У каждой — действие, которое снимает её из
 * очереди: число без действия владельцу бесполезно.
 *
 * Удержание с официанта здесь намеренно отсутствует: по ТК РФ (ст. 137, 138,
 * 241) это отдельная процедура с согласием работника — до юриста не делаем.
 */

const KIND: Record<Decision['kind'], { label: string; bg: string; fg: string }> = {
  debt: { label: 'Долг', bg: '#FBE9E4', fg: '#9E2E17' },
  refund: { label: 'Возврат', bg: '#FBF1DC', fg: '#7A5306' },
  long: { label: 'Долго открыт', bg: '#EEF3FA', fg: '#2D5A8A' }
}

type Dialog = null | 'writeoff' | 'note'

export function DecisionCard({ item, onDone, compact = false }: { item: Decision; onDone: () => void; compact?: boolean }) {
  const { toast: showToast } = useStore()
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [text, setText] = useState('')
  const refundKey = useRef(newIdemKey())
  const k = KIND[item.kind]

  // Ref, а не состояние: второй тап приходит раньше перерисовки
  const inFlight = useRef(false)
  const act = async (fn: () => Promise<StaffResult>, done: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const r = await fn()
    inFlight.current = false
    setBusy(false)
    if (!r.ok) {
      showToast(errorText(r))
      return
    }
    setMenu(false)
    setDialog(null)
    showToast(done)
    onDone()
  }

  const collect = (method: 'cash' | 'transfer' | 'sbp') =>
    act(() => settleDebt(item.sessionId!, 'collected', { method }), `Стол ${item.tableId}: долг взыскан`)
  const writeOff = () =>
    act(() => settleDebt(item.sessionId!, 'written_off', { reason: text.trim() }), `Стол ${item.tableId}: списано на заведение`)
  const refund = () =>
    act(async () => {
      // sessionId обязателен: за столом могли сесть новые гости, и без него
      // сервер вернул бы переплату из ИХ счёта
      const r = await tableAction(item.tableId!, 'refund', { amount: item.amount, sessionId: item.sessionId, idemKey: refundKey.current })
      if (r.ok) refundKey.current = newIdemKey()
      return r
    }, `Стол ${item.tableId}: переплата возвращена`)
  const note = () => act(() => noteDecision(item.id, text.trim()), 'Отметили — стол больше не в очереди')

  return (
    <div className={`c-card ${compact ? 'p-3.5' : 'p-4.5'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold" style={{ background: k.bg, color: k.fg }}>
            {k.label}
          </span>
          <div className={`mt-2 font-bold ${compact ? 'text-[15px]' : 'text-[16px]'}`}>{item.title}</div>
          {item.meta && <div className="mt-0.5 text-[13px] text-c-mute">{item.meta}</div>}
        </div>
        {item.amount > 0 && <div className="c-num text-[18px] font-bold whitespace-nowrap">{fmt(item.amount)}</div>}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {item.kind === 'debt' && (
          <>
            <div className="relative">
              <button
                disabled={busy}
                onClick={() => setMenu(m => !m)}
                aria-expanded={menu}
                className="h-10 rounded-xl bg-c-ink px-4 text-[14px] font-bold text-white disabled:opacity-50"
              >
                Взыскано ▾
              </button>
              {menu && (
                <div className="c-card c-fade absolute top-11 left-0 z-10 flex w-48 flex-col p-1.5" style={{ boxShadow: '0 16px 40px -16px rgba(0,0,0,.35)' }}>
                  {(
                    [
                      ['cash', 'Наличными'],
                      ['transfer', 'Переводом'],
                      ['sbp', 'По СБП']
                    ] as const
                  ).map(([m, label]) => (
                    <button key={m} onClick={() => collect(m)} disabled={busy} className="h-10 rounded-lg px-3 text-left text-[14px] hover:bg-c-chip disabled:opacity-50">
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setText('')
                setDialog('writeoff')
              }}
              className="h-10 rounded-xl border border-c-line bg-c-card px-4 text-[14px] disabled:opacity-50"
            >
              Списать на заведение…
            </button>
          </>
        )}
        {item.kind === 'refund' && (
          <>
            <button disabled={busy} onClick={refund} className="h-10 rounded-xl bg-c-ink px-4 text-[14px] font-bold text-white disabled:opacity-50">
              {busy ? 'Секунду…' : 'Вернул гостю'}
            </button>
            {/* За столом уже новые гости — из системы не вернуть, только отметить */}
            <button
              disabled={busy}
              onClick={() => {
                setText('')
                setDialog('note')
              }}
              className="h-10 rounded-xl border border-c-line bg-c-card px-4 text-[14px] disabled:opacity-50"
            >
              Вернули на кассе…
            </button>
          </>
        )}
        {item.kind === 'long' && (
          <>
            <button onClick={() => go({ ws: 'hall', table: item.tableId })} className="h-10 rounded-xl bg-c-ink px-4 text-[14px] font-bold text-white">
              Открыть стол
            </button>
            <button
              onClick={() => {
                setText('')
                setDialog('note')
              }}
              className="h-10 rounded-xl border border-c-line bg-c-card px-4 text-[14px]"
            >
              Всё в порядке…
            </button>
          </>
        )}
      </div>

      {dialog && (
        <Confirm
          title={
            dialog === 'writeoff'
              ? `Списать ${fmt(item.amount)} на заведение?`
              : item.kind === 'refund'
                ? `Стол ${item.tableId}: переплату вернули на кассе?`
                : `Стол ${item.tableId}: всё в порядке?`
          }
          ok={dialog === 'writeoff' ? 'Списать' : 'Отметить'}
          danger={dialog === 'writeoff'}
          busy={busy}
          onCancel={() => setDialog(null)}
          onOk={() => {
            if (text.trim().length < 3) return showToast('Напишите пару слов — это увидит владелец')
            void (dialog === 'writeoff' ? writeOff() : note())
          }}
          body={
            <>
              {dialog === 'writeoff'
                ? 'Долг перестанет висеть на смене и уйдёт в потери заведения. Удержание с официанта — только по отдельной процедуре с юристом.'
                : item.kind === 'refund'
                  ? 'Кто и как вернул: «Оля, наличными из кассы, 940 ₽». Отметка не меняет ожидаемую сумму в кассе: если деньги взяли из ящика, укажите это в комментарии к расхождению при закрытии смены.'
                  : 'Например: «компания на банкете, счёт в конце».'}
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={3}
                maxLength={200}
                aria-label="Комментарий"
                placeholder={dialog === 'writeoff' ? 'Причина: гость ушёл, не расплатившись…' : 'Комментарий'}
                className="mt-3 w-full resize-none rounded-xl border border-c-line bg-c-bg p-3 text-[14px] text-c-ink outline-none focus:border-c-ink"
              />
            </>
          }
        />
      )}
    </div>
  )
}
