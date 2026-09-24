import { useState } from 'react'
import { TABLE_STATUS, tableAlerts, tableStatus } from '@easypay/domain/hall'
import type { HallCard } from '@easypay/domain/hall'
import { ownsTable } from '@easypay/domain/roles'
import { useStore } from '../store'
import { fmt, plural } from '../format'
import { fmtDur } from '../waiter/duration'
import { useCab } from './Shell'
import { Chip, Empty } from './ui'
import { tableAction, staffError } from './staffApi'

/**
 * Зал: план столов с живыми статусами. Полоса сверху карточки — цвет
 * состояния: зовут — красный, внимание — янтарь, оплачен — зелёный,
 * гости — тёмный, свободен — серый. Клик — стол целиком.
 */

type Card = HallCard & { waiterId?: string | null; waiterName?: string | null }

interface Look {
  color: string
  state: string
  alert: string
  alertColor: string
}

const C = { call: '#B03A1E', warn: '#C98A1B', paid: '#2E8A55', busy: '#1B1A17', free: '#D8D3CA' }

export function lookOf(card: Card, now: number): Look {
  const status = tableStatus(card, now)
  const alerts = tableAlerts(card, now)
  if (status === TABLE_STATUS.FREE) return { color: C.free, state: 'Свободен', alert: '', alertColor: '' }
  if (status === TABLE_STATUS.DIRTY) return { color: C.warn, state: 'Закрыт — нужно убрать', alert: 'убрать', alertColor: C.warn }

  const guests = `${card.guests} ${plural(card.guests, 'гость', 'гостя', 'гостей')}`
  const dur = card.openedAt ? fmtDur(now - card.openedAt) : ''
  const tail = [guests, dur].filter(Boolean).join(' · ')

  if (card.call) return { color: C.call, state: `Зовут официанта · ${tail}`, alert: 'зовут', alertColor: C.call }
  if (card.cashIntent) return { color: C.warn, state: `Наличные в пути · ${tail}`, alert: '₽ в пути', alertColor: C.warn }
  if (status === TABLE_STATUS.PAID) return { color: C.paid, state: `Оплачен, гости сидят · ${tail}`, alert: '', alertColor: '' }
  const hot = alerts.find(a => a.severity === 'danger' || a.severity === 'warn')
  if (hot) return { color: C.warn, state: `${hot.label} · ${tail}`, alert: 'внимание', alertColor: '#9A6A0B' }
  return { color: C.busy, state: `Гости за столом · ${tail}`, alert: '', alertColor: '' }
}

export function HallPage() {
  const { staff, toast } = useStore()
  const { hall, now } = useCab()
  const [zone, setZone] = useState('all')
  const [onlyMine, setOnlyMine] = useState(staff?.role === 'waiter')

  if (!hall) return <Empty>Загружаем зал…</Empty>

  const mine = (id: string) => ownsTable(staff, id)
  const hasOwn = (staff?.tables ?? []).length > 0
  const cards = (hall.tables as Card[]).filter(
    c => (zone === 'all' || c.zoneId === zone) && (!onlyMine || !hasOwn || mine(c.id))
  )

  const clean = async (id: string) => {
    const r = await tableAction(id, 'clean')
    toast(r.ok ? `Стол ${id} свободен` : staffError(r))
  }

  return (
    <div className="c-fade flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={zone === 'all'} onClick={() => setZone('all')}>
          Все
        </Chip>
        {hall.zones.map(z => (
          <Chip key={z.id} on={zone === z.id} onClick={() => setZone(z.id)}>
            {z.name}
          </Chip>
        ))}
        {hasOwn && (
          <Chip on={onlyMine} onClick={() => setOnlyMine(v => !v)}>
            Мои столы
          </Chip>
        )}
        <span className="flex-1" />
        {[
          [C.busy, 'гости'],
          [C.paid, 'оплачен'],
          [C.warn, 'внимание'],
          [C.call, 'зовут']
        ].map(([c, t]) => (
          <span key={t} className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-c-mute">
            <span className="size-2.5 rounded-[3px]" style={{ background: c }} />
            {t}
          </span>
        ))}
        <a
          href="#/qr"
          className="flex h-9 items-center rounded-[10px] border border-c-line bg-c-card px-3.5 text-[13px] whitespace-nowrap"
        >
          Печать QR-тентов
        </a>
      </div>

      {cards.length === 0 ? (
        <Empty>{onlyMine ? 'Ваших столов в этой зоне нет' : 'Столов нет'}</Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          {cards.map(card => {
            const l = lookOf(card, now)
            const status = tableStatus(card, now)
            return (
              <div key={card.id} className="relative">
                <a
                  href={`#/hall/${encodeURIComponent(card.id)}`}
                  className="flex min-h-31 flex-col gap-1.5 rounded-2xl border border-c-line bg-c-card p-3.5"
                  style={{ borderTop: `4px solid ${l.color}` }}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-[22px] font-bold">{card.id}</span>
                    <span className="text-[12px] text-c-mute">
                      {card.seats} {plural(card.seats, 'место', 'места', 'мест')}
                    </span>
                    <span className="flex-1" />
                    {l.alert && (
                      <span className="text-[12px] font-bold" style={{ color: l.alertColor }}>
                        {l.alert}
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] text-c-mute">{l.state}</span>
                  <span className="flex-1" />
                  <span className="flex items-baseline gap-2 text-[13px]">
                    <span className="flex-1 truncate text-c-mute">{card.waiterName ?? 'не закреплён'}</span>
                    {card.status === 'open' && card.tableTotal > 0 && (
                      <span className="c-num font-bold">{fmt(card.tableTotal)}</span>
                    )}
                  </span>
                </a>
                {/* Убрать — прямо с карточки: сажать гостей за грязный стол нельзя */}
                {status === TABLE_STATUS.DIRTY && (
                  <button
                    onClick={() => void clean(card.id)}
                    className="absolute right-3 bottom-3 h-8 rounded-lg bg-c-ink px-3 text-[13px] font-bold text-white"
                  >
                    Убран
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
