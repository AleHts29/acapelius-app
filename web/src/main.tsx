import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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

const container = document.getElementById('root')
if (!container) {
  throw new Error('no se encontro #root en index.html')
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
