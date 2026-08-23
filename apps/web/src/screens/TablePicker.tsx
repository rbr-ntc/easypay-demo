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
    <div className="ep-screen bg-base-100">
      <div className="ep-scroll px-6 pt-5 pb-7">
        <div className="mb-5 text-xl font-bold tracking-tight">{HALL.restaurant}</div>

        {unknown ? (
          <div role="alert" className="alert alert-warning alert-soft mb-5">
            <span>
              Стол <b>№{requestedTable}</b> не найден в этом зале. Отсканируйте QR со своего стола или выберите стол
              ниже.
            </span>
          </div>
        ) : (
          <>
            <div className="mb-2.5 text-3xl leading-tight font-light tracking-tight">За каким вы столом?</div>
            <p className="mb-5 leading-relaxed text-base-content/70">
              Обычно меню открывается само — достаточно навести камеру на QR-код, который стоит у вас на столе.
              Здесь, в демо, стол можно выбрать руками.
            </p>
          </>
        )}

        {HALL.zones.map(zone => (
          <div key={zone.id} className="mb-5">
            <Mono className="mb-2.5">{zone.name}</Mono>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2.5">
              {zone.tables.map(t => (
                <a key={t.id} href={`?t=${encodeURIComponent(t.id)}`} className="btn h-auto flex-col gap-0.5 py-4">
                  <span className="text-xl font-bold tracking-tight">№{t.id}</span>
                  <span className="text-xs font-normal text-base-content/60">{t.seats} мест</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
