import QRCode from 'react-qr-code'
import { HALL_LABEL, RESTAURANT } from './data'
import { HALL } from './hallConfig'
import { tableId } from './api'

function tableUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(id)}`
}

// QR печатают на бумаге, а не смотрят с экрана: код обязан остаться чёрным
// на белом в любой теме, иначе в тёмной он станет нечитаемым для камеры
const QR_FG = '#000000'

// «Тейбл-тент»: страница со стойки стола. Показываешь с ноутбука —
// клиент сканирует настоящим телефоном и попадает в гостевой поток.
function SingleTent({ id }: { id: string }) {
  return (
    <div className="ep-forest flex h-full items-center justify-center p-6">
      <div className="card max-w-md shadow-2xl" style={{ background: '#FAF5EA', color: '#062119' }}>
        <div className="card-body items-center px-12 py-11 text-center">
          <div className="inline-flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-field bg-primary font-bold text-primary-content">
              e
            </div>
            <span className="text-lg font-bold tracking-tight">EasyPay</span>
          </div>
          <div className="text-sm text-muted">{RESTAURANT}</div>

          <div className="my-3 inline-block rounded-box border border-base-300 bg-white p-3">
            <QRCode value={tableUrl(id)} size={220} fgColor={QR_FG} />
          </div>

          <div className="ep-moment text-[62px] leading-none">Стол №{id}</div>
          <div className="text-muted">{HALL_LABEL}</div>
          <p className="leading-relaxed text-muted">
            Наведите камеру телефона, чтобы посмотреть меню, заказать и оплатить — без установки приложения.
          </p>
          <a className="link link-hover text-xs text-muted-soft" href={`?t=${encodeURIComponent(id)}`}>
            открыть гостевой экран здесь →
          </a>
        </div>
      </div>
    </div>
  )
}

/** Лист тейбл-тентов на все столы зала: распечатать и расставить. */
function AllTents() {
  return (
    <div className="ep-forest min-h-full px-6 pt-6 pb-10">
      <div className="text-2xl font-bold tracking-tight">QR-коды столов · {RESTAURANT}</div>
      <p className="mb-5 text-sm text-[#9FB5A8]">
        Каждый код ведёт на свой стол. Распечатайте лист и расставьте тенты — гость сканирует свой стол и сразу
        попадает в его заказ.
      </p>

      {HALL.zones.map(zone => (
        <div key={zone.id} className="mb-6">
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-[#9FB5A8]">{zone.name}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11.875rem,1fr))] gap-3.5">
            {zone.tables.map(t => (
              <div key={t.id} className="card rounded-[20px]" style={{ background: '#0C2C21' }}>
                <div className="card-body items-center p-4 text-center">
                  <div className="rounded-field bg-white p-2">
                    <QRCode
                      value={tableUrl(t.id)}
                      size={130}
                      fgColor={QR_FG}
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                  </div>
                  <div className="text-xl font-extrabold tracking-tight" style={{ color: '#FAF5EA' }}>Стол №{t.id}</div>
                  <div className="text-xs text-[#9FB5A8]">
                    {zone.name} · {t.seats} мест
                  </div>
                  <a
                    className="link link-hover text-xs text-[#9FB5A8]"
                    href={`?t=${encodeURIComponent(t.id)}#/qr`}
                  >
                    тент крупно →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <a className="inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-bold" style={{ border: '1px solid rgba(250,245,234,.22)', color: '#FAF5EA' }} href="#/hall">
        ← в зал
      </a>
    </div>
  )
}

export function QrTent() {
  return tableId ? <SingleTent id={tableId} /> : <AllTents />
}
