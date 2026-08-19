import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { StaffLogin } from './StaffLogin'
import { homeRoute, ROLE_LABEL } from '@easypay/domain/roles'
import type { Permission } from '@easypay/domain/roles'

function Checking() {
  return (
    <div className="ep-w-login">
      <div className="ep-w-login-card ep-w-login-hint">Проверяем смену…</div>
    </div>
  )
}

const SCREEN_LABEL: Partial<Record<Permission, string>> = {
  hall: 'зал',
  kitchen: 'кухня',
  table: 'экран стола',
  log: 'журнал смены'
}

function NoAccess({ need }: { need: Permission }) {
  const { staff, signOutStaff } = useStore()
  const role = staff?.role
  return (
    <div className="ep-w-login">
      <div className="ep-w-login-card ep-s-denied">
        <div className="ep-w-login-title">Экран недоступен</div>
        <div className="ep-w-login-hint">
          {staff?.name}, роли «{role ? ROLE_LABEL[role] : '—'}» раздел «{SCREEN_LABEL[need] ?? need}» не открыт.
        </div>
        <a className="ep-w-btn ep-w-btn--primary" style={{ display: 'inline-block', lineHeight: '42px', textDecoration: 'none' }} href={homeRoute(role)}>
          К своему экрану
        </a>
        <div style={{ marginTop: 12 }}>
          <button className="ep-w-btn ep-w-btn--quiet" onClick={() => void signOutStaff()}>
            Выйти из смены
          </button>
        </div>
      </div>
    </div>
  )
}

/** Пускает на экран только сотрудника с нужным правом. */
export function StaffGate({ need, children }: { need: Permission; children: ReactNode }) {
  const { staff, staffChecked, checkStaff, may } = useStore()

  useEffect(() => {
    void checkStaff()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!staff) return staffChecked ? <StaffLogin /> : <Checking />
  if (!may(need)) return <NoAccess need={need} />
  return <>{children}</>
}
