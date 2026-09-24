import QRCode from 'react-qr-code'
import { RESTAURANT } from './data'
import { HALL } from './hallConfig'
import { tableId } from './api'
import { SEASON_MENU, currentSeason, seasonVars } from './guest/showcase'

/**
 * QR-тент на стол, A6. Два варианта печати — светлый и тёмный.
 *
 * QR всегда чёрный на белом: его сканируют и с бумаги, и при плохом свете,
 * а в тёмной теме «белый код на тёмном» камера читает через раз. Номер стола
 * крупно — официант видит его издалека. Полоса и подпись сезона меняются
 * вместе с меню.
 */

function tableUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(id)}`
}

const QR_FG = '#000000'
const SERIF = "'Cormorant Garamond', Georgia, serif"

function LightTent({ id, scale = 1 }: { id: string; scale?: number }) {
  const acc = seasonVars(currentSeason())['--g-acc']
  return (
    <div
      className="relative flex shrink-0 flex-col items-center overflow-hidden rounded-lg text-center"
      style={{
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
        width: 420 * scale,
        height: 594 * scale,
        padding: `${40 * scale}px ${36 * scale}px`,
        background: '#FBF9F6',
        color: '#1B1A17',
        boxShadow: '0 30px 60px -30px rgba(30,20,10,.4)',
        fontFamily: 'Manrope, sans-serif'
      }}
    >
      <div className="absolute inset-x-0 top-0" style={{ height: 8 * scale, background: acc }} />
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 40 * scale, lineHeight: 1 }}>{RESTAURANT}</div>
      <div style={{ marginTop: 28 * scale, fontSize: 15 * scale, color: '#6B665E' }}>стол</div>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 96 * scale, lineHeight: 0.9 }}>{id}</div>
      <div
        style={{
          marginTop: 24 * scale,
          padding: 14 * scale,
          borderRadius: 20 * scale,
          background: '#FFFFFF',
          boxShadow: '0 0 0 1px #E6E2DA'
        }}
      >
        <QRCode value={tableUrl(id)} size={180 * scale} fgColor={QR_FG} />
      </div>
      <div style={{ marginTop: 24 * scale, fontSize: 20 * scale, fontWeight: 700, lineHeight: 1.3 }}>
        Наведите камеру
      </div>
      <div style={{ marginTop: 6 * scale, fontSize: 15 * scale, lineHeight: 1.45, color: '#3E3C37', maxWidth: 280 * scale }}>
        Меню, заказ и оплата с телефона — без приложения и регистрации
      </div>
      <div className="flex-1" />
      <div style={{ fontSize: 13 * scale, color: '#6B665E' }}>СБП · карта · наличными официанту</div>
    </div>
  )
}

function DarkTent({ id }: { id: string }) {
  const season = currentSeason()
  const v = seasonVars(season)
  return (
    <div
      className="relative flex shrink-0 flex-col items-center overflow-hidden rounded-lg text-center"
      style={{
        // Без этого браузер при печати выкидывает фон: тёмный тент выходил
        // белым с белым текстом, а полоса сезона пропадала
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
        width: 420,
        height: 594,
        padding: '40px 36px',
        background: v['--g-paper'],
        color: '#F3F0EA',
        boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)',
        fontFamily: 'Manrope, sans-serif'
      }}
    >
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 40, lineHeight: 1 }}>{RESTAURANT}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: v['--g-ink'] }}>{SEASON_MENU[season]}</div>
      <div style={{ marginTop: 26, padding: 14, borderRadius: 24, background: '#FFFFFF' }}>
        <QRCode value={tableUrl(id)} size={200} fgColor={QR_FG} />
      </div>
      <div className="flex items-baseline gap-2.5" style={{ marginTop: 22 }}>
        <span style={{ fontSize: 15, color: '#A8A298' }}>стол</span>
        <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 64, lineHeight: 0.9 }}>{id}</span>
      </div>
      <div style={{ marginTop: 14, fontSize: 15, lineHeight: 1.45, color: '#CFC9BF', maxWidth: 280 }}>
        Сканируйте — без приложения и регистрации. Каждый заказывает своё, платите в конце
      </div>
      <div className="flex-1" />
      <div
        className="flex items-center"
        style={{ height: 48, padding: '0 22px', borderRadius: 24, background: v['--g-acc'], color: '#1A1612', fontSize: 15, fontWeight: 700 }}
      >
        без приложения
      </div>
    </div>
  )
}

function SingleTent({ id }: { id: string }) {
  return (
    <div className="min-h-full px-6 py-12" style={{ background: '#E9E6E0' }}>
      <div className="flex flex-wrap items-start justify-center gap-10">
        <LightTent id={id} />
        <DarkTent id={id} />
      </div>
      <div className="mt-8 flex justify-center gap-5 text-[14px] print:hidden" style={{ color: '#3E3C37' }}>
        <a className="underline" href={`?t=${encodeURIComponent(id)}`}>
          открыть гостевой экран здесь →
        </a>
        <a className="underline" href="#/qr">
          все столы
        </a>
      </div>
    </div>
  )
}

/** Лист тентов на все столы зала: распечатать и расставить. */
function AllTents() {
  return (
    <div className="min-h-full px-6 pt-8 pb-12" style={{ background: '#E9E6E0', color: '#1B1A17' }}>
      <div className="print:hidden">
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 40, lineHeight: 1 }}>QR-коды столов</div>
        <p className="mt-2 mb-6 max-w-xl text-[15px]" style={{ color: '#3E3C37' }}>
          Каждый код ведёт на свой стол. Распечатайте и расставьте тенты — гость сканирует свой стол и сразу попадает в
          его заказ. Тёмный вариант — на странице стола.
        </p>
      </div>

      {HALL.zones.map(zone => (
        <div key={zone.id} className="mb-8">
          <div className="mb-3 text-[13px] font-bold tracking-widest uppercase" style={{ color: '#6B665E' }}>
            {zone.name}
          </div>
          <div className="flex flex-wrap gap-6">
            {zone.tables.map(t => (
              <a key={t.id} href={`?t=${encodeURIComponent(t.id)}#/qr`} aria-label={`Тент стола ${t.id} крупно`}>
                <LightTent id={t.id} scale={0.5} />
              </a>
            ))}
          </div>
        </div>
      ))}

      <a className="text-[14px] underline print:hidden" href="#/hall" style={{ color: '#3E3C37' }}>
        ← в зал
      </a>
    </div>
  )
}

export function QrTent() {
  return tableId ? <SingleTent id={tableId} /> : <AllTents />
}
