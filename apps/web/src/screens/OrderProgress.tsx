// Прогресс заказа: три состояния, которые гость понимает без чтения.
// Иконки нарисованы вручную и анимируются CSS-ом — никакой Lottie и внешних
// ассетов: в зале мобильный интернет, а лишние сотни килобайт стоят секунд
// ожидания там, где гость и так нервничает.
import '../progress.css'

export type StepState = 'done' | 'active' | 'todo'

/** Квитанция с галочкой: заказ принят и записан. */
function ReceiptIcon({ state }: { state: StepState }) {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true">
      <path
        d="M8 5h16v22l-3-2-2.5 2-2.5-2-2.5 2-2.5-2-3 2V5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        className={state === 'todo' ? 'ep-p-check' : 'ep-p-check ep-p-check--on'}
        d="M11.5 14.5l3 3 6-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Кастрюля: пузыри поднимаются, пар вьётся, крышка подрагивает. */
function PotIcon({ state }: { state: StepState }) {
  const live = state === 'active'
  return (
    <svg viewBox="0 0 32 32" width="23" height="23" fill="none" aria-hidden="true">
      <g className={live ? 'ep-p-steam' : undefined} opacity={live ? 1 : 0}>
        <path d="M12 7c1.6-1.2.4-2.6 0-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M16 6.4c1.8-1.4.5-3-.1-4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M20 7c1.6-1.2.4-2.6 0-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </g>

      <g className={live ? 'ep-p-bubbles' : undefined} opacity={live ? 1 : 0}>
        <circle cx="13" cy="19" r="1.5" fill="currentColor" />
        <circle cx="17.5" cy="20" r="1.1" fill="currentColor" />
        <circle cx="21" cy="19.4" r="1.3" fill="currentColor" />
      </g>

      <path
        d="M5.5 12.5h21l-1.6 12.2a2.5 2.5 0 01-2.5 2.2H9.6a2.5 2.5 0 01-2.5-2.2L5.5 12.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        className={live ? 'ep-p-lid' : undefined}
        d="M4 12.5h24"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M3.5 17h2M26.5 17h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Тарелка с приборами: подано, можно есть. */
function PlateIcon({ state }: { state: StepState }) {
  return (
    <svg viewBox="0 0 32 32" width="23" height="23" fill="none" aria-hidden="true">
      <g className={state === 'done' ? 'ep-p-serve' : undefined}>
        <circle cx="16" cy="17" r="9" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="16" cy="17" r="4.6" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
        <path d="M5 8v6a2 2 0 002 2V8M6 8v4M27 8c0 3-1.6 4.4-2.4 4.8V26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {state === 'done' && (
        <g className="ep-p-spark">
          <path d="M25 7l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7L25 7z" fill="currentColor" />
        </g>
      )}
    </svg>
  )
}

const ICONS = [ReceiptIcon, PotIcon, PlateIcon]

export function OrderProgress({ steps }: { steps: { label: string; st: StepState }[] }) {
  return (
    <div className="ep-p" role="group" aria-label="Статус заказа">
      {steps.map((step, i) => {
        const Icon = ICONS[i] ?? ReceiptIcon
        const prev = steps[i - 1]
        return (
          <div key={step.label} className="ep-p-step" data-state={step.st}>
            {i > 0 && (
              <div className="ep-p-track">
                <div
                  className="ep-p-fill"
                  style={{ transform: `scaleX(${prev.st === 'done' ? 1 : 0})` }}
                />
              </div>
            )}
            <div className="ep-p-badge">
              <Icon state={step.st} />
            </div>
            <div className="ep-p-label">{step.label}</div>
          </div>
        )
      })}
    </div>
  )
}
