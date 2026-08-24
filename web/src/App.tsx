import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useSession } from './auth/session'
import { Layout } from './components/Layout'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { NewSalePage } from './pages/NewSalePage'
import { SalesPage } from './pages/SalesPage'
import { SeasonDetailPage } from './pages/SeasonDetailPage'
import { SeasonsPage } from './pages/SeasonsPage'
import { TicketPage } from './pages/TicketPage'
import { UsersPage } from './pages/UsersPage'

/** Solo deja pasar al admin; el resto vuelve al inicio. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useSession()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

/** Vendedoras y admin; la puerta vuelve al inicio. */
function RequireSeller({ children }: { children: ReactNode }) {
  const { user } = useSession()
  if (user?.role !== 'seller' && user?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

/** Las pantallas que piden sesion. */
function AuthenticatedApp() {
  const { user, loading, mustChangePassword } = useSession()

  if (loading) {
    return (
      <div className="centered-screen">
        <p className="muted">Cargando...</p>
      </div>
    )
  }

  if (!user) return <LoginPage />
  if (mustChangePassword) return <ChangePasswordPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route
          path="/ventas"
          element={
            <RequireSeller>
              <SalesPage />
            </RequireSeller>
          }
        />
        <Route
          path="/ventas/nueva"
          element={
            <RequireSeller>
              <NewSalePage />
            </RequireSeller>
          }
        />
        <Route
          path="/temporadas"
          element={
            <RequireAdmin>
              <SeasonsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/temporadas/:seasonId"
          element={
            <RequireAdmin>
              <SeasonDetailPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <Routes>
      {/* La pagina de la entrada es publica: va antes del gate de sesion. */}
      <Route path="/e/:saleCode" element={<TicketPage />} />
      <Route path="*" element={<AuthenticatedApp />} />
    </Routes>
  )
}
