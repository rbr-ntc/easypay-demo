import { MENU } from '../data'
import { allCredits, authorLabel } from '../credits'

/**
 * Страница авторов фотографий. На неё ведёт ссылка внизу меню; в карточке
 * блюда подпись стоит у самого снимка.
 */
export function PhotoCredits() {
  const nameOf = new Map(Object.values(MENU).flat().map(d => [d.id, d.name]))
  const rows = allCredits()
    .map(([id, credit]) => ({ id, name: nameOf.get(id) ?? id, credit }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return (
    <div className="ep-screen" style={{ background: '#FAF5EA', color: '#062119' }}>
      <div className="ep-scroll px-5 pt-6 pb-10">
        <a href="#" className="inline-flex h-11 items-center text-[15px] font-bold text-muted">
          ← к меню
        </a>
        <h1 className="mt-2 text-[28px] leading-tight font-extrabold tracking-tight">Фотографии блюд</h1>
        <p className="mt-2 text-[14px] leading-relaxed font-medium text-muted">
          Снимки распространяются по свободным лицензиям Creative Commons. Кадры обрезаны и уменьшены под
          карточки меню.
        </p>

        <ul className="mt-5 flex flex-col gap-3">
          {rows.map(({ id, name, credit }) => (
            <li key={id} className="rounded-[18px] bg-white/70 px-4 py-3" style={{ border: '1px solid #E6DDCB' }}>
              <div className="text-[15px] font-extrabold">{name}</div>
              <div className="mt-0.5 text-[13px] font-semibold text-muted">
                <a className="underline" href={credit.page} target="_blank" rel="noreferrer noopener">
                  {authorLabel(credit)}
                </a>
                {' · '}
                <a className="underline" href={credit.licenseUrl} target="_blank" rel="noreferrer noopener">
                  {credit.license}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
