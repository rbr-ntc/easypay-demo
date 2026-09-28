/**
 * Живой поток SSE, который отпускает соединение в фоновой вкладке.
 *
 * По HTTP/1.1 браузер держит к одному адресу не больше шести соединений —
 * на все вкладки сразу. Каждый экран держит один-два потока (зал плюс стол,
 * зал плюс кухня), и седьмая вкладка стенда вставала в очередь навсегда:
 * экран стола висел на «Подключаемся к столу…». HTTP/2 сняло бы лимит, но
 * у стенда нет домена и HTTPS. Поэтому поток закрывается, когда вкладку не
 * видно, и открывается снова, когда на неё вернулись: сервер сразу присылает
 * полный снимок, так что пропустить ничего нельзя.
 */

/** Быстрое переключение вкладок не должно рвать поток туда-обратно. */
const HIDE_GRACE_MS = 3000

export function openStream<T>(
  url: () => string,
  onData: (data: T) => void,
  onState: (ok: boolean) => void,
  label: string
): () => void {
  let es: EventSource | null = null
  let pause: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const connect = () => {
    if (es || stopped) return
    es = new EventSource(url())
    es.onmessage = e => {
      try {
        onData(JSON.parse(e.data) as T)
        onState(true)
      } catch (err) {
        console.error(`${label}: не удалось разобрать данные`, err)
      }
    }
    // EventSource переподключается сам — просто показываем, что связи нет
    es.onerror = () => onState(false)
  }
  const disconnect = () => {
    es?.close()
    es = null
  }
  const onVisibility = () => {
    clearTimeout(pause)
    if (document.hidden) pause = setTimeout(disconnect, HIDE_GRACE_MS)
    else connect()
  }

  document.addEventListener('visibilitychange', onVisibility)
  if (!document.hidden) connect()
  return () => {
    stopped = true
    clearTimeout(pause)
    document.removeEventListener('visibilitychange', onVisibility)
    disconnect()
  }
}
