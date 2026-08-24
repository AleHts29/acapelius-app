import { useSession } from './auth/session'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'

// Todavia no hay rutas: el estado de la sesion decide la pantalla. El router
// entra en la fase 1, cuando aparezcan las secciones del admin.
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
  return <HomePage />
}
