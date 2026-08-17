// Роли персонала и их права. Один список для сервера (он запрещает) и клиента
// (он прячет то, чего нельзя) — иначе UI и API разъезжаются.

export const ROLE = {
  MANAGER: 'manager',
  WAITER: 'waiter',
  COOK: 'cook'
}

export const ROLE_LABEL = {
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
export const PERMISSIONS = {
  manager: ['hall', 'kitchen', 'table', 'start', 'serve', 'ack', 'close', 'reset', 'log'],
  waiter: ['hall', 'kitchen', 'table', 'start', 'serve', 'ack', 'close'],
  cook: ['kitchen', 'start', 'serve']
}

export function can(role, permission) {
  return (PERMISSIONS[role] ?? []).includes(permission)
}

/** Экран, с которого сотруднику логично начинать смену. */
export function homeRoute(role) {
  if (role === ROLE.COOK) return '#/kitchen'
  return '#/hall'
}

/** Свои ли это столы: у официанта — закреплённые, у остальных — все. */
export function ownsTable(staff, tableId) {
  if (!staff) return false
  if (staff.role !== ROLE.WAITER) return true
  return (staff.tables ?? []).includes(String(tableId))
}
