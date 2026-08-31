import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { StaffLogin } from './StaffLogin'
import { homeRoute, ROLE_LABEL } from '@easypay/domain/roles'
import type { Permission } from '@easypay/domain/roles'

function Checking() {
  return (
    <div className="ep-forest flex min-h-full items-center justify-center gap-3 p-5" style={{ color: '#9FB5A8' }}>
      <span className="loading loading-spinner" /> Проверяем смену…
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
    <div className="ep-forest flex min-h-full items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-[22px] p-1" style={{ background: '#0C2C21' }}>
        <div className="card-body items-center text-center">
          <h2 className="card-title">Экран недоступен</h2>
          <p className="text-sm" style={{ color: '#9FB5A8' }}>
            {staff?.name}, роли «{role ? ROLE_LABEL[role] : '—'}» раздел «{SCREEN_LABEL[need] ?? need}» не открыт.
          </p>
          <div className="card-actions mt-2 w-full flex-col">
            <a className="btn btn-block btn-primary" href={homeRoute(role)}>
              К своему экрану
            </a>
            <button className="btn btn-block" onClick={() => void signOutStaff()}>
              Выйти из смены
            </button>
          </div>
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
