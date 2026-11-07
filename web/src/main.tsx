import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App'
import { SessionProvider } from './auth/session'
import { applyNav } from './lib/sidenav'
import { applyTheme, getTheme } from './lib/theme'
import { Avisos, avisar } from './ui/Aviso'
import './styles.css'

declare module '@tanstack/react-query' {
  interface Register {
    // El texto del aviso verde cuando sale bien; false para no avisar (entrar,
    // salir, o pantallas que ya muestran su propio resultado).
    mutationMeta: { exito?: string | false }
  }
}

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      const exito = mutation.meta?.exito
      if (exito !== false) avisar(exito ?? 'Cambios guardados')
    },
  }),
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

// El modo de color se aplica antes de pintar: sin flash del modo equivocado.
applyTheme(getTheme())
// Lo mismo con el menú lateral: abierto o riel, sin saltar al cargar.
applyNav()

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
        <Avisos />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
