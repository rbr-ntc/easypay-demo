import { fmt } from '../../format'
import { go } from '../route'
import type { CheckRow } from './adminApi'
import { hm, METHOD_LABEL, Row, StatusTag, type CheckStatus } from './parts'

/**
 * Чек целиком: кто что ел, кто как платил и путь стола по времени.
 * Этим отвечают на спор «я не заказывал» и «я же платил» без поднятия логов.
 */

const RATING_LABEL = { good: 'Всё понравилось', ok: 'Нормально', bad: 'Есть замечание' } as const
export function CheckDetail({ check: c, status, onClose }: { check: CheckRow; status: CheckStatus; onClose: () => void }) {
  const byGuest = new Map<string, CheckRow['lines']>()
  for (const l of c.lines) {
    const key = l.shared ? 'Общее' : (l.guest ?? 'Без имени')
    byGuest.set(key, [...(byGuest.get(key) ?? []), l])
  }
  const path = [
    { at: c.openedAt, label: 'Сели за стол' },
    { at: c.firstSentAt ?? null, label: 'Первый заказ ушёл на кухню' },
    { at: c.lastServedAt ?? null, label: 'Последнее блюдо подано' },
    ...(c.payments ?? []).map(p => ({ at: p.at, label: `Оплата ${fmt(p.amount)} · ${METHOD_LABEL[p.method] ?? p.method}` })),
    { at: c.closedAt, label: 'Стол закрыт' }
  ]
    .filter((p): p is { at: number; label: string } => !!p.at)
    .sort((a, b) => a.at - b.at)

  return (
    <aside
      aria-label={`Чек стола ${c.tableId}`}
      // На планшете панель выезжает поверх таблицы, на мониторе стоит рядом
      className="c-card c-fade fixed top-4 right-4 bottom-4 z-30 flex w-[min(380px,calc(100vw-32px))] shrink-0 flex-col overflow-hidden shadow-[0_30px_60px_-20px_rgba(0,0,0,.4)] lg:sticky lg:top-0 lg:right-auto lg:bottom-auto lg:z-auto lg:max-h-[calc(100vh-150px)] lg:w-[380px] lg:shadow-none"
    >
      <div className="flex items-start gap-3 border-b border-c-line2 p-4.5">
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-bold">Стол {c.tableId}</div>
          <div className="c-num text-[13px] text-c-mute">
            № {c.sessionId.slice(0, 6).toUpperCase()} · {hm(c.openedAt)}–{c.closedAt ? hm(c.closedAt) : 'открыт'}
            {c.waiter ? ` · ${c.waiter}` : ''}
          </div>
          <div className="mt-2">
            <StatusTag status={status} />
          </div>
        </div>
        <button onClick={onClose} aria-label="Закрыть чек" className="size-9 rounded-lg text-[20px] text-c-mute hover:bg-c-chip">
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4.5">
        {[...byGuest.entries()].map(([guest, lines]) => (
          <div key={guest} className="mb-4">
            <div className="mb-1 text-[13px] font-bold text-c-mute">{guest}</div>
            {lines.map((l, i) => (
              <div key={i} className={`flex gap-2 py-1 text-[14px] ${l.cancelled ? 'text-c-mute line-through' : ''}`}>
                <span className="flex-1">
                  {l.name}
                  {l.qty > 1 && ` × ${l.qty}`}
                  {Object.values(l.options).length > 0 && <span className="text-c-mute"> · {Object.values(l.options).join(', ')}</span>}
                  {l.cancelled && l.cancelReason && <span className="block text-[12px] no-underline">снято: {l.cancelReason}</span>}
                </span>
                <span className="c-num">{fmt(l.amount)}</span>
              </div>
            ))}
          </div>
        ))}

        <div className="border-t border-c-line2 pt-2">
          <Row label="Счёт" value={fmt(c.total)} strong />
          <Row label="Оплачено" value={fmt(c.paid)} tone="ok" />
          {c.debt > 0.01 && <Row label={c.settled > 0 ? `Долг · решено ${fmt(c.settled)}` : 'Долг'} value={fmt(c.debt)} tone="bad" />}
          {c.overpaid > 0.01 && <Row label="Переплата к возврату" value={fmt(c.overpaid)} tone="bad" />}
          {(c.refunded ?? 0) > 0 && <Row label="Возвращено" value={fmt(c.refunded!)} />}
          {c.cancelledTotal > 0 && <Row label="Снято с кухни" value={fmt(c.cancelledTotal)} />}
          {c.tips > 0 && <Row label="Чаевые (мимо счёта)" value={fmt(c.tips)} />}
        </div>

        {(c.ratings ?? []).length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[13px] font-bold text-c-mute">Оценки гостей</div>
            {c.ratings!.map((r, i) => (
              <div key={i} className={`py-1 text-[14px] ${r.rating === 'bad' ? 'text-c-bad-ink' : ''}`}>
                {RATING_LABEL[r.rating]} · {r.guest ?? 'гость'}
                {r.note && <span className="text-c-mute"> — «{r.note}»</span>}
              </div>
            ))}
          </div>
        )}

        {(c.payments ?? []).length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[13px] font-bold text-c-mute">Платежи</div>
            {c.payments!.map((p, i) => (
              <div key={i} className="flex gap-2 py-1 text-[14px]">
                <span className="c-num w-12 text-c-mute">{hm(p.at)}</span>
                <span className="flex-1 truncate">
                  {p.guest ?? 'гость'} · {METHOD_LABEL[p.method] ?? p.method}
                  {p.takenBy && <span className="text-c-mute"> · принял {p.takenBy}</span>}
                </span>
                <b className="c-num">{fmt(p.amount)}</b>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 text-[13px] font-bold text-c-mute">Путь стола</div>
          <ol className="relative ml-1.5 border-l border-c-line pl-4">
            {path.map((p, i) => (
              <li key={i} className="relative pb-2.5 text-[13px]">
                <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-c-ink" />
                <span className="c-num mr-2 text-c-mute">{hm(p.at)}</span>
                {p.label}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {c.closedAt === null && (
        <div className="border-t border-c-line2 p-3.5">
          <button onClick={() => go({ ws: 'hall', table: c.tableId })} className="h-11 w-full rounded-xl bg-c-ink text-[15px] font-bold text-white">
            Открыть стол в зале
          </button>
        </div>
      )}
    </aside>
  )
}
