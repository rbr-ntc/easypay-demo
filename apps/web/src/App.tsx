import { useEffect, useMemo, useRef, useState } from 'react'
import { StoreProvider, useStore } from './store'
import { Menu } from './screens/Menu'
import { Table } from './screens/Table'
import { Payment } from './screens/Payment'
import { Done } from './screens/Done'
import { DishSheet } from './sheets/DishSheet'
import { NameSheet } from './sheets/NameSheet'
import { Welcome } from './screens/Welcome'
import { CallSheet } from './sheets/CallSheet'
import { AllergySheet } from './sheets/AllergySheet'
import { Cabinet } from './cabinet/Cabinet'
import { parseRoute } from './cabinet/route'
import { TablePicker } from './screens/TablePicker'
import { ScanQr } from './screens/ScanQr'
import { tableId, tableKey } from './api'
import { seatsOfTable } from './hallConfig'
import { QrTent } from './QrTent'
import { currentSeason, seasonVars } from './guest/showcase'
import { GToast } from './guest/parts'

function ConnBanner() {
  const { connected, snap } = useStore()
  if (!tableId || connected || snap) return null
  return (
    // Полоса не накрывает шапку, а сдвигает её: раньше она ложилась поверх
    // логотипа, и первое, что видел гость, — обрезанное название заведения
    <div className="shrink-0 bg-error px-3 py-1.5 text-center text-xs text-error-content">
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
  const seenCash = useRef(new Set((snap?.payments ?? []).filter(p => p.method === 'cash' && p.receiptNo).map(p => p.receiptNo!)))

  useEffect(() => {
    const unsentJustGone = prevUnsent.current && !hasUnsent && anySent
    prevUnsent.current = hasUnsent
    prevPaid.current = fullyPaid
    if (!me) return
    // Официант только что принял мои наличные — это моя оплата, а не «стол оплачен кем-то»:
    // показываем «Спасибо» с чеком из снимка, ответа pay у наличных нет (смена №7, П3)
    // Только наличные, появившиеся с прошлого снимка: старый чек не должен уводить
    // гостя с оплаты, когда он через пару минут платит за соседа
    const fresh = (snap?.payments ?? []).filter(p => p.method === 'cash' && p.receiptNo && !seenCash.current.has(p.receiptNo))
    fresh.forEach(p => seenCash.current.add(p.receiptNo!))
    const myCash = [...fresh].reverse().find(p => p.personaId === me.id)
    if (myCash && ui.screen === 'payment' && ui.payStage !== 'processing' && ui.payStage !== 'checking') {
      patch({
        screen: 'done',
        payStage: 'form',
        payMethod: 'cash',
        sheet: null,
        lastPaid: myCash.amount,
        lastReceipt: {
          no: myCash.receiptNo!,
          at: myCash.at,
          amount: myCash.amount,
          scope: myCash.scope,
          guest: me.name,
          table: tableId ?? '',
          lines: myCash.lines ?? [],
          // Почему в чеке строк больше, чем заплачено: «поровну» и «весь стол» перечисляют весь стол (П8)
          note: myCash.scope === 'equal' ? 'поровну: ваша доля счёта; в чеке — весь стол' : myCash.scope === 'full' ? 'оплачен остаток по столу' : null
        }
      })
      return
    }
    // Стол полностью оплачен (кем-то другим), а я на экране оплаты и сам не
    // платил — уводить с оплаты некуда, кроме стола
    if (fullyPaid && ui.screen === 'payment' && ui.payStage !== 'processing' && ui.payStage !== 'checking' && ui.lastPaid === 0) {
      patch({ screen: 'table', payStage: 'form', sheet: null })
      toast('Стол уже полностью оплачен')
      return
    }
    // Кто-то отправил всё на кухню, пока я смотрел меню: на «Столе» это видно
    // сразу — черновик исчез, появилась стадия
    if (unsentJustGone && ui.screen === 'menu' && ui.sheet === null) {
      toast('Заказ отправлен на кухню')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsent, fullyPaid, ui.screen, snap?.payments.length])
}

function Guest() {
  const { ui, connected, snap, me } = useStore()
  useAutoNav()
  // Сезон и гамма — переменные корня: фон, акцент и кнопки меняют тон вместе
  const vars = useMemo(() => seasonVars(currentSeason()), [])
  return (
    <div className="ep-guest g4" data-screen={ui.screen} style={vars as React.CSSProperties}>
      {/* Без подписи из QR за стол не сесть — говорим сразу; кто уже сидит, работает как раньше */}
      {!me && snap?.keyRequired && !tableKey ? <ScanQr /> : <GuestScreens />}
    </div>
  )
}

function GuestScreens() {
  const { ui, connected, snap } = useStore()
  return (
    <>
      {ui.screen === 'welcome' && <Welcome />}
      {ui.screen === 'menu' && <Menu />}
      {ui.screen === 'table' && <Table />}
      {ui.screen === 'payment' && <Payment />}
      {ui.screen === 'done' && <Done />}

      {ui.sheet === 'dish' && <DishSheet />}
      {ui.sheet === 'name' && <NameSheet />}
      {ui.sheet === 'call' && <CallSheet />}
      {ui.sheet === 'allergies' && <AllergySheet />}

      {/* Связь пропала после того, как данные уже были: показываем последнее известное */}
      {!connected && snap && (
        <div
          role="status"
          className="absolute top-0 right-0 left-0 z-[25] px-4 py-2.5 text-center text-[13px]"
          style={{ background: '#3A2A22', color: '#FFD9CB' }}
        >
          Нет связи — показываем последнее, что знаем. Заказ и оплата подождут.
        </div>
      )}

      {ui.toast && <GToast msg={ui.toast} />}
    </>
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
    const cab = parseRoute(route)
    const title = cab
      ? `EasyPay · ${cab.ws === 'admin' ? 'Кабинет' : cab.ws === 'hall' ? 'Зал' : cab.ws === 'kitchen' ? 'Кухня' : 'Бар'}`
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
  const cab = parseRoute(route)
  return (
    <StoreProvider>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {cab ? (
        <Cabinet route={cab} />
      ) : route.startsWith('#/qr') ? (
        <QrTent />
      ) : tableId && seatsOfTable(tableId) !== null ? (
        <>
          <ConnBanner />
          <Guest />
        </>
      ) : (
        <TablePicker />
      )}
      </div>
    </StoreProvider>
  )
}
