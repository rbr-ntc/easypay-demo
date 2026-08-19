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

export declare const ROLE: { MANAGER: 'manager'; WAITER: 'waiter'; COOK: 'cook' }
export declare const ROLE_LABEL: Record<RoleName, string>
export declare const PERMISSIONS: Record<RoleName, Permission[]>
export declare function can(role: RoleName | undefined | null, permission: Permission): boolean
export declare function homeRoute(role: RoleName | undefined | null): string
export declare function ownsTable(staff: Staff | null, tableId: string): boolean
