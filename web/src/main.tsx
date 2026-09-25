import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App'
import { SessionProvider } from './auth/session'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // En la puerta la red va y viene; reintentar una sola vez alcanza y no
      // deja la pantalla colgada.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// La shell cacheada permite abrir el modo puerta sin conexion. Solo en el
// build de produccion: en dev el service worker pelearia con Vite.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })
  })
}

// La app vive bajo /app (C17 §B.1). Las paginas publicas de entradas (/e/,
// /t/) quedan en la raiz —hay links en emails ya enviados— y son las unicas
// rutas del SPA sin el prefijo.
const basename = /^\/(e|t)\//.test(window.location.pathname) ? '/' : '/app'

const container = document.getElementById('root')
if (!container) {
  throw new Error('no se encontro #root en index.html')
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
