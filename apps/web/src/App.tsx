import { useEffect, useRef, useState } from 'react'
import { StoreProvider, useStore } from './store'
import { Welcome } from './screens/Welcome'
import { Menu } from './screens/Menu'
import { Cart } from './screens/Cart'
import { Status } from './screens/Status'
import { Payment } from './screens/Payment'
import { Tips } from './screens/Tips'
import { Done } from './screens/Done'
import { DishSheet } from './sheets/DishSheet'
import { NameSheet } from './sheets/NameSheet'
import { SendSheet } from './sheets/SendSheet'
import { Waiter } from './Waiter'
import { Hall } from './hall/Hall'
import { Kitchen } from './kitchen/Kitchen'
import { TablePicker } from './screens/TablePicker'
import { StaffGate } from './staff/StaffGate'
import { tableId } from './api'
import { seatsOfTable } from './hallConfig'
import { QrTent } from './QrTent'
import { Toast } from './ui'

function ConnBanner() {
  const { connected, snap } = useStore()
  if (!tableId || connected || snap) return null
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 70, background: '#B00020', color: 'var(--ep-on-ink)', textAlign: 'center', fontSize: 12.5, padding: '7px 12px' }}>
      Подключаемся к серверу демо…
    </div>
  )
}

// Авто-навигация: реагируем на действия ДРУГИХ гостей, чтобы никто не «завис»
// на экране, который потерял смысл (кто-то оплатил весь стол / отправил всё на кухню).
function useAutoNav() {
  const { ui, patch, snap, totals, me, toast } = useStore()
  const lines = snap?.lines ?? []
  const hasUnsent = lines.some(l => !l.sent)
  const anySent = lines.some(l => l.sent)
  const fullyPaid = totals.tableTotal > 0 && totals.remaining <= 0.01
  const prevUnsent = useRef(hasUnsent)
  const prevPaid = useRef(fullyPaid)

  useEffect(() => {
    const unsentJustGone = prevUnsent.current && !hasUnsent && anySent
    prevUnsent.current = hasUnsent
    prevPaid.current = fullyPaid
    if (!me) return
    // Стол полностью оплачен (кем-то другим), а я на экране оплаты и сам не платил —
    // уводим на статус и при переходе, и при простом заходе на этот экран
    if (fullyPaid && ui.screen === 'payment' && ui.payStage !== 'processing' && ui.lastPaid === 0) {
      patch({ screen: 'status', payStage: 'form', sheet: null })
      toast('Стол уже полностью оплачен 🎉')
      return
    }
    // Кто-то отправил всё на кухню, пока я был в корзине
    if (unsentJustGone && ui.screen === 'cart' && ui.sheet === null) {
      patch({ screen: 'status' })
      toast('Заказ отправлен на кухню')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsent, fullyPaid, ui.screen])
}

function Guest() {
  const { ui } = useStore()
  useAutoNav()
  return (
    <div className="ep-guest">
      {ui.screen === 'welcome' && <Welcome />}
      {ui.screen === 'menu' && <Menu />}
      {ui.screen === 'cart' && <Cart />}
      {ui.screen === 'status' && <Status />}
      {ui.screen === 'payment' && <Payment />}
      {ui.screen === 'tips' && <Tips />}
      {ui.screen === 'done' && <Done />}

      {ui.sheet === 'dish' && <DishSheet />}
      {ui.sheet === 'name' && <NameSheet />}
      {ui.sheet === 'send' && <SendSheet />}

      {ui.toast && <Toast msg={ui.toast} />}
    </div>
  )
}

// Экран стола без ?t=… — заходить сюда нужно из зала
function NoTable() {
  return (
    <div className="ep-w-login">
      <div className="ep-w-login-card">
        <div className="ep-w-login-title">Стол не выбран</div>
        <div className="ep-w-login-hint">Экран стола открывается из зала — там видно, какие столы заняты.</div>
        <a className="ep-w-btn ep-w-btn--primary" style={{ display: 'inline-block', lineHeight: '42px', textDecoration: 'none' }} href="#/hall">
          Открыть зал
        </a>
      </div>
    </div>
  )
}

function useRoute(): string {
  const [route, setRoute] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

// Заголовок вкладки — по экрану и столу: раньше в титуле всегда стоял «Стол №12»
function useDocumentTitle(route: string) {
  useEffect(() => {
    const table = tableId ? `Стол №${tableId}` : null
    const title = route.startsWith('#/hall')
      ? 'EasyPay · Зал'
      : route.startsWith('#/kitchen')
        ? 'EasyPay · Кухня'
        : route.startsWith('#/waiter')
        ? `EasyPay · ${table ?? 'стол не выбран'} — экран ресторана`
        : route.startsWith('#/qr')
          ? `EasyPay · QR ${table ?? 'столов'}`
          : table
            ? `EasyPay · ${table}`
            : 'EasyPay · выберите стол'
    document.title = title
  }, [route])
}

export default function App() {
  const route = useRoute()
  useDocumentTitle(route)
  return (
    <StoreProvider>
      <ConnBanner />
      {route.startsWith('#/hall') ? (
        <StaffGate need="hall">
          <Hall />
        </StaffGate>
      ) : route.startsWith('#/kitchen') ? (
        <StaffGate need="kitchen">
          <Kitchen />
        </StaffGate>
      ) : route.startsWith('#/waiter') ? (
        tableId ? (
          <StaffGate need="table">
            <Waiter />
          </StaffGate>
        ) : (
          <NoTable />
        )
      ) : route.startsWith('#/qr') ? (
        <QrTent />
      ) : tableId && seatsOfTable(tableId) !== null ? (
        <Guest />
      ) : (
        <TablePicker />
      )}
    </StoreProvider>
  )
}
