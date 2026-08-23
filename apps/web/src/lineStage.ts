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

/**
 * Цвет бейджа: одно состояние — один цвет, где бы бейдж ни стоял.
 *
 * Классы daisyUI, а не хардкод: цвета берутся из активной темы, поэтому в
 * тёмной теме бейджи остаются читаемыми сами собой.
 */
export const STAGE_BADGE: Record<LineStage, string> = {
  queued: 'badge-ghost',
  cooking: 'badge-warning',
  ready: 'badge-success',
  served: 'badge-info',
  cancelled: 'badge-error'
}
