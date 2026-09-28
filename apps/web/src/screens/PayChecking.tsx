import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

/** Сколько раз переспрашиваем, прежде чем предложить проверить вручную. */
const TRIES = 30
const EVERY_MS = 2500

/**
 * Гость вернулся со страницы эквайера. Что случилось с деньгами, знает только
 * эквайер: переспрашиваем сервер, пока не придёт «оплачено» или «отказ». Пока
 * ответа нет — честно говорим «проверяем», а не «оплачено» и не «ошибка».
 */
export function PayChecking({ intentId }: { intentId: string }) {
  const { checkPay, patch, forgetPayIntent, cancelPay } = useStore()
  const [tries, setTries] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  // «Проверить ещё раз» начинает новый круг опроса
  const [round, setRound] = useState(0)
  const stopped = useRef(false)
  // Действия стора пересоздаются на каждой отрисовке — опрос не должен из-за этого перезапускаться
  const check = useRef(checkPay)
  check.current = checkPay

  useEffect(() => {
    stopped.current = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (n: number) => {
      const r = await check.current(intentId)
      if (stopped.current || r.status === 'succeeded' || r.status === 'canceled') return
      if (r.confirmationUrl) setUrl(r.confirmationUrl)
      setTries(n + 1)
      if (n + 1 < TRIES) timer = setTimeout(() => void tick(n + 1), EVERY_MS)
    }
    void tick(0)
    return () => {
      stopped.current = true
      clearTimeout(timer)
    }
  }, [intentId, round])

  const waiting = tries < TRIES
  return (
    <div className="g-anim-fade absolute inset-0 flex flex-col items-center justify-center gap-6 px-8 text-center">
      {waiting && (
        <span className="g-spin size-16 rounded-full" style={{ border: '4px solid rgba(255,255,255,.1)', borderTopColor: 'var(--g-acc)' }} />
      )}
      <div>
        <div className="text-[20px] font-bold">{waiting ? 'Проверяем оплату' : 'Банк ещё не ответил'}</div>
        <div className="mt-1.5 text-[15px] text-g-mute">
          {waiting
            ? 'Обычно это несколько секунд. Не оплачивайте повторно'
            : 'Если деньги списались, они придут в счёт сами — второй раз платить не нужно'}
        </div>
      </div>
      {waiting && tries > 2 && (
        // Ушёл со страницы банка и передумал — не ждать двадцать минут, а платить иначе
        <button onClick={() => void cancelPay()} className="h-11 text-[14px] text-g-mute underline">
          Я не платил — отменить оплату картой
        </button>
      )}
      {!waiting && (
        <div className="flex w-full flex-col gap-2">
          <button
            onClick={() => {
              setTries(0)
              setRound(r => r + 1)
            }}
            className="g-cta h-13 w-full rounded-full text-[16px]">
            Проверить ещё раз
          </button>
          {url && (
            <button onClick={() => window.location.assign(url)} className="h-12 w-full rounded-full bg-g-sand text-[15px] text-g-fg">
              Вернуться к оплате
            </button>
          )}
          <button
            onClick={() => {
              forgetPayIntent()
              patch({ payStage: 'form', payIntent: null, screen: 'table' })
            }}
            className="h-12 text-[15px] text-g-mute"
          >
            К столу
          </button>
        </div>
      )}
    </div>
  )
}
