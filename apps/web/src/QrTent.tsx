import QRCode from 'react-qr-code'
import { HALL_LABEL, NAVY, RESTAURANT } from './data'
import { HALL } from './hallConfig'
import { tableId } from './api'

function tableUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(id)}`
}

// «Тейбл-тент»: страница со стойки стола. Показываешь с ноутбука —
// клиент сканирует настоящим телефоном и попадает в гостевой поток.
function SingleTent({ id }: { id: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: NAVY, padding: 24 }}>
      <div style={{ background: 'var(--ep-surface)', borderRadius: 32, padding: '44px 48px', textAlign: 'center', maxWidth: 420, boxShadow: '0 30px 80px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 'var(--ep-r-xs)', background: NAVY, color: 'var(--ep-on-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
            e
          </div>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.4px' }}>EasyPay</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ep-muted)', marginBottom: 22 }}>{RESTAURANT}</div>

        <div style={{ background: 'var(--ep-surface)', padding: 12, display: 'inline-block', borderRadius: 'var(--ep-r-card)', border: '1px solid var(--ep-border)' }}>
          <QRCode value={tableUrl(id)} size={220} fgColor={NAVY} />
        </div>

        <div style={{ fontWeight: 300, fontSize: 34, letterSpacing: '-1.2px', margin: '22px 0 4px' }}>Стол №{id}</div>
        <div style={{ fontSize: 15, color: 'var(--ep-muted)', marginBottom: 18 }}>{HALL_LABEL}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ep-text-2)' }}>
          Наведите камеру телефона, чтобы посмотреть меню, заказать и оплатить — без установки приложения.
        </div>
        <a href={`?t=${encodeURIComponent(id)}`} style={{ display: 'inline-block', marginTop: 18, fontSize: 12.5, color: 'var(--ep-muted)' }}>
          открыть гостевой экран здесь →
        </a>
      </div>
    </div>
  )
}

/** Лист тейбл-тентов на все столы зала: распечатать и расставить. */
function AllTents() {
  return (
    <div style={{ minHeight: '100%', background: 'var(--ep-page)', padding: '26px 24px 40px' }}>
      <div style={{ fontWeight: 700, fontSize: 21, letterSpacing: '-0.5px', marginBottom: 4 }}>QR-коды столов · {RESTAURANT}</div>
      <div style={{ fontSize: 13.5, color: 'var(--ep-muted)', marginBottom: 22 }}>
        Каждый код ведёт на свой стол. Распечатайте лист и расставьте тенты — гость сканирует свой стол и сразу
        попадает в его заказ.
      </div>

      {HALL.zones.map(zone => (
        <div key={zone.id} style={{ marginBottom: 26 }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--ep-muted)', marginBottom: 12 }}>
            {zone.name}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
            {zone.tables.map(t => (
              <div
                key={t.id}
                style={{ background: 'var(--ep-surface)', border: '1px solid var(--ep-border)', borderRadius: 'var(--ep-r-card)', padding: 16, textAlign: 'center' }}
              >
                <QRCode value={tableUrl(t.id)} size={130} fgColor={NAVY} style={{ maxWidth: '100%', height: 'auto' }} />
                <div style={{ fontWeight: 680, fontSize: 20, letterSpacing: '-0.5px', marginTop: 12 }}>Стол №{t.id}</div>
                <div style={{ fontSize: 12, color: 'var(--ep-muted)' }}>
                  {zone.name} · {t.seats} мест
                </div>
                <a href={`?t=${encodeURIComponent(t.id)}#/qr`} style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--ep-muted)' }}>
                  тент крупно →
                </a>
              </div>
            ))}
          </div>
        </div>
      ))}

      <a href="#/hall" style={{ fontSize: 13, color: 'var(--ep-muted)' }}>
        ← в зал
      </a>
    </div>
  )
}

export function QrTent() {
  return tableId ? <SingleTent id={tableId} /> : <AllTents />
}
