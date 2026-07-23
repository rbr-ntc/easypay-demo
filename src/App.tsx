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
import { QrTent } from './QrTent'
import { Toast } from './ui'

function ConnBanner() {
  const { connected, snap } = useStore()
  if (connected || snap) return null
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
    <div style={{ height: '100%', maxWidth: 480, margin: '0 auto', position: 'relative', background: 'var(--ep-bg)' }}>
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
