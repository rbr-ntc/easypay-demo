import { HALL_LABEL, RESTAURANT } from '../data'
import { Avatar } from '../avatars'
import { PrimaryButton, Mono } from '../ui'
import { useStore } from '../store'
import { tableId } from '../api'

export function Welcome() {
  const { patch, me, snap, resetDemo, forgetMe } = useStore()
  const personas = snap?.personas ?? []

  return (
    <div className="ep-screen" style={{ background: 'var(--ep-surface)' }}>
      <div className="ep-scroll" style={{ padding: '18px 24px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
          <div style={{ fontWeight: 700, fontSize: 19, letterSpacing: '-0.4px' }}>{RESTAURANT}</div>
          <div style={{ display: 'flex', gap: 2, background: 'var(--ep-soft)', borderRadius: 'var(--ep-r-pill)', padding: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 'var(--ep-r-pill)', background: 'var(--ep-ink)', color: 'var(--ep-on-ink)' }}>RU</span>
            <span style={{ fontSize: 12, fontWeight: 500, padding: '5px 11px', color: 'var(--ep-muted)' }}>EN</span>
          </div>
        </div>

        <Mono style={{ marginBottom: 6 }}>Ваш стол</Mono>
        <div style={{ fontWeight: 300, fontSize: 46, lineHeight: 1, letterSpacing: '-1.8px', marginBottom: 18 }}>
          Стол №{tableId}
          <br />
          <span style={{ fontSize: 30, color: 'var(--ep-muted)' }}>{HALL_LABEL}</span>
        </div>

        {personas.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <div style={{ display: 'flex' }}>
              {personas.slice(0, 5).map((p, i) => (
                <div key={p.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                  <Avatar animal={p.animal} size={28} label={p.name} />
                </div>
              ))}
            </div>
            <span style={{ fontSize: 13.5, color: 'var(--ep-muted)' }}>
              За столом: {personas.map(p => p.name).join(', ')}
            </span>
          </div>
        )}

        <div
          style={{
            width: '100%',
            height: 190,
            borderRadius: 'var(--ep-r-lg)',
            marginBottom: 22,
            background: 'linear-gradient(135deg, var(--ep-ink) 0%, var(--ep-text-2) 55%, var(--ep-accent) 130%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 15
          }}
        >
          Фото зала · Терраса
        </div>

        {me ? (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar animal={me.animal} size={44} label={me.name} />
              <div style={{ fontWeight: 540, fontSize: 24, letterSpacing: '-0.7px' }}>С возвращением, {me.name}!</div>
            </div>
            <div
              onClick={forgetMe}
              style={{ fontSize: 13, color: 'var(--ep-accent)', marginTop: 6, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Я другой гость — начать со своим именем
            </div>
          </div>
        ) : (
          <div style={{ fontWeight: 540, fontSize: 24, letterSpacing: '-0.7px', marginBottom: 8 }}>Добро пожаловать!</div>
        )}

        <div style={{ fontWeight: 330, fontSize: 15.5, lineHeight: 1.5, color: 'var(--ep-text-2)', marginBottom: 18 }}>
          Закажите и оплатите прямо со своего телефона — быстро и без очереди.
        </div>

        <div style={{ display: 'flex', gap: 11, background: 'var(--ep-accent-bg)', borderRadius: 'var(--ep-r-card)', padding: '15px 16px' }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 'var(--ep-r-xs)',
              background: 'var(--ep-accent-bg2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: 'var(--ep-accent)',
              fontWeight: 700
            }}
          >
            i
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ep-text-2)' }}>
            Можно заказать за весь стол отсюда. А если каждый хочет заказать сам — пусть отсканирует этот же QR со
            своего телефона.
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 22px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--ep-border)' }}>
        <PrimaryButton onClick={() => patch({ screen: 'menu' })} style={{ fontSize: 17 }}>
          {me ? 'Продолжить заказ' : 'Открыть меню'}
        </PrimaryButton>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ep-muted)', marginTop: 11, lineHeight: 1.45 }}>
          Продолжая, вы соглашаетесь на обработку данных по <span style={{ textDecoration: 'underline' }}>152-ФЗ</span>
          {' · '}
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => void resetDemo()}>
            сбросить стол
          </span>
        </div>
      </div>
    </div>
  )
}
