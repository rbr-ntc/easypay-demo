import { fmt } from '../format'
import type { HallSummary as Summary } from '@easypay/domain/hall'

/**
 * Сводка смены — правая колонка зала. Выручка «моментом» на лаймовой карточке,
 * остальное строками: это то, что управляющая читает первым и по чему
 * отчитывается владельцу.
 */
function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'alert' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5" style={{ borderTop: '1px solid #123227' }}>
      <div className="min-w-0">
        <div className="text-[14px] font-bold" style={{ color: tone === 'alert' ? '#FF8A63' : '#FAF5EA' }}>
          {label}
        </div>
        {hint && (
          <div className="text-[12px] font-semibold" style={{ color: '#9FB5A8' }}>
            {hint}
          </div>
        )}
      </div>
      <div
        className="ep-sum text-[16px] font-extrabold"
        style={{ color: tone === 'alert' ? '#FF8A63' : '#FAF5EA' }}
      >
        {value}
      </div>
    </div>
  )
}

export function HallSummary({ summary }: { summary: Summary }) {
  const load = summary.tables ? Math.round((summary.occupied / summary.tables) * 100) : 0
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[20px] p-4.5" style={{ background: '#D5F94E', color: '#062119' }}>
        <div className="ep-brow" style={{ color: '#2C4A3C' }}>
          Смена сейчас
        </div>
        <div className="ep-moment ep-sum mt-1 text-[44px] leading-none">{fmt(summary.shiftRevenue)}</div>
        <div className="mt-1 text-[13px] font-semibold" style={{ color: '#2C4A3C' }}>
          закрыто {fmt(summary.closedRevenue)} · средний чек{' '}
          {summary.avgCheck ? fmt(summary.avgCheck) : '—'}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Tile label="Занято столов" value={`${summary.occupied} / ${summary.tables}`} hint={`загрузка ${load}%`} />
          <Tile label="Гостей сейчас" value={String(summary.guests)} hint={`посадка ${summary.seatsTotal} мест`} />
          <Tile label="В работе" value={fmt(summary.openBalance)} hint="остаток по открытым" />
          <Tile label="На кухне" value={String(summary.kitchenPending)} hint="позиций готовится" />
        </div>
      </div>

      {(summary.debt > 0 || summary.overpaid > 0 || summary.writtenOff > 0 || summary.attention > 0) && (
        <div className="rounded-[20px] px-4.5 pt-4 pb-1.5" style={{ background: '#0C2C21' }}>
          <div className="ep-brow mb-1" style={{ color: '#9FB5A8' }}>
            Требует решения
          </div>
          {summary.attention > 0 && (
            <Row label="Столов с просрочкой" value={String(summary.attention)} tone="alert" />
          )}
          {summary.debt > 0 && (
            <Row label="Ушли не заплатив" value={fmt(summary.debt)} hint="столы закрыты с долгом" tone="alert" />
          )}
          {summary.overpaid > 0 && (
            <Row label="Вернуть гостям" value={fmt(summary.overpaid)} hint="переплата" tone="alert" />
          )}
          {summary.writtenOff > 0 && (
            <Row
              label="Списано с кухни"
              value={fmt(summary.writtenOff)}
              hint="еду не отдали — это не долг гостя"
            />
          )}
          {summary.tips > 0 && <Row label="Чаевые" value={fmt(summary.tips)} hint="официантам, мимо счёта" />}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-field px-3 py-2.5" style={{ background: 'rgba(6,33,25,.1)' }}>
      <div className="text-[12px] font-bold" style={{ color: '#2C4A3C' }}>
        {label}
      </div>
      <div className="ep-sum text-[20px] font-extrabold">{value}</div>
      <div className="text-[11px] font-semibold" style={{ color: '#3E5A4A' }}>
        {hint}
      </div>
    </div>
  )
}
