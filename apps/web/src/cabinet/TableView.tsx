import { useEffect, useRef, useState } from 'react'
import type { Snapshot, ServerLine } from '../api'
import { findDish, optionsLabel } from '../data'
import { zoneOfTable } from '../hallConfig'
import { useStore } from '../store'
import { newIdemKey } from '../keys'
import { fmt, listNames } from '../format'
import { fmtDur } from '../waiter/duration'
import { computeMetrics } from '../waiter/tableMetrics'
import { AddDishDrawer } from './AddDishDrawer'
import { lineStage, type LineStage } from '../lineStage'
import { Avatar } from '../avatars'
import { useCab } from './Shell'
import { subscribeTable, tableAction, staffError } from './staffApi'
import { CallRow, groupCalls } from './CallRow'
import { Confirm, Empty, Panel } from './ui'

/**
 * Стол целиком — для официанта и менеджера. Всё, что раньше жило на
 * отдельном «экране ресторана» по `?t=`, теперь открывается кликом из зала.
 */

const STAGE: Record<LineStage | 'draft', { label: string; color: string; next?: { label: string; action: 'start' | 'ready' | 'serve' } }> = {
  draft: { label: 'Ещё у гостя', color: '#6B665E' },
  queued: { label: 'В очереди', color: '#6B665E', next: { label: 'Готовится', action: 'start' } },
  cooking: { label: 'Готовится', color: '#C98A1B', next: { label: 'Готово', action: 'ready' } },
  ready: { label: 'Готово, несите', color: '#2D5A8A', next: { label: 'Подано', action: 'serve' } },
  served: { label: 'Подано', color: '#2E8A55' },
  cancelled: { label: 'Снято', color: '#B03A1E' }
}

const METHOD: Record<string, string> = { sbp: 'СБП', card: 'карта', cash: 'наличные' }

const time = (at: number | null | undefined) =>
  at ? new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'

