import { useState } from 'react'
import { allergenTags, defaultOptions, dietTags, dishEmoji, findDish, NAVY } from '../data'
import type { LineOptions } from '../data'
import { BottomSheet, PrimaryButton, WarnBanner } from '../ui'
import { useStore } from '../store'
import { fmt } from '../format'

const MAX_QTY = 9 // столько же принимает сервер

export function DishSheet() {
  const { ui, patch, me, snap, totals, addLine, toast } = useStore()
  // За столом есть кто-то ещё — только тогда есть смысл в общем блюде
  const companyAtTable = (snap?.personas.length ?? 0) > 1
  const dish = ui.currentDishId ? findDish(ui.currentDishId) : undefined
  const [qty, setQty] = useState(1)
  const [target, setTarget] = useState<'me' | 'table'>('me')
  const [opts, setOpts] = useState<LineOptions>(() => (dish ? defaultOptions(dish) : {}))
  // Сервер остановил заказ: в блюде есть то, на что гость указал аллергию
  const [blocked, setBlocked] = useState<string[] | null>(null)
  if (!dish) return null

  const close = () => patch({ sheet: null, currentDishId: null, pendingAdd: null })

  const add = async () => {
    const shared = companyAtTable && target === 'table'
    if (!me) {
      // Имя спрашиваем ровно в момент первой надобности; блюдо НЕ теряется
      patch({ sheet: 'name', pendingAdd: { dishId: dish.id, qty, shared, options: opts } })
      return
    }
    const hits = await addLine(dish.id, qty, shared, opts)
    if (hits && hits.length > 0) {
      // Не добавляем молча и не прячем за тостом: это здоровье, а не удобство
      setBlocked(hits)
      return
    }
    patch({ sheet: null, currentDishId: null })
    toast(shared ? `${dish.name} → общее на стол` : `${dish.name} → ${me.name}`)
  }

  /** Гость увидел предупреждение и всё равно заказывает — это его осознанный выбор. */
  const addAnyway = async () => {
    const shared = companyAtTable && target === 'table'
    setBlocked(null)
    await addLine(dish.id, qty, shared, opts, undefined, true)
    patch({ sheet: null, currentDishId: null })
    toast(`${dish.name} → ${me?.name ?? 'вам'}`)
  }

  const choiceStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    textAlign: 'center',
    padding: 10,
    borderRadius: 'var(--ep-r-sm)',
    border: active ? `2px solid ${NAVY}` : '1px solid var(--ep-border)',
    background: 'var(--ep-surface)',
    fontWeight: active ? 600 : 440,
    fontSize: 14,
    cursor: 'pointer'
  })

  const segStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    textAlign: 'center',
    padding: '10px 6px',
    borderRadius: 'var(--ep-r-pill)',
    cursor: 'pointer',
    fontSize: 13.5,
    fontWeight: active ? 600 : 440,
    background: active ? NAVY : 'transparent',
    color: active ? 'var(--ep-on-ink)' : 'var(--ep-text-2)',
    border: 'none'
  })

  return (
    <BottomSheet onClose={close}>
      <div className="ep-scroll" style={{ padding: '4px 22px 16px' }}>
        {dish.photo ? (
          <img
            src={`./dishes/${dish.id}.jpg`}
            alt={dish.name}
            style={{ width: '100%', height: 190, objectFit: 'cover', borderRadius: 'var(--ep-r-card)', marginBottom: 16, background: 'var(--ep-soft)' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: 150,
              borderRadius: 'var(--ep-r-card)',
              marginBottom: 16,
              background: 'linear-gradient(135deg, #FDF6D8, #D9EAC4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 44
            }}
          >
            {dishEmoji(dish)}
          </div>
        )}
        <div style={{ fontWeight: 680, fontSize: 22, letterSpacing: '-0.5px' }}>{dish.name}</div>
        <div style={{ fontSize: 14, color: 'var(--ep-muted)', lineHeight: 1.5, margin: '6px 0 10px' }}>{dish.desc}</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          {(dish.serving || dish.kcal) && (
            <span style={{ fontSize: 12.5, color: 'var(--ep-muted)', background: 'var(--ep-soft)', borderRadius: 'var(--ep-r-pill)', padding: '5px 11px' }}>
              {[dish.serving, dish.kcal ? `${dish.kcal} ккал` : null].filter(Boolean).join(' · ')}
            </span>
          )}
          {dietTags(dish).map(t => (
            <span key={t} style={{ fontSize: 12.5, color: t === 'острое' ? '#B4451F' : '#5C7A4A', background: t === 'острое' ? '#FDEDE6' : '#EDF5E6', borderRadius: 'var(--ep-r-pill)', padding: '5px 11px' }}>
              {t === 'острое' ? '🌶 острое' : t}
            </span>
          ))}
        </div>

        {allergenTags(dish, opts).length > 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--ep-warn)', marginBottom: 16 }}>
            Аллергены: {allergenTags(dish, opts).join(' · ')}
            {(dish.options ?? []).some(o => o.effects) ? ' · зависит от выбора ниже' : ''}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--ep-ok)', marginBottom: 16 }}>Аллергенов из списка нет</div>
        )}

        {/* Кому блюдо — витрина УТП: привязка к персоне в момент заказа.
            В одиночку выбора нет: делить не с кем, и «÷1» только путает. */}
        {companyAtTable && (
          <>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Кому</div>
            <div style={{ display: 'flex', gap: 4, background: 'var(--ep-soft)', borderRadius: 'var(--ep-r-pill)', padding: 4, marginBottom: 18 }}>
              <button style={segStyle(target === 'me')} onClick={() => setTarget('me')}>
                {me ? me.name : 'Себе'}
              </button>
              <button style={segStyle(target === 'table')} onClick={() => setTarget('table')}>
                Общее на стол ÷{totals.participants}
              </button>
            </div>
          </>
        )}

        {blocked && (
          <div
            style={{
              marginBottom: 16,
              padding: '14px 16px',
              borderRadius: 'var(--ep-r-card)',
              background: '#FDECEC',
              border: '2px solid #9B1C1C'
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: '#9B1C1C', marginBottom: 6 }}>
              Здесь есть {blocked.join(' и ')}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.45, marginBottom: 12 }}>
              Вы указали это в аллергиях. Проверьте состав или спросите официанта — если
              уверены, можно заказать.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setBlocked(null)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 'var(--ep-r-pill)',
                  border: 'none',
                  background: '#9B1C1C',
                  color: '#fff',
                  fontWeight: 640,
                  fontSize: 15,
                  cursor: 'pointer'
                }}
              >
                Не буду
              </button>
              <button
                onClick={() => void addAnyway()}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 'var(--ep-r-pill)',
                  border: '1px solid var(--ep-border)',
                  background: 'var(--ep-surface)',
                  fontWeight: 540,
                  fontSize: 15,
                  cursor: 'pointer'
                }}
              >
                Всё равно заказать
              </button>
            </div>
          </div>
        )}

        {target === 'table' && (snap?.lines ?? []).some(l => l.shared && l.dishId === dish.id) && (
          <div style={{ marginBottom: 16 }}>
            <WarnBanner>
              <span style={{ fontSize: 13, color: '#7A5A12', lineHeight: 1.4 }}>
                {dish.name} уже есть в общих блюдах стола — вы добавите{' '}
                <b style={{ fontWeight: 640 }}>ещё одну порцию</b>. Если хотели ту же — она уже заказана 😉
              </span>
            </WarnBanner>
          </div>
        )}

        {/* Модификаторы блюда — реальные: уходят на кухню вместе с позицией */}
        {(dish.options ?? []).map(opt => (
          <div key={opt.id}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>{opt.name}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
              {opt.choices.map(choice => (
                <button
                  key={choice}
                  style={choiceStyle(opts[opt.id] === choice)}
                  onClick={() => setOpts(prev => ({ ...prev, [opt.id]: choice }))}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 22px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--ep-border)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '1px solid var(--ep-border)', borderRadius: 'var(--ep-r-pill)', padding: '7px 12px' }}>
          <span style={{ fontSize: 20, color: 'var(--ep-muted)', cursor: 'pointer' }} onClick={() => setQty(Math.max(1, qty - 1))}>
            −
          </span>
          <span style={{ fontWeight: 600, fontSize: 16, minWidth: 14, textAlign: 'center' }}>{qty}</span>
          <span
            style={{ fontSize: 20, cursor: qty >= MAX_QTY ? 'not-allowed' : 'pointer', opacity: qty >= MAX_QTY ? 0.35 : 1 }}
            onClick={() => setQty(Math.min(MAX_QTY, qty + 1))}
          >
            +
          </span>
        </div>
        <PrimaryButton onClick={() => void add()} style={{ flex: 1, minHeight: 52, fontSize: 14.5 }}>
          Добавить · {fmt(dish.price * qty)}
        </PrimaryButton>
      </div>
    </BottomSheet>
  )
}
