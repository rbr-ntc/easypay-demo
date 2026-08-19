// Роли персонала и их права. Один список для сервера (он запрещает) и клиента
// (он прячет то, чего нельзя) — иначе UI и API разъезжаются.


export type RoleName = 'manager' | 'waiter' | 'cook'

export type Permission =
  | 'hall'
  | 'kitchen'
  | 'table'
  | 'start'
  | 'serve'
  | 'ack'
  | 'close'
  | 'reset'
  | 'log'

export interface Staff {
  id: string
  name: string
  role: RoleName
  tables?: string[]
}

export const ROLE = {
  MANAGER: 'manager',
  WAITER: 'waiter',
  COOK: 'cook'
}

export const ROLE_LABEL: Record<RoleName, string> = {
  manager: 'Менеджер',
  waiter: 'Официант',
  cook: 'Повар'
}

/**
 * Права:
 *  hall / kitchen — доступ к экранам зала и кухни
 *  start / serve  — кухня взяла в работу / позиция подана
 *  ack            — принять вызов гостя
 *  close          — закрыть стол
 *  reset          — сбросить демо-стол
 *  log            — журнал действий смены
 */
export const PERMISSIONS: Record<RoleName, Permission[]> = {
  manager: ['hall', 'kitchen', 'table', 'start', 'serve', 'ack', 'close', 'reset', 'log'],
  waiter: ['hall', 'kitchen', 'table', 'start', 'serve', 'ack', 'close'],
  cook: ['kitchen', 'start', 'serve']
}

export function can(role: RoleName | undefined | null, permission: Permission): boolean {
  return (role ? PERMISSIONS[role] ?? [] : []).includes(permission)
}

/** Экран, с которого сотруднику логично начинать смену. */
export function homeRoute(role: RoleName | undefined | null): string {
  if (role === ROLE.COOK) return '#/kitchen'
  return '#/hall'
}

/** Свои ли это столы: у официанта — закреплённые, у остальных — все. */
export function ownsTable(staff: Staff | null | undefined, tableId: string | number): boolean {
  if (!staff) return false
  if (staff.role !== ROLE.WAITER) return true
  return (staff.tables ?? []).includes(String(tableId))
}
