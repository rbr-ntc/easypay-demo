import { useState } from 'react'
import { findDish } from '../data'
import { Avatar } from '../avatars'
import { BottomSheet, PrimaryButton, WarnBanner } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

export function SendSheet() {
  const { ui, patch, me, snap, sendWave } = useStore()
  const [sending, setSending] = useState(false)
  if (!me || !snap) return null

  // Цена берётся ИЗ ПОЗИЦИИ, а не из меню: модификатор (бутылка вместо бокала)
  // и правка прайса меняют её так, что цифра из меню оказывается чужой
  const price = (l: { price: number; qty: number }) => l.price * l.qty
  const unsentMine = snap.lines.filter(l => !l.sent && l.personaId === me.id)
  const alreadySent = snap.lines.filter(l => l.sent)
  const unsentAll = snap.lines.filter(l => !l.sent)
  const unsentOthers = unsentAll.filter(l => l.personaId !== me.id)
  // Кто ещё не отправил свои блюда (реальные гости, не боты)
  const stillChoosing = snap.personas.filter(p => p.id !== me.id && unsentOthers.some(l => l.personaId === p.id))

  // Выбор «моё / за весь стол» имеет смысл, только когда у соседей есть что отправить:
  // иначе оба варианта дают одну и ту же сумму и гость гадает, в чём разница
  const alone = snap.personas.length <= 1 || unsentOthers.length === 0
  const close = () => patch({ sheet: null })
  const scope: 'mine' | 'all' = alone ? 'mine' : ui.sendScope
  const checked = ui.sendChecked
  const gated = scope === 'all' && stillChoosing.length > 0 && !checked

  const send = async () => {
    setSending(true)
    const ok = await sendWave(scope)
    // Отправка не прошла — спиннер «Передаём на кухню…» и переход на «Стол»
    // выглядели бы как успех, а тост об ошибке гость бы уже не связал с ними
    if (!ok) {
      setSending(false)
      return
    }
    setTimeout(() => {
      // Отправили — возвращаемся на «Стол», где у позиций уже видна стадия
      patch({ sheet: null, screen: 'table' })
    }, 1200)
  }

  if (sending) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-base-100/95">
        <span className="loading loading-spinner loading-xl" />
        <div className="text-lg font-semibold">Передаём на кухню…</div>
      </div>
    )
  }

  return (
    <BottomSheet onClose={close}>
      <div className="px-5 pb-[calc(1.625rem+env(safe-area-inset-bottom))]">
        <div className="mb-4 text-2xl font-bold tracking-tight">Отправить заказ на кухню?</div>

        {alone && (
          <div className="card card-border mb-3.5 bg-base-100">
            <div className="card-body p-3.5">
              <div className="font-semibold">Ваш заказ</div>
              <div className="text-xs text-base-content/60">
                {unsentMine.length} поз. · {fmt(unsentMine.reduce((s, l) => s + price(l), 0))}
              </div>
              {snap.personas.length > 1 && (
                <div className="text-xs text-base-content/60">У остальных за столом сейчас нечего отправлять</div>
              )}
            </div>
          </div>
        )}

        {!alone && (
          <div className="mb-3.5 flex flex-col gap-2.5">
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-box border bg-base-100 p-3.5 ${
                scope === 'mine' ? 'border-primary border-2' : 'border-base-300'
              } ${unsentMine.length === 0 ? 'cursor-not-allowed opacity-45' : ''}`}
            >
              <input
                type="radio"
                name="send-scope"
                className="radio radio-primary"
                checked={scope === 'mine'}
                disabled={unsentMine.length === 0}
                onChange={() => patch({ sendScope: 'mine' })}
              />
              <div className="flex-1">
                <div className="font-semibold">Отправить мой заказ</div>
                <div className="text-xs text-base-content/60">
                  {me.name} · {unsentMine.length} поз. · {fmt(unsentMine.reduce((s, l) => s + price(l), 0))}
                </div>
              </div>
            </label>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-box border bg-base-100 p-3.5 ${
                scope === 'all' ? 'border-primary border-2' : 'border-base-300'
              }`}
            >
              <input
                type="radio"
                name="send-scope"
                className="radio radio-primary"
                checked={scope === 'all'}
                onChange={() => patch({ sendScope: 'all' })}
              />
              <div className="flex-1">
                <div className="font-semibold">Отправить за весь стол</div>
                <div className="text-xs text-base-content/60">
                  {unsentAll.length} поз. · {fmt(unsentAll.reduce((s, l) => s + price(l), 0))}
                </div>
              </div>
            </label>
          </div>
        )}

        {scope === 'all' && stillChoosing.length > 0 && (
          <>
            <div className="mb-3.5">
              <WarnBanner>
                <Avatar animal={stillChoosing[0].animal} size={26} label={stillChoosing[0].name} />
                <span className="text-sm leading-snug">
                  <b>{stillChoosing.map(p => p.name).join(', ')}</b> ещё{' '}
                  {stillChoosing.length === 1 ? 'выбирает' : 'выбирают'}. Все точно готовы?
                </span>
              </WarnBanner>
            </div>
            <label className="mb-4 flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-primary"
                checked={checked}
                onChange={() => patch({ sendChecked: !checked })}
              />
              <span>Я всё выбрал(а), отправляем за всех</span>
            </label>
          </>
        )}

        {alreadySent.length > 0 && (
          <div className="mb-3.5 text-xs text-base-content/60">
            Уже на кухне (не отправится повторно): {alreadySent.map(l => findDish(l.dishId)?.name ?? '?').join(', ')}
          </div>
        )}

        <PrimaryButton className="mb-2" onClick={() => void send()} disabled={gated || unsentAll.length === 0}>
          Отправить
        </PrimaryButton>
        <button className="btn btn-ghost btn-block" onClick={close}>
          Ещё подумаю
        </button>
      </div>
    </BottomSheet>
  )
}