export function TableView({ id }: { id: string }) {
  const { may, toast } = useStore()
  const { hall, now } = useCab()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [live, setLive] = useState(false)
  const [ask, setAsk] = useState<{ reasons: string[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // Ключ возврата живёт до успеха: ретрай после обрыва не отдаст деньги дважды
  const refundKey = useRef(newIdemKey())

  useEffect(() => {
    setSnap(null)
    return subscribeTable(id, setSnap, setLive)
  }, [id])

  // Официант и уборка — из ленты зала: в снимке стола их нет
  const card = (hall?.tables ?? []).find(x => x.id === id) as
    | { waiterName?: string | null; cleanedAt?: number | null }
    | undefined
  const waiter = card?.waiterName ?? 'не закреплён'
  const zone = zoneOfTable(id) ?? 'Зал'

  if (!snap) return <Empty>{live ? 'Загружаем стол…' : 'Подключаемся к столу…'}</Empty>

  const open = snap.status === 'open'
  const t = snap.totals
  const lines = [...snap.lines].sort((a, b) => (a.sentAt ?? Infinity) - (b.sentAt ?? Infinity))
  const nameOf = (pid: string | null | undefined) => snap.personas.find(p => p.id === pid)?.name ?? 'гость'
  const pct = t.tableTotal > 0 ? Math.min(100, Math.round((t.paidTotal / t.tableTotal) * 100)) : 0
  const m = computeMetrics(snap, t, now)
  const tips = (snap.tips ?? []).reduce((a, x) => a + x.amount, 0)
  const toRefund = t.toRefund ?? 0

  const run = async (key: string, action: string, body: object, done?: string) => {
    if (busy) return
    setBusy(key)
    // sessionId защищает от попадания в чужой заказ: uid переиспользуются после закрытия
    const r = await tableAction(id, action, { sessionId: snap.sessionId, ...body })
    setBusy(null)
    if (!r.ok) toast(staffError(r))
    else if (done) toast(done)
    return r
  }

  const askClose = () => {
    const reasons: string[] = []
    if (t.remaining > 0.01) reasons.push(`не оплачено ${fmt(t.remaining)}`)
    const pending = snap.lines.filter(l => l.sent && !l.served && !l.cancelled)
    if (pending.length) reasons.push(`на кухне ещё: ${listNames(pending.map(l => findDish(l.dishId)?.name ?? l.dishId))}`)
    setAsk({ reasons })
  }
  const doClose = async () => {
    const r = await run('close', 'close', { force: (ask?.reasons.length ?? 0) > 0 }, `Стол ${id} закрыт`)
    if (r?.ok) setAsk(null)
  }

  const metrics: [string, string, string, string?][] = [
    [open ? 'Стол открыт' : 'Стол обслужен за', fmtDur(m.tableDur), open ? 'идёт сейчас' : 'итог'],
    ['До первого заказа', fmtDur(m.toFirstOrder), 'сели → кухня'],
    ['Кухня, среднее', fmtDur(m.kitchenAvg), m.kitchenDoneCount ? `по ${m.kitchenDoneCount} поз.` : 'ещё нет подач'],
    ['Подача → оплата', fmtDur(m.payWait), 'ожидание денег'],
    ['Темп выручки', m.revPerHour ? `${fmt(Math.round(m.revPerHour))}/ч` : '—', 'оплачено / время'],
    ['Чек на гостя', m.perGuest ? fmt(Math.round(m.perGuest)) : '—', `счёт / ${snap.personas.length || 1}`],
    ['Чаевые', fmt(tips), 'мимо счёта', '#2E6B47']
  ]

  return (
    <div className="c-fade flex flex-col gap-4">
      <div className="c-card flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4.5">
        <a href="#/hall" className="flex h-10 items-center rounded-xl border border-c-line bg-c-card px-4 text-[15px]">
          ← Зал
        </a>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[24px] font-bold">Стол {id}</span>
            <span
              className={`flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold ${
                open ? 'bg-c-ok-bg text-c-ok-fg' : 'bg-c-chip text-c-soft'
              }`}
            >
              {open ? 'Открыт' : snap.openedAt ? 'Закрыт' : 'Свободен'}
            </span>
            {!live && <span className="text-[12px] font-bold text-c-warn-ink">нет связи</span>}
          </div>
          <div className="mt-0.5 text-[13px] whitespace-nowrap text-c-mute">
            {zone} · официант {waiter}
          </div>
        </div>
        <div className="min-w-55 flex-1">
          <div className="mb-1.5 flex text-[13px]">
            <span className="flex-1 text-c-mute">Оплачено по столу</span>
            <span className="c-num font-bold whitespace-nowrap">
              {fmt(t.paidTotal)} / {fmt(t.tableTotal)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-c-line2">
            <div className="h-full rounded bg-c-ok transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {open && may('close') && (
          <button
            onClick={askClose}
            className={`h-10 rounded-xl border border-c-ink px-4.5 text-[15px] font-bold whitespace-nowrap ${
              t.remaining <= 0.01 ? 'bg-c-ink text-white' : 'bg-c-card'
            }`}
          >
            Закрыть стол
          </button>
        )}
        {!open && snap.openedAt && may('clean') && card && card.cleanedAt == null && (
          <button
            onClick={() => void run('clean', 'clean', {}, `Стол ${id} свободен`)}
            className="h-10 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold text-white"
          >
            Стол убран
          </button>
        )}
      </div>

      {open &&
        groupCalls(snap.calls ?? [], nameOf).map(g => (
          <CallRow
            key={g.personaId}
            group={g}
            now={now}
            canAck={may('ack')}
            busy={busy === `ack-${g.personaId}`}
            onAck={async reply => {
              // У старых столов у гостя могло быть несколько вызовов — снимаем все разом
              for (const callId of g.ids) {
                const r = await run(`ack-${g.personaId}`, 'ack', { callId, ...(reply ? { reply } : {}) })
                if (!r?.ok) return false
              }
              toast(reply ? `Гостю: «${reply}»` : 'Вызов снят')
              return true
            }}
          />
        ))}

      {open && snap.cashIntent && (
        <div className="flex items-center gap-3.5 rounded-2xl border border-c-warn-line bg-c-warn-bg px-4.5 py-3.5">
          <span className="flex-1">
            <span className="block text-[15px] font-bold">{nameOf(snap.cashIntent.personaId)} платит наличными</span>
            <span className="c-num block text-[22px] font-bold">{fmt(snap.cashIntent.amount)}</span>
          </span>
          {may('cash') && (
            <button
              disabled={busy === 'cash'}
              onClick={() =>
                void run(
                  'cash',
                  'cash',
                  { personaId: snap.cashIntent!.personaId, scope: snap.cashIntent!.scope },
                  `Принято наличными · ${fmt(snap.cashIntent!.amount)}`
                )
              }
              className="h-10 rounded-xl bg-c-ink px-4.5 text-[15px] font-bold text-white disabled:opacity-50"
            >
              Принял деньги
            </button>
          )}
        </div>
      )}

      {toRefund > 0.01 && may('refund') && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-c-bad-line bg-c-bad-bg px-4.5 py-3.5">
          <span className="min-w-60 flex-1">
            <span className="block text-[15px] font-bold">Вернуть переплату · {fmt(toRefund)}</span>
            <span className="block text-[13px] text-c-soft">
              Гость заплатил больше, чем получил, — это долг заведения, а не выручка
            </span>
          </span>
          {(['sbp', 'cash'] as const).map(method => (
            <button
              key={method}
              disabled={!!busy}
              onClick={async () => {
                const r = await run('refund', 'refund', { amount: toRefund, method, idemKey: refundKey.current })
                if (r?.ok) {
                  refundKey.current = newIdemKey()
                  toast(`Возвращено ${fmt(Number(r.body.amount ?? toRefund))}`)
                }
              }}
              className={`h-10 rounded-xl px-4 text-[15px] font-bold disabled:opacity-50 ${
                method === 'sbp' ? 'bg-c-ink text-white' : 'border border-c-line bg-c-card'
              }`}
            >
              {method === 'sbp' ? 'На карту' : 'Наличными'}
            </button>
          ))}
        </div>
      )}

      {snap.openedAt && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
          {metrics.map(([l, v, h, c]) => (
            <div key={l} className="c-card p-3.5">
              <div className="text-[12px] text-c-mute">{l}</div>
              <div className="c-num mt-1 text-[20px] font-bold" style={c ? { color: c } : undefined}>
                {v}
              </div>
              <div className="mt-0.5 text-[12px] text-c-mute">{h}</div>
            </div>
          ))}
        </div>
      )}

      {!snap.openedAt ? (
        <Empty>Стол свободен — гостей ещё не было</Empty>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel
            title={`Гости · ${snap.personas.length} из ${snap.seats}`}
            action={
              open && may('addSeat') ? (
                // Гостей больше, чем мест: третий друг пододвинул стул — пусть сядет со своего телефона
                <button
                  disabled={busy === 'seat'}
                  onClick={() => void run('seat', 'addSeat', {}, 'Стул приставлен — гость может сесть')}
                  className="h-8 rounded-lg border border-c-line px-3 text-[13px] font-bold disabled:opacity-50"
                >
                  + место
                </button>
              ) : undefined
            }
          >
            <div className="px-4.5 pb-2">
              {snap.personas.map(p => {
                const pt = t.byPersona.find(x => x.personaId === p.id)
                const own = snap.lines.filter(l => l.personaId === p.id && !l.cancelled && !l.shared)
                const shared = snap.lines.filter(l => l.shared && !l.cancelled && l.sent)
                const items = [...own.map(l => findDish(l.dishId)?.name ?? l.dishId), ...shared.map(l => `доля: ${findDish(l.dishId)?.name ?? l.dishId}`)]
                const total = pt?.total ?? 0
                const paid = pt?.paid ?? 0
                const settled = total > 0 && (pt?.remaining ?? 0) <= 0.01
                return (
                  <div key={p.id} className="border-t border-c-line2 py-3 first:border-t-0">
                    <div className="flex items-center gap-2.5">
                      <Avatar animal={p.animal} size={32} label={p.name} />
                      <span className="flex-1 text-[15px] font-bold">{p.name}</span>
                      <span className="c-num text-[15px] font-bold">{fmt(total)}</span>
                    </div>
                    {items.length > 0 && (
                      <div className="mt-1.5 ml-10.5 text-[13px] leading-normal text-c-mute">{items.join(', ')}</div>
                    )}
                    {(p.allergies ?? []).length > 0 && (
                      <div className="mt-1 ml-10.5 text-[13px] font-bold text-c-bad-ink">
                        аллергия: {(p.allergies ?? []).join(', ')}
                      </div>
                    )}
                    <div
                      className={`mt-1 ml-10.5 text-[13px] font-bold ${settled ? 'text-c-ok-ink' : 'text-c-mute'}`}
                    >
                      {/* Без глагола в прошедшем: род по имени не угадать */}
                      {settled ? '✓ оплачено' : paid > 0 ? `внесено ${fmt(paid)}` : total > 0 ? 'оплаты не было' : 'ещё выбирает'}
                    </div>
                    {/* Сел по ошибке — второй вход, чужое имя: убрать, пока за ним ничего нет.
                        Его доля в общих блюдах уйдёт остальным — он их не ел */}
                    {open &&
                      may('removeGuest') &&
                      snap.personas.length > 1 &&
                      paid === 0 &&
                      !snap.lines.some(l => l.personaId === p.id && l.sent && !l.cancelled) && (
                        <button
                          disabled={busy === `guest-${p.id}`}
                          onClick={() => void run(`guest-${p.id}`, 'removeGuest', { personaId: p.id }, `${p.name} — убран со стола`)}
                          className="mt-1.5 ml-10.5 h-8 rounded-lg border border-c-line px-2.5 text-[13px] disabled:opacity-50"
                        >
                          Убрать гостя — сел по ошибке
                        </button>
                      )}
                  </div>
                )
              })}
            </div>
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel
              title="Заказ · по времени"
              action={
                // Гость попросил официанта, а не телефон — добавить можно и за пустым столом
                may('addLine') ? (
                  <button onClick={() => setAdding(true)} className="h-8 rounded-lg bg-c-ink px-3 text-[13px] font-bold text-white">
                    + Блюдо
                  </button>
                ) : undefined
              }
            >
              {lines.length === 0 && <div className="px-4.5 py-3.5 text-[15px] text-c-mute">Пока ничего не заказано</div>}
              {lines.map(l => (
                <LineRow
                  key={l.uid}
                  line={l}
                  who={l.shared ? 'на всех' : nameOf(l.personaId)}
                  open={open}
                  busy={busy === `line-${l.uid}`}
                  canAct={a => may(a)}
                  onAct={action =>
                    void run(`line-${l.uid}`, action, { uid: l.uid })
                  }
                />
              ))}
            </Panel>

            <Panel title="Оплаты">
              {snap.payments.length === 0 ? (
                <div className="px-4.5 py-3 text-[15px] text-c-mute">Пока никто не платил</div>
              ) : (
                snap.payments.map((p, i) => (
                  <div key={i} className="flex gap-3 border-t border-c-line2 px-4.5 py-2.5 text-[15px] first:border-t-0">
                    <span className="c-num w-11 text-c-mute">{time(p.at)}</span>
                    <span className="flex-1">
                      {[
                        p.personaId ? nameOf(p.personaId) : 'стол',
                        METHOD[p.method ?? 'sbp'] ?? p.method,
                        p.takenByName ? `принял ${p.takenByName}` : null
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="c-num font-bold text-c-ok-ink">{fmt(p.amount)}</span>
                  </div>
                ))
              )}
            </Panel>
          </div>
        </div>
      )}

      {ask && (
        <Confirm
          title={ask.reasons.length ? 'Закрыть стол с оговорками?' : 'Закрыть стол?'}
          body={
            ask.reasons.length
              ? `${ask.reasons.join('; ')}. Это попадёт в журнал смены, а долг — в «Долги и решения».`
              : 'Стол освободится после уборки.'
          }
          ok={ask.reasons.length ? 'Всё равно закрыть' : 'Закрыть стол'}
          danger={ask.reasons.length > 0}
          busy={busy === 'close'}
          onOk={() => void doClose()}
          onCancel={() => setAsk(null)}
        />
      )}
      {adding && <AddDishDrawer tableId={id} snap={snap} onClose={() => setAdding(false)} />}
    </div>
  )
}

function LineRow({
  line,
  who,
  open,
  busy,
  canAct,
  onAct
}: {
  line: ServerLine
  who: string
  open: boolean
  busy: boolean
  canAct: (a: 'start' | 'ready' | 'serve') => boolean
  onAct: (a: 'start' | 'ready' | 'serve') => void
}) {
  const stage = line.sent || line.cancelled ? lineStage(line) : 'draft'
  const s = STAGE[stage]
  const dim = stage === 'cancelled' || stage === 'served'
  const meta = [who, optionsLabel(line.options), line.cancelled ? line.cancelReason : null].filter(Boolean).join(' · ')
  return (
    <div className="grid grid-cols-[44px_minmax(120px,1fr)_120px_80px_auto] items-center gap-2.5 border-b border-c-line2 px-4.5 py-3 text-[15px] last:border-b-0">
      <span className="c-num text-[13px] text-c-mute">{time(line.sentAt)}</span>
      <span className="min-w-0">
        <span className={`block font-bold ${dim ? 'text-c-mute' : ''}`} style={{ textDecoration: stage === 'cancelled' ? 'line-through' : undefined }}>
          {findDish(line.dishId)?.name ?? line.name ?? line.dishId}
          {line.qty > 1 ? ` ×${line.qty}` : ''}
        </span>
        <span className="block truncate text-[12px] text-c-mute">{meta}</span>
      </span>
      <span className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: s.color }}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
        {s.label}
      </span>
      <span className={`c-num text-right ${dim ? 'text-c-mute' : ''}`} style={{ textDecoration: stage === 'cancelled' ? 'line-through' : undefined }}>
        {fmt(line.price * line.qty)}
      </span>
      <span className="flex justify-end">
        {open && s.next && canAct(s.next.action) && (
          <button
            disabled={busy}
            onClick={() => onAct(s.next!.action)}
            className="h-8.5 rounded-[10px] border border-c-ink bg-c-card px-3 text-[13px] font-bold whitespace-nowrap disabled:opacity-50"
          >
            {s.next.label}
          </button>
        )}
      </span>
    </div>
  )
}
