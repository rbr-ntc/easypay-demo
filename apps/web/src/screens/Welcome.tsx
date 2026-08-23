import { HALL_LABEL, RESTAURANT } from '../data'
import { Avatar } from '../avatars'
import { PrimaryButton, Mono } from '../ui'
import { useStore } from '../store'
import { tableId } from '../api'

export function Welcome() {
  const { patch, me, snap, forgetMe } = useStore()
  // Гостей показываем только у открытого стола: у закрытого список уже неактуален
  const personas = snap?.status === 'open' ? snap.personas : []

  return (
    <div className="ep-screen bg-base-100">
      <div className="ep-scroll px-6 pt-4 pb-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="text-xl font-bold tracking-tight">{RESTAURANT}</div>
          <div role="tablist" className="tabs tabs-box tabs-sm">
            <button role="tab" className="tab tab-active">
              RU
            </button>
            <button role="tab" className="tab">
              EN
            </button>
          </div>
        </div>

        <Mono className="mb-1.5">Ваш стол</Mono>
        <div className="mb-4 text-5xl leading-none font-light tracking-tighter">
          Стол №{tableId}
          <br />
          <span className="text-3xl text-base-content/60">{HALL_LABEL}</span>
        </div>

        {personas.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <div className="avatar-group -space-x-2">
              {personas.slice(0, 5).map(p => (
                <div key={p.id} className="avatar">
                  <Avatar animal={p.animal} size={28} label={p.name} />
                </div>
              ))}
            </div>
            <span className="text-sm text-base-content/60">
              За столом: {personas.map(p => p.name).join(', ')}
            </span>
          </div>
        )}

        {/* Место под фотографию зала: в демо её нет, поэтому skeleton честно
            говорит «здесь будет картинка», а не притворяется дизайном */}
        <div className="mb-5 flex h-48 items-center justify-center rounded-box bg-base-200 text-sm text-base-content/60">
          Фото зала · {HALL_LABEL}
        </div>

        {me ? (
          <div className="mb-2">
            <div className="flex items-center gap-3">
              <Avatar animal={me.animal} size={44} label={me.name} />
              <div className="text-2xl font-medium tracking-tight">С возвращением, {me.name}!</div>
            </div>
            <button className="link link-hover mt-1.5 text-sm text-base-content/60" onClick={forgetMe}>
              Я другой гость — начать со своим именем
            </button>
          </div>
        ) : (
          <div className="mb-2 text-2xl font-medium tracking-tight">Добро пожаловать!</div>
        )}

        <p className="mb-4 text-base leading-relaxed text-base-content/70">
          Закажите и оплатите прямо со своего телефона — быстро и без очереди.
        </p>

        <div role="alert" className="alert alert-info alert-soft text-sm">
          <span>
            Можно заказать за весь стол отсюда. А если каждый хочет заказать сам — пусть отсканирует этот же QR со
            своего телефона.
          </span>
        </div>
      </div>

      <div className="border-t border-base-300 px-5 pt-3.5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <PrimaryButton onClick={() => patch({ screen: 'menu' })}>
          {me ? 'Продолжить заказ' : 'Открыть меню'}
        </PrimaryButton>
        <p className="mt-3 text-center text-xs leading-snug text-base-content/60">
          Продолжая, вы соглашаетесь на обработку данных по <span className="link">152-ФЗ</span>
        </p>
      </div>
    </div>
  )
}
