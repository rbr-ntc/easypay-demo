import type { ServerLine } from './api'

/**
 * Одно слово о состоянии блюда — на все экраны сразу.
 *
 * Раньше каждый экран называл его по-своему: в корзине висело «Готовится»
 * на позиции, которую повар даже не взял в работу, а на экране статуса та же
 * позиция честно называлась «В очереди». Гость видел два разных ответа на
 * один вопрос и переставал верить обоим.
 */
export type LineStage = 'queued' | 'cooking' | 'ready' | 'served' | 'cancelled'

export function lineStage(line: Pick<ServerLine, 'sent' | 'served' | 'startedAt' | 'readyAt' | 'cancelled'>): LineStage {
  if (line.cancelled) return 'cancelled'
  if (line.served) return 'served'
  if (line.readyAt) return 'ready'
  if (line.startedAt) return 'cooking'
  return 'queued'
}

/** Как это называется для гостя. Для персонала подписи те же, только капсом. */
export const STAGE_LABEL: Record<LineStage, string> = {
  queued: 'В очереди',
  cooking: 'Готовится',
  ready: 'Несут',
  served: 'Подано',
  cancelled: 'Отменено'
}

export const stageLabel = (line: Parameters<typeof lineStage>[0]) => STAGE_LABEL[lineStage(line)]

/** Цвета бейджа: одно состояние — один цвет, где бы он ни стоял. */
export const STAGE_TINT: Record<LineStage, { bg: string; fg: string }> = {
  queued: { bg: '#EDEDF2', fg: '#55555F' },
  cooking: { bg: '#FFF2DA', fg: '#8A5D00' },
  ready: { bg: '#E4F4E8', fg: '#1F6B35' },
  served: { bg: '#E9EEF8', fg: '#2A4B85' },
  cancelled: { bg: '#FDECEC', fg: '#9B1C1C' }
}
