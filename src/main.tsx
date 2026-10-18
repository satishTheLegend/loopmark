import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/lora/latin-400.css'
import '@fontsource/lora/latin-500.css'
import App from './App'
import './styles.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
