import { useEffect, useState } from 'react'
import { HALL, seatsOfTable } from '../hallConfig'
import { requestedTable } from '../api'
import { ScanQr } from './ScanQr'

/** Нужна ли подпись стола из QR: тогда выбирать стол руками бессмысленно — не посадит. */
function useQrRequired(): boolean | null {
  const [required, setRequired] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/qr/required')
      .then(r => r.json())
      .then(b => live && setRequired(!!b.required))
      .catch(() => live && setRequired(false))
    return () => {
      live = false
    }
  }, [])
  return required
}

/**
 * Экран «какой у вас стол». Показывается, когда в адресе нет ?t=… или стол неизвестен:
 * в жизни гость приходит по QR со своего стола, а для демо стол можно выбрать руками.
 */
export function TablePicker() {
  const unknown = requestedTable && seatsOfTable(requestedTable) === null
  const qrRequired = useQrRequired()
  if (qrRequired === null) return null
  if (qrRequired) {
    return (
      <div className="ep-guest g4 relative h-dvh">
        <ScanQr />
      </div>
    )
  }

  return (
    <div className="ep-screen ep-forest">
      {/* На мониторе и планшете — колонкой по центру, как весь гостевой поток,
          а не прижатым к левому краю списком с пустотой на 1000 px справа */}
      <div className="ep-scroll mx-auto w-full max-w-[560px] px-6 pt-5 pb-7 md:pt-12">
        <div className="mb-5 text-xl font-extrabold tracking-tight">{HALL.restaurant}</div>

        {unknown ? (
          <div role="alert" className="alert alert-warning alert-soft mb-5">
            <span>
              Стол <b>№{requestedTable}</b> не найден в этом зале. Отсканируйте QR со своего стола или выберите стол
              ниже.
            </span>
          </div>
        ) : (
          <>
            <div className="ep-moment mb-2.5 text-[38px] leading-tight">За каким вы столом?</div>
            <p className="mb-5 leading-relaxed" style={{ color: '#9FB5A8' }}>
              Обычно меню открывается само — достаточно навести камеру на QR-код, который стоит у вас на столе.
              Здесь, в демо, стол можно выбрать руками.
            </p>
          </>
        )}

        {HALL.zones.map(zone => (
          <div key={zone.id} className="mb-5">
            <div className="ep-brow mb-2.5" style={{ color: '#9FB5A8' }}>{zone.name}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2.5">
              {zone.tables.map(t => (
                <a
                  key={t.id}
                  href={`?t=${encodeURIComponent(t.id)}`}
                  className="flex h-18 flex-col items-center justify-center gap-0.5 rounded-[18px]"
                  style={{ background: '#0C2C21', color: '#FAF5EA' }}
                >
                  <span className="text-xl font-extrabold tracking-tight">№{t.id}</span>
                  <span className="text-xs font-semibold" style={{ color: '#9FB5A8' }}>
                    {t.seats} мест
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
