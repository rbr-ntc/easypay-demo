import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { StaffLogin } from './StaffLogin'
import { homeRoute, ROLE_LABEL } from '@easypay/domain/roles'
import type { Permission } from '@easypay/domain/roles'

function Checking() {
  return (
    <div className="cab flex min-h-full items-center justify-center gap-3 p-5 text-c-mute">
      <span className="loading loading-spinner" /> Проверяем смену…
    </div>
  )
}

const SCREEN_LABEL: Partial<Record<Permission, string>> = {
  hall: 'зал',
  kitchen: 'кухня',
  table: 'экран стола',
  log: 'кабинет'
}

function NoAccess({ need }: { need: Permission }) {
  const { staff, signOutStaff } = useStore()
  const role = staff?.role
  return (
    <div className="cab flex min-h-full items-center justify-center p-5">
      <div className="c-card w-full max-w-sm p-6 text-center">
        <h2 className="text-[20px] font-bold">Экран недоступен</h2>
        <p className="mt-2 text-[14px] text-c-mute">
          {staff?.name}, роли «{role ? ROLE_LABEL[role] : '—'}» раздел «{SCREEN_LABEL[need] ?? need}» не открыт.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <a className="flex h-11 items-center justify-center rounded-xl bg-c-ink text-[15px] font-bold text-white" href={homeRoute(role)}>
            К своему экрану
          </a>
          <button className="h-11 rounded-xl border border-c-line bg-c-card text-[15px]" onClick={() => void signOutStaff()}>
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
