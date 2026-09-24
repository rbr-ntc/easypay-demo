import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme.css'
import './styles.css'
import { loadMenu } from './data'

// Меню — до первого кадра: иначе гость на мгновение увидит старые цены из
// сборки. Сервер молчит дольше трёх секунд — рисуем по меню из сборки.
void loadMenu().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
