import QRCode from 'react-qr-code'
import { HALL_LABEL, NAVY, RESTAURANT } from './data'
import { tableId } from './api'

// «Тейбл-тент»: страница со стойки стола. Показываешь с ноутбука —
// клиент сканирует настоящим телефоном и попадает в гостевой поток.
export function QrTent() {
  const url = window.location.origin + window.location.pathname + window.location.search
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
          <QRCode value={url} size={220} fgColor={NAVY} />
        </div>

        <div style={{ fontWeight: 300, fontSize: 34, letterSpacing: '-1.2px', margin: '22px 0 4px' }}>Стол №{tableId}</div>
        <div style={{ fontSize: 15, color: 'var(--ep-muted)', marginBottom: 18 }}>{HALL_LABEL}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ep-text-2)' }}>
          Наведите камеру телефона, чтобы посмотреть меню, заказать и оплатить — без установки приложения.
        </div>
        <a href="#/" style={{ display: 'inline-block', marginTop: 18, fontSize: 12.5, color: 'var(--ep-muted)' }}>
          открыть гостевой экран здесь →
        </a>
      </div>
    </div>
  )
}
