import { HALL_LABEL, RESTAURANT, TABLE_LABEL } from '../data'
import { Avatar } from '../avatars'
import { PrimaryButton, Mono } from '../ui'
import { useStore } from '../store'

export function Welcome() {
  const { state, dispatch } = useStore()
  const returning = state.me !== null

  return (
    <div className="ep-screen" style={{ background: '#fff' }}>
      <div className="ep-scroll" style={{ padding: '18px 24px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
          <div style={{ fontWeight: 700, fontSize: 19, letterSpacing: '-0.4px' }}>{RESTAURANT}</div>
          <div style={{ display: 'flex', gap: 2, background: '#F2F2F4', borderRadius: 50, padding: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 50, background: '#1F1D3D', color: '#fff' }}>RU</span>
            <span style={{ fontSize: 12, fontWeight: 500, padding: '5px 11px', color: '#8A8A92' }}>EN</span>
          </div>
        </div>

        <Mono style={{ marginBottom: 6 }}>Ваш стол</Mono>
        <div style={{ fontWeight: 300, fontSize: 46, lineHeight: 1, letterSpacing: '-1.8px', marginBottom: 22 }}>
          {TABLE_LABEL}
          <br />
          <span style={{ fontSize: 30, color: '#7A7A84' }}>{HALL_LABEL}</span>
        </div>

        <div
          style={{
            width: '100%',
            height: 210,
            borderRadius: 24,
            marginBottom: 22,
            background: 'linear-gradient(135deg, #1F1D3D 0%, #3A3458 55%, #7C5CFC 130%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 15
          }}
        >
          Фото зала · Терраса
        </div>

        {returning ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <Avatar animal={state.me!.animal} size={44} />
            <div style={{ fontWeight: 540, fontSize: 24, letterSpacing: '-0.7px' }}>
              С возвращением, {state.me!.name}!
            </div>
          </div>
        ) : (
          <div style={{ fontWeight: 540, fontSize: 24, letterSpacing: '-0.7px', marginBottom: 8 }}>Добро пожаловать!</div>
        )}

        <div style={{ fontWeight: 330, fontSize: 15.5, lineHeight: 1.5, color: '#42424C', marginBottom: 18 }}>
          Закажите и оплатите прямо со своего телефона — быстро и без очереди.
        </div>

        <div style={{ display: 'flex', gap: 11, background: '#F4F1FE', borderRadius: 18, padding: '15px 16px' }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: '#EDE7FD',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: '#7C5CFC',
              fontWeight: 700
            }}
          >
            i
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#3A3458' }}>
            Можно заказать за весь стол отсюда. А если каждый хочет заказать сам — пусть отсканирует этот же QR со
            своего телефона.
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 22px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid #F0F0F2' }}>
        <PrimaryButton onClick={() => dispatch({ type: 'patch', patch: { screen: 'menu' } })} style={{ fontSize: 17 }}>
          {returning ? 'Продолжить заказ' : 'Открыть меню'}
        </PrimaryButton>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: '#A0A0A8', marginTop: 11, lineHeight: 1.45 }}>
          Продолжая, вы соглашаетесь на обработку данных по <span style={{ textDecoration: 'underline' }}>152-ФЗ</span>
          {' · '}
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => dispatch({ type: 'reset' })}>
            сбросить демо
          </span>
        </div>
      </div>
    </div>
  )
}
