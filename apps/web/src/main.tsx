import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme.css'
import './styles.css'
import { loadMenu } from './data'
import { loadSettings } from './settings'

// Меню и настройки — до первого кадра: иначе гость на мгновение увидит старые
// цены и выключенные способы оплаты. Сервер молчит дольше трёх секунд —
// рисуем по тому, что в сборке.
void Promise.all([loadMenu(), loadSettings()]).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
