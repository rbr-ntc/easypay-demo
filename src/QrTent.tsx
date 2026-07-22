import QRCode from 'react-qr-code'
import { HALL_LABEL, NAVY, RESTAURANT } from './data'
import { tableId } from './api'

// «Тейбл-тент»: страница со стойки стола. Показываешь с ноутбука —
// клиент сканирует настоящим телефоном и попадает в гостевой поток.
export function QrTent() {
  const url = window.location.origin + window.location.pathname + window.location.search
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: NAVY, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 32, padding: '44px 48px', textAlign: 'center', maxWidth: 420, boxShadow: '0 30px 80px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
            e
          </div>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.4px' }}>EasyPay</span>
        </div>
        <div style={{ fontSize: 13, color: '#8A8A92', marginBottom: 22 }}>{RESTAURANT}</div>

        <div style={{ background: '#fff', padding: 12, display: 'inline-block', borderRadius: 16, border: '1px solid #ECECEF' }}>
          <QRCode value={url} size={220} fgColor={NAVY} />
        </div>

        <div style={{ fontWeight: 300, fontSize: 34, letterSpacing: '-1.2px', margin: '22px 0 4px' }}>Стол №{tableId}</div>
        <div style={{ fontSize: 15, color: '#7A7A84', marginBottom: 18 }}>{HALL_LABEL}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#42424C' }}>
          Наведите камеру телефона, чтобы посмотреть меню, заказать и оплатить — без установки приложения.
        </div>
        <a href="#/" style={{ display: 'inline-block', marginTop: 18, fontSize: 12.5, color: '#9A9AA4' }}>
          открыть гостевой экран здесь →
        </a>
      </div>
    </div>
  )
}
