import { tableId } from '../api'

/**
 * Адреса кабинета — hash, как во всём приложении:
 *   #/admin/<раздел>   — кабинет менеджера
 *   #/hall, #/hall/6   — зал и стол
 *   #/kitchen, #/bar   — очереди кухни и бара
 * Старый `?t=6#/waiter` (экран стола 3.0) ведёт на `#/hall/6`.
 */

export type Workspace = 'admin' | 'hall' | 'kitchen' | 'bar'

export type AdminPage = 'overview' | 'shifts' | 'checks' | 'quality' | 'debts' | 'menu' | 'staff' | 'log' | 'settings' | 'close'

export const ADMIN_PAGES: { id: Exclude<AdminPage, 'close'>; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'shifts', label: 'Смены' },
  { id: 'checks', label: 'Чеки' },
  { id: 'quality', label: 'Гости и качество' },
  { id: 'debts', label: 'Долги и решения' },
  { id: 'menu', label: 'Меню' },
  { id: 'staff', label: 'Персонал' },
  { id: 'log', label: 'Журнал' },
  { id: 'settings', label: 'Настройки' }
]

export interface CabRoute {
  ws: Workspace
  page: AdminPage
  /** Открытый стол в зале. */
  table: string | null
  /** Второй сегмент адреса в разделе кабинета: смена, чек. */
  sub: string | null
}

const PAGE_IDS = new Set<string>([...ADMIN_PAGES.map(p => p.id), 'close'])

export function parseRoute(hash: string): CabRoute | null {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  const [head, a, b] = parts
  if (head === 'admin') {
    const page = (PAGE_IDS.has(a) ? a : 'overview') as AdminPage
    return { ws: 'admin', page, table: null, sub: b ?? null }
  }
  if (head === 'hall') return { ws: 'hall', page: 'overview', table: a || null, sub: null }
  if (head === 'waiter') return { ws: 'hall', page: 'overview', table: tableId, sub: null }
  if (head === 'kitchen') return { ws: 'kitchen', page: 'overview', table: null, sub: null }
  if (head === 'bar') return { ws: 'bar', page: 'overview', table: null, sub: null }
  return null
}

export function href(route: Partial<CabRoute> & { ws: Workspace }): string {
  if (route.ws === 'admin') {
    return `#/admin/${route.page ?? 'overview'}${route.sub ? `/${encodeURIComponent(route.sub)}` : ''}`
  }
  if (route.ws === 'hall') return route.table ? `#/hall/${encodeURIComponent(route.table)}` : '#/hall'
  return `#/${route.ws}`
}

export function go(route: Partial<CabRoute> & { ws: Workspace }) {
  window.location.hash = href(route)
}
