import { useEffect, useState, type ReactNode } from 'react'
import { ALERT_LIMITS, REMIND_AT, SEASONS, TIMEZONES, type SeasonSetting, type VenueSettings } from '@easypay/domain/settings'
import { useStore } from '../../store'
import { SETTINGS, setSettings } from '../../settings'
import { staffPost } from '../staffApi'
import { Toggle } from '../ui'

/**
 * Настройки заведения. Каждая строка что-то меняет сразу на всех
 * устройствах: сервер не примет выключенный способ оплаты, зал покраснеет
 * по новому порогу, гость увидит другой сезон.
 */

const ERRORS: Record<string, string> = {
  'no payment method': 'Оставьте хотя бы один способ оплаты',
  'bad inn': 'ИНН — 10 цифр у юрлица или 12 у ИП',
  'name required': 'У заведения должно быть название'
}

const SEASON_LABEL: Record<SeasonSetting, string> = { auto: 'Авто', autumn: 'Осень', winter: 'Зима', spring: 'Весна', summer: 'Лето' }

export function SettingsPage() {
  const { toast, menuRev } = useStore()
  const [base, setBase] = useState<VenueSettings>(SETTINGS)
  const [st, setSt] = useState<VenueSettings>(SETTINGS)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(st) !== JSON.stringify(base)

  // Настройки поменяли с другого устройства — подхватываем, если своих правок нет
  useEffect(() => {
    if (!dirty) {
      setBase(SETTINGS)
      setSt(SETTINGS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuRev])

  const set = <K extends keyof VenueSettings>(group: K, patch: Partial<VenueSettings[K]>) => {
    setSaved(false)
    setSt(prev => ({ ...prev, [group]: { ...prev[group], ...patch } }))
  }

  const save = async () => {
    setBusy(true)
    const r = await staffPost('/api/settings', { settings: st })
    setBusy(false)
    if (!r.ok) return toast(ERRORS[r.error ?? ''] ?? 'Не сохранилось — проверьте связь')
    const next = r.body.settings as VenueSettings
    setSettings(next, Number(r.body.version))
    setBase(next)
    setSt(next)
    setSaved(true)
  }

  const v = st.venue
  const a = st.alerts
  const p = st.pay
  const sh = st.shift
  const g = st.guest

  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      {dirty && (
        <div className="c-card sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4.5 py-3" style={{ boxShadow: '0 10px 30px -18px rgba(0,0,0,.35)' }}>
          <span className="size-2.5 rounded-full bg-c-warn" />
          <span className="flex-1 text-[14px] font-bold">Есть несохранённые изменения</span>
          <button onClick={() => setSt(base)} className="h-10 rounded-xl border border-c-line bg-c-card px-3.5 text-[14px]">
            Отменить
          </button>
          <button onClick={() => void save()} disabled={busy} className="h-10 rounded-xl bg-c-ink px-4 text-[14px] font-bold text-white disabled:opacity-50">
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      )}
      {saved && !dirty && (
        <div role="status" className="rounded-xl bg-c-ok-bg px-4 py-3 text-[14px] font-bold text-c-ok-fg">
          ✓ Сохранено · применяется сразу на всех устройствах
        </div>
      )}

      <Group title="Заведение" sub="Видно гостям в меню и в чеке">
        <Row label="Название">
          <Text value={v.name} onChange={name => set('venue', { name })} max={60} />
        </Row>
        <Row label="Адрес">
          <Text value={v.address} onChange={address => set('venue', { address })} max={120} placeholder="Москва, Малая Бронная, 24" />
        </Row>
        <Row label="Юрлицо">
          <Text value={v.legal} onChange={legal => set('venue', { legal })} max={80} placeholder="ООО «Сезоны»" />
        </Row>
        <Row label="ИНН">
          <Text value={v.inn} onChange={inn => set('venue', { inn: inn.replace(/[^\d\s]/g, '') })} max={14} placeholder="7703456789" />
        </Row>
        <Row label="Часовой пояс" hint="По нему считаются часы в отчётах смены">
          <select value={v.tz} onChange={e => set('venue', { tz: e.target.value })} className="h-10 rounded-xl border border-c-line bg-c-bg px-3 text-[14px]">
            {TIMEZONES.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group title="Когда поднимать тревогу" sub="Столы и билеты подсвечиваются в зале и на кухне">
        <Row label="Сели и не заказали">
          <Stepper value={a.noOrderMin} unit="мин" limits={ALERT_LIMITS.noOrderMin} onChange={noOrderMin => set('alerts', { noOrderMin })} />
        </Row>
        <Row label="Блюдо на кухне дольше" hint="Билет желтеет на половине срока и краснеет на сроке; стол получает отметку">
          <Stepper value={a.kitchenMin} unit="мин" limits={ALERT_LIMITS.kitchenMin} onChange={kitchenMin => set('alerts', { kitchenMin })} />
        </Row>
        <Row label="Вызов без ответа" hint="На карточке стола появится, сколько ждут">
          <Stepper value={a.callMin} unit="мин" limits={ALERT_LIMITS.callMin} onChange={callMin => set('alerts', { callMin })} />
        </Row>
        <Row label="Наличные не приняты">
          <Stepper value={a.cashMin} unit="мин" limits={ALERT_LIMITS.cashMin} onChange={cashMin => set('alerts', { cashMin })} />
        </Row>
        <Row label="Стол открыт дольше" hint="Попадёт в «Требует решения»">
          <Stepper value={a.longTableH} unit="ч" limits={ALERT_LIMITS.longTableH} onChange={longTableH => set('alerts', { longTableH })} />
        </Row>
      </Group>

      <Group title="Оплата" sub="Что гость видит на экране оплаты — выключенное не примет и сервер">
        <Row label="СБП">
          <Toggle on={p.sbp} onClick={() => set('pay', { sbp: !p.sbp })} label="СБП" />
        </Row>
        <Row label="Карта">
          <Toggle on={p.card} onClick={() => set('pay', { card: !p.card })} label="Карта" />
        </Row>
        <Row label="Наличными официанту" hint="Деньги появятся в счёте после подтверждения официантом">
          <Toggle on={p.cash} onClick={() => set('pay', { cash: !p.cash })} label="Наличные" />
        </Row>
        <Row label="Делить счёт" hint="Своё · поровну · весь стол. Выключено — только весь стол">
          <Toggle on={p.split} onClick={() => set('pay', { split: !p.split })} label="Делить счёт" />
        </Row>
        <Row label="Чаевые официанту" hint="Напрямую, мимо счёта ресторана">
          <Toggle on={p.tips} onClick={() => set('pay', { tips: !p.tips })} label="Чаевые" />
        </Row>
        {p.tips && (
          <Row label="Варианты чаевых">
            <Seg
              value={p.tipMode}
              options={[
                ['rub', '100 / 200 / 300 ₽'],
                ['pct', '5 / 10 / 15 %']
              ]}
              onChange={tipMode => set('pay', { tipMode })}
            />
          </Row>
        )}
      </Group>

      <Group title="Смена" sub="Правила закрытия">
        <Row label="Напомнить закрыть смену в">
          <Seg
            value={sh.remindAt ?? 'off'}
            options={[...REMIND_AT.map(t => [t, t] as [string, string]), ['off', 'Не напоминать']]}
            onChange={t => set('shift', { remindAt: t === 'off' ? null : t })}
          />
        </Row>
        <Row label="Нельзя закрыть с нерешённым долгом" hint="Выключено — долг уйдёт в Z-отчёт без решения">
          <Toggle on={sh.debtBlocksClose} onClick={() => set('shift', { debtBlocksClose: !sh.debtBlocksClose })} label="Долг блокирует закрытие" />
        </Row>
        <Row label="Расхождение кассы — только с комментарием">
          <Toggle on={sh.noteOnDiff} onClick={() => set('shift', { noteOnDiff: !sh.noteOnDiff })} label="Комментарий к расхождению" />
        </Row>
      </Group>

      <Group title="Гостевое меню" sub="Внешний вид для гостей">
        <Row label="Сезонная палитра" hint="Авто — по дате">
          <Seg value={g.season} options={SEASONS.map(s => [s, SEASON_LABEL[s]] as [SeasonSetting, string])} onChange={season => set('guest', { season })} />
        </Row>
        <Row label="Сменяющиеся фото на входе">
          <Toggle on={g.photos} onClick={() => set('guest', { photos: !g.photos })} label="Фото на входе" />
        </Row>
        <Row label="Спрашивать об аллергии при первом заказе" hint="Выключайте только там, где нет кухни">
          <Toggle on={g.askAllergy} onClick={() => set('guest', { askAllergy: !g.askAllergy })} label="Вопрос об аллергии" />
        </Row>
      </Group>
    </div>
  )
}

function Group({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[16px] font-bold">{title}</h2>
      <div className="mt-0.5 mb-2.5 text-[13px] text-c-mute">{sub}</div>
      <div className="c-card overflow-hidden">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-c-line2 px-4.5 py-3.5 last:border-0">
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-[15px]">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-c-mute">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Text({ value, onChange, max, placeholder }: { value: string; onChange: (v: string) => void; max: number; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      maxLength={max}
      placeholder={placeholder}
      className="h-10 w-[min(320px,80vw)] rounded-xl border border-c-line bg-c-bg px-3 text-[14px] outline-none focus:border-c-ink"
    />
  )
}

function Stepper({ value, unit, limits, onChange }: { value: number; unit: string; limits: [number, number]; onChange: (v: number) => void }) {
  const [lo, hi] = limits
  return (
    <div className="flex items-center gap-1 rounded-xl border border-c-line bg-c-bg p-1">
      <button onClick={() => onChange(Math.max(lo, value - 1))} disabled={value <= lo} aria-label="Меньше" className="size-8 rounded-lg text-[18px] hover:bg-c-chip disabled:opacity-30">
        −
      </button>
      <span className="c-num w-16 text-center text-[14px] font-bold">
        {value} {unit}
      </span>
      <button onClick={() => onChange(Math.min(hi, value + 1))} disabled={value >= hi} aria-label="Больше" className="size-8 rounded-lg text-[18px] hover:bg-c-chip disabled:opacity-30">
        +
      </button>
    </div>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-c-tabs p-0.75" role="radiogroup">
      {options.map(([id, label]) => {
        const on = id === value
        return (
          <button
            key={id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className={`h-8 rounded-[9px] px-3 text-[13px] whitespace-nowrap ${on ? 'bg-c-card font-bold' : ''}`}
            style={on ? { boxShadow: '0 1px 2px rgba(27,26,23,.12)' } : undefined}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
