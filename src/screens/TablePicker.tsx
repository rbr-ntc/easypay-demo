import { HALL, seatsOfTable } from '../hallConfig'
import { requestedTable } from '../api'
import { Mono } from '../ui'

/**
 * Экран «какой у вас стол». Показывается, когда в адресе нет ?t=… или стол неизвестен:
 * в жизни гость приходит по QR со своего стола, а для демо стол можно выбрать руками.
 */
export function TablePicker() {
  const unknown = requestedTable && seatsOfTable(requestedTable) === null

  return (
    <div className="ep-screen" style={{ background: 'var(--ep-surface)' }}>
      <div className="ep-scroll" style={{ padding: '22px 24px 28px' }}>
        <div style={{ fontWeight: 700, fontSize: 19, letterSpacing: '-0.4px', marginBottom: 20 }}>{HALL.restaurant}</div>

        {unknown ? (
          <div
            style={{
              display: 'flex',
              gap: 11,
              background: 'var(--ep-warn-bg)',
              border: '1px solid var(--ep-warn-border)',
              borderRadius: 'var(--ep-r-card)',
              padding: '14px 16px',
              marginBottom: 20
            }}
          >
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ep-warn)' }}>
              Стол <b>№{requestedTable}</b> не найден в этом зале. Отсканируйте QR со своего стола или выберите
              стол ниже.
            </span>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 300, fontSize: 30, lineHeight: 1.15, letterSpacing: '-1px', marginBottom: 10 }}>
              За каким вы столом?
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--ep-text-2)', marginBottom: 22 }}>
              Обычно меню открывается само — достаточно навести камеру на QR-код, который стоит у вас на столе.
              Здесь, в демо, стол можно выбрать руками.
            </div>
          </>
        )}

        {HALL.zones.map(zone => (
          <div key={zone.id} style={{ marginBottom: 22 }}>
            <Mono style={{ marginBottom: 10 }}>{zone.name}</Mono>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
              {zone.tables.map(t => (
                <a
                  key={t.id}
                  href={`?t=${encodeURIComponent(t.id)}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    padding: '16px 8px',
                    borderRadius: 'var(--ep-r-card)',
                    border: '1px solid var(--ep-border)',
                    background: 'var(--ep-surface-2)',
                    color: 'var(--ep-ink)',
                    textDecoration: 'none'
                  }}
                >
                  <span style={{ fontWeight: 680, fontSize: 20, letterSpacing: '-0.5px' }}>№{t.id}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ep-muted)' }}>{t.seats} мест</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
