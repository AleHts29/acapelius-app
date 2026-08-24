import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { useSession } from './auth/session'
import { Layout } from './components/Layout'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SeasonDetailPage } from './pages/SeasonDetailPage'
import { SeasonsPage } from './pages/SeasonsPage'
import { UsersPage } from './pages/UsersPage'

/** Solo deja pasar al admin; el resto vuelve al inicio. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useSession()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

export function App() {
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
