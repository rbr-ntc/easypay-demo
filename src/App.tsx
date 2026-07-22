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

function Guest() {
  const { state } = useStore()
  return (
    <div style={{ height: '100%', maxWidth: 480, margin: '0 auto', position: 'relative', background: '#F7F7F9' }}>
      {state.screen === 'welcome' && <Welcome />}
      {state.screen === 'menu' && <Menu />}
      {state.screen === 'cart' && <Cart />}
      {state.screen === 'status' && <Status />}
      {state.screen === 'payment' && <Payment />}
      {state.screen === 'tips' && <Tips />}
      {state.screen === 'done' && <Done />}

      {state.sheet === 'dish' && <DishSheet />}
      {state.sheet === 'name' && <NameSheet />}
      {state.sheet === 'send' && <SendSheet />}

      {state.toast && <Toast msg={state.toast} />}
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
      {route.startsWith('#/waiter') ? <Waiter /> : route.startsWith('#/qr') ? <QrTent /> : <Guest />}
    </StoreProvider>
  )
}
