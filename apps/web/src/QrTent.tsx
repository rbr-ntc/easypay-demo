import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import { RESTAURANT } from './data'
import { HALL } from './hallConfig'
import { tableId } from './api'
import { getStaffToken } from './staff'
import { SEASON_MENU, currentSeason, seasonVars } from './guest/showcase'

/**
 * QR-тент на стол, A6. Один вариант — тёмный, в стиле гостевого приложения:
 * прототип показывал светлый и тёмный на выбор, и на странице стола стояли
 * оба сразу — выглядело как два разных тента.
 *
 * QR всегда чёрный на белом: его сканируют и с бумаги, и при плохом свете,
 * а в тёмной теме «белый код на тёмном» камера читает через раз. Номер стола
 * крупно — официант видит его издалека. Полоса и подпись сезона меняются
 * вместе с меню.
 */

/** Подписи столов с сервера — только персоналу: это ключи от всех столов зала. */
type Keys = { state: 'loading' } | { state: 'login' } | { state: 'ok'; keys: Record<string, string> }

function useKeys(): Keys {
  const [keys, setKeys] = useState<Keys>({ state: 'loading' })
  useEffect(() => {
    let live = true
    fetch('/api/qr', { headers: { 'x-staff-token': getStaffToken() } })
      .then(async r => {
        if (!live) return
        if (r.status === 401 || r.status === 403) return setKeys({ state: 'login' })
        const body = await r.json()
        setKeys({ state: 'ok', keys: body.keys ?? {} })
      })
      .catch(() => live && setKeys({ state: 'login' }))
    return () => {
      live = false
    }
  }, [])
  return keys
}

function tableUrl(id: string, key?: string): string {
  return `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(id)}${key ? `&k=${encodeURIComponent(key)}` : ''}`
}

/** Без входа персонала тент не напечатать: без подписи QR не сажает за стол. */
function NeedLogin() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: '#E9E6E0', color: '#1B1A17' }}>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 32 }}>QR-коды — для персонала</div>
      <p className="max-w-md text-[15px]" style={{ color: '#3E3C37' }}>
        В коде стола — его подпись: без неё гость не сядет за стол по ссылке. Войдите в смену, чтобы распечатать тенты.
      </p>
      <a className="underline" href="#/hall">
        войти →
      </a>
    </div>
  )
}

const QR_FG = '#000000'
const SERIF = "'Cormorant Garamond', Georgia, serif"

function Tent({ id, url, scale = 1 }: { id: string; url: string; scale?: number }) {
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
        width: 420 * scale,
        height: 594 * scale,
        padding: `${40 * scale}px ${36 * scale}px`,
        background: v['--g-paper'],
        color: '#F3F0EA',
        boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)',
        fontFamily: 'Manrope, sans-serif'
      }}
    >
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 40 * scale, lineHeight: 1 }}>{RESTAURANT}</div>
      <div style={{ marginTop: 6 * scale, fontSize: 13 * scale, color: v['--g-ink'] }}>{SEASON_MENU[season]}</div>
      <div style={{ marginTop: 26 * scale, padding: 14 * scale, borderRadius: 24 * scale, background: '#FFFFFF' }}>
        <QRCode value={url} size={200 * scale} fgColor={QR_FG} />
      </div>
      <div className="flex items-baseline" style={{ marginTop: 22 * scale, gap: 10 * scale }}>
        <span style={{ fontSize: 15 * scale, color: '#A8A298' }}>стол</span>
        <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 64 * scale, lineHeight: 0.9 }}>{id}</span>
      </div>
      <div style={{ marginTop: 14 * scale, fontSize: 15 * scale, lineHeight: 1.45, color: '#CFC9BF', maxWidth: 280 * scale }}>
        Наведите камеру телефона. Каждый заказывает своё, платите в конце
      </div>
      <div className="flex-1" />
      <div
        className="flex items-center"
        style={{
          height: 48 * scale,
          padding: `0 ${22 * scale}px`,
          borderRadius: 24 * scale,
          background: v['--g-acc'],
          color: '#1A1612',
          fontSize: 15 * scale,
          fontWeight: 700
        }}
      >
        без приложения
      </div>
    </div>
  )
}

function SingleTent({ id, keys }: { id: string; keys: Record<string, string> }) {
  return (
    <div className="min-h-full px-6 py-12" style={{ background: '#E9E6E0' }}>
      <div className="flex justify-center">
        <Tent id={id} url={tableUrl(id, keys[id])} />
      </div>
      <div className="mt-8 flex justify-center gap-5 text-[14px] print:hidden" style={{ color: '#3E3C37' }}>
        <a className="underline" href={tableUrl(id, keys[id])}>
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
function AllTents({ keys }: { keys: Record<string, string> }) {
  return (
    <div className="min-h-full px-6 pt-8 pb-12" style={{ background: '#E9E6E0', color: '#1B1A17' }}>
      <div className="print:hidden">
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 40, lineHeight: 1 }}>QR-коды столов</div>
        <p className="mt-2 mb-6 max-w-xl text-[15px]" style={{ color: '#3E3C37' }}>
          Каждый код ведёт на свой стол. Распечатайте и расставьте тенты — гость сканирует свой стол и сразу попадает в
          его заказ. Нажмите на тент, чтобы открыть его крупно для печати.
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
                <Tent id={t.id} url={tableUrl(t.id, keys[t.id])} scale={0.5} />
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
  const k = useKeys()
  if (k.state === 'loading') return null
  if (k.state === 'login') return <NeedLogin />
  return tableId ? <SingleTent id={tableId} keys={k.keys} /> : <AllTents keys={k.keys} />
}
