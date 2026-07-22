import { useEffect, useState } from 'react'
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
import { QrTent } from './QrTent'
import { Toast } from './ui'

function ConnBanner() {
  const { connected, snap } = useStore()
  if (connected || snap) return null
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 70, background: '#B00020', color: '#fff', textAlign: 'center', fontSize: 12.5, padding: '7px 12px' }}>
      Подключаемся к серверу демо…
    </div>
  )
}

function Guest() {
  const { ui } = useStore()
  return (
    <div style={{ height: '100%', maxWidth: 480, margin: '0 auto', position: 'relative', background: '#F7F7F9' }}>
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

function useRoute(): string {
  const [route, setRoute] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export default function App() {
  const route = useRoute()
  return (
    <StoreProvider>
      <ConnBanner />
      {route.startsWith('#/waiter') ? <Waiter /> : route.startsWith('#/qr') ? <QrTent /> : <Guest />}
    </StoreProvider>
  )
}
