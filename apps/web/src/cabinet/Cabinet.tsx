import type { Permission } from '@easypay/domain/roles'
import { StaffGate } from '../staff/StaffGate'
import { ADMIN_PAGES, type CabRoute } from './route'
import { Shell } from './Shell'
import { HallPage } from './HallPage'
import { TableView } from './TableView'
import { KitchenPage } from './KitchenPage'
import { AdminPage } from './admin/AdminPage'

/** Какое право нужно, чтобы открыть рабочее место. */
const NEED: Record<CabRoute['ws'], Permission> = {
  admin: 'log',
  hall: 'hall',
  kitchen: 'kitchen',
  bar: 'kitchen'
}

function titleOf(route: CabRoute): string {
  if (route.ws === 'kitchen') return 'Кухня'
  if (route.ws === 'bar') return 'Бар'
  if (route.ws === 'hall') return route.table ? `Зал · стол ${route.table}` : 'Зал'
  if (route.page === 'close') return 'Закрытие смены'
  return ADMIN_PAGES.find(p => p.id === route.page)?.label ?? 'Кабинет'
}

export function Cabinet({ route }: { route: CabRoute }) {
  return (
    <StaffGate need={NEED[route.ws]}>
      <Shell route={route} title={titleOf(route)}>
        {route.ws === 'hall' && (route.table ? <TableView id={route.table} /> : <HallPage />)}
        {route.ws === 'kitchen' && <KitchenPage station="kitchen" />}
        {route.ws === 'bar' && <KitchenPage station="bar" />}
        {route.ws === 'admin' && <AdminPage route={route} />}
      </Shell>
    </StaffGate>
  )
}
