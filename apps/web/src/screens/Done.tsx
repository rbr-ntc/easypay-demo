import { optionsLabel, WAITER_NAME } from '../data'
import { SharedIcon } from '../avatars'
import { Card, GhostButton, PrimaryButton, StickyFooter, WarnBanner } from '../ui'
import { useStore, tipAmount } from '../store'
import { fmt } from '../format'

const CHIPS = ['Вкусно', 'Быстро', 'Уютно']

export function Done() {
  const { ui, patch, snap, totals } = useStore()
  const tip = tipAmount(ui)
  const receipt = ui.lastReceipt
  const remaining = totals.remaining

  return (
    <div className="ep-screen">
      <div className="ep-scroll px-5 pt-7 pb-5">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="ep-pop mb-4 flex size-19 items-center justify-center rounded-full bg-success text-4xl text-success-content">
            ✓
          </div>
          <div className="text-lg font-light text-base-content/70">Оплачено</div>
          <div className="text-5xl leading-none font-light tracking-tight">{fmt(ui.lastPaid)}</div>
          {tip > 0 && (
            <div className="badge badge-accent badge-soft mt-3">
              + {fmt(tip)} чаевых официанту {snap?.waiter?.name ?? WAITER_NAME}
            </div>
          )}
        </div>

        {remaining > 0.01 && (
          <div className="mb-3.5">
            <WarnBanner>
              <SharedIcon size={26} />
              <span className="flex-1 text-sm leading-snug">
                Ваша часть оплачена. По столу осталось <b>{fmt(remaining)}</b>
              </span>
            </WarnBanner>
          </div>
        )}

        <Card className="mb-4">
          <div className="card-body p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-field bg-success/20 text-lg">
                🧾
              </div>
              <div className="flex-1">
                <div className="font-semibold">Чек {receipt ? `№ ${receipt.no}` : 'заказа'}</div>
                <div className="text-xs text-base-content/60">
                  {receipt
                    ? `${new Date(receipt.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · стол №${receipt.table}`
                    : 'Сохраните номер операции'}
                </div>
              </div>
            </div>

            {/* Раньше здесь было «фискальный чек отправлен» и две кнопки, которые
                ничего не делали. Теперь показываем то, что действительно есть:
                за что именно списаны деньги. Фискальный чек придёт из кассы. */}
            {receipt && receipt.lines.length > 0 && (
              <div className="mt-3 border-t border-base-200 pt-3">
                {receipt.lines.map((l, i) => (
                  <div key={`${l.name}-${i}`} className="flex justify-between gap-3 py-1 text-sm">
                    <span className="text-base-content/70">
                      {l.name}
                      {l.qty > 1 ? ` ×${l.qty}` : ''}
                      {l.shared ? ' · общее' : ''}
                      {optionsLabel(l.options) && (
                        <span className="text-base-content/60"> · {optionsLabel(l.options)}</span>
                      )}
                    </span>
                    <span className="tabular-nums">{fmt(l.shared && l.share !== null ? l.share : l.price * l.qty)}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-t border-base-200 pt-2 font-semibold">
                  <span>Списано</span>
                  <span className="tabular-nums">{fmt(receipt.amount)}</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="card-body items-center p-4">
            <div className="font-semibold">Как всё прошло?</div>
            <div className="rating rating-lg">
              {[1, 2, 3, 4, 5].map(n => (
                <input
                  key={n}
                  type="radio"
                  name="visit-rating"
                  className="mask mask-star-2 bg-warning"
                  aria-label={`${n} из 5`}
                  checked={n === ui.rating}
                  onChange={() => patch({ rating: n })}
                />
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {CHIPS.map(ch => (
                <button key={ch} className="btn btn-sm">
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <StickyFooter>
        <div className="flex gap-2.5">
          <GhostButton className="flex-1" onClick={() => patch({ screen: 'menu' })}>
            Заказать ещё
          </GhostButton>
          <PrimaryButton className="flex-1" onClick={() => patch({ screen: 'welcome' })}>
            Готово
          </PrimaryButton>
        </div>
      </StickyFooter>
    </div>
  )
}
