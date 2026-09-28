import type { CabRoute } from '../route'
import { Overview } from './Overview'
import { CloseShift } from './CloseShift'
import { Debts } from './Debts'
import { Shifts } from './Shifts'
import { Checks } from './Checks'
import { Log } from './Log'
import { MenuPage } from './menu/MenuPage'
import { StaffPage } from './StaffPage'
import { SettingsPage } from './SettingsPage'
import { Quality } from './Quality'

/** Раздел кабинета по адресу `#/admin/<раздел>/<под-адрес>`. */
export function AdminPage({ route }: { route: CabRoute }) {
  switch (route.page) {
    case 'overview':
      return <Overview />
    case 'close':
      return <CloseShift />
    case 'debts':
      return <Debts />
    case 'shifts':
      return <Shifts id={route.sub} />
    case 'checks':
      return <Checks shift={route.sub} />
    case 'quality':
      return <Quality />
    case 'log':
      return <Log />
    case 'menu':
      return <MenuPage />
    case 'staff':
      return <StaffPage />
    case 'settings':
      return <SettingsPage />
  }
}
