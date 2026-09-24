import { HALL_LABEL, RESTAURANT } from '../data'
import { tableId } from '../api'
import { useStore } from '../store'
import { listNames, plural } from '../format'
import { artSet } from '../guest/showcase'
import { AvatarStack, Slideshow } from '../guest/parts'

/**
 * Вход по QR. Показывается только тому, кто за этим столом ещё никто:
 * вернувшийся гость попадает сразу в меню (см. стартовый экран в store).
 *
 * Регистрации нет и не будет — это сказано прямо под кнопкой, потому что
 * первый вопрос человека с QR в руке: «мне что, приложение ставить?».
 */
export function Welcome() {
  const { patch, snap } = useStore()
  const others = snap?.status === 'open' ? snap.personas : []
  // Гость без имени получает заглушку без списка: имён нет, но число есть
  const occupied = snap?.status === 'open' ? (snap.occupied ?? others.length) : 0

  return (
    <div className="g-anim-fade absolute inset-0 overflow-hidden">
      <Slideshow images={artSet('welcome')} />
      <div className="g-photo-fade absolute inset-0" />

      <div className="absolute right-6 bottom-[calc(2.5rem+env(safe-area-inset-bottom))] left-6 text-center text-white">
        <div className="text-[13px] text-white/85">добро пожаловать</div>
        <h1 className="g-serif mt-2 text-[44px] text-balance">{RESTAURANT}</h1>
        <div className="mt-3.5 text-[17px]">
          стол {tableId} · {HALL_LABEL.toLowerCase()}
        </div>

        {others.length === 0 && occupied > 0 && (
          <div
            className="mt-6 inline-flex items-center rounded-[28px] px-4 py-2.5 text-[15px] text-g-fg"
            style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.14)' }}
          >
            За столом уже {occupied} {plural(occupied, 'гость', 'гостя', 'гостей')}
          </div>
        )}
        {others.length > 0 && (
          <div
            className="mt-6 inline-flex items-center gap-3 rounded-[28px] py-2 pr-4 pl-2"
            style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.14)' }}
          >
            <AvatarStack personas={others} size={36} />
            <span className="text-[15px] text-g-fg">
              {listNames(others.map(p => p.name))} уже за столом
            </span>
          </div>
        )}

        <button
          onClick={() => patch({ screen: 'menu' })}
          className="g-cta mt-7 h-15 w-full rounded-full text-[17px]"
        >
          Открыть меню
        </button>
        <div className="mt-3.5 text-[13px] text-g-mute">без регистрации и приложения · платите в конце</div>
      </div>
    </div>
  )
}
