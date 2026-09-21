import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { SeasonProvider } from "./season/SeasonProvider";

import { useSession } from "./auth/session";
import { Layout } from "./components/Layout";
import { AttendancePage } from "./pages/AttendancePage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DireccionPage } from "./pages/DireccionPage";
import { DoorPage } from "./pages/DoorPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NewSalePage } from "./pages/NewSalePage";
import { SalesPage } from "./pages/SalesPage";
import { SeasonPage } from "./pages/SeasonPage";
import { SeasonsPage } from "./pages/SeasonsPage";
import {
  SettlementsHistoryPage,
  SettlementsScreen,
} from "./pages/SettlementsPage";
import { SingleTicketPage, TicketPage } from "./pages/TicketPage";
import { UsersPage } from "./pages/UsersPage";

// El modo puerta carga la libreria de escaneo (~350 KB): se baja solo cuando
// alguien entra a /puerta/{id}, no en el login de todo el mundo.
const DoorModePage = lazy(() =>
  import("./pages/DoorModePage").then((m) => ({ default: m.DoorModePage })),
);

// La galería de componentes (C10) es una herramienta de desarrollo. El import
// tiene que quedar DENTRO de la rama, no sólo su uso: si el lazy() se evalúa
// siempre, el bundler igual emite el chunk. Con la condición como constante,
// en producción la rama se colapsa y el archivo no entra al build.
const DevUIPage = import.meta.env.DEV
  ? lazy(() =>
      import("./pages/DevUIPage").then((m) => ({ default: m.DevUIPage })),
    )
  : null;

/** Solo deja pasar al admin; el resto vuelve al inicio. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

/** Vendedoras y admin; la puerta vuelve al inicio. */
function RequireSeller({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user?.role !== "seller" && user?.role !== "admin")
    return <Navigate to="/" replace />;
  return children;
}

/** Las pantallas que piden sesion. */
function AuthenticatedApp() {
  const { user, loading, mustChangePassword } = useSession();

  if (loading) {
    return (
      <div className="centered-screen">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  if (mustChangePassword) return <ChangePasswordPage />;

  return (
    // La temporada envuelve a toda la app autenticada: cambiarla cambia lo
    // que muestran Ventas, Temporadas, Rendiciones y Equipo a la vez (C16).
    <SeasonProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route
            index
            element={
              user.role === "door" ? (
                <Navigate to="/puerta" replace />
              ) : (
                <HomePage />
              )
            }
          />
          {DevUIPage && (
            <Route
              path="/dev/ui"
              element={
                <RequireAdmin>
                  <Suspense fallback={<p className="muted">Cargando…</p>}>
                    <DevUIPage />
                  </Suspense>
                </RequireAdmin>
              }
            />
          )}
          <Route
            path="/direccion"
            element={
              <RequireAdmin>
                <DireccionPage />
              </RequireAdmin>
            }
          />
          {/* El modo puerta lo usan door, seller (puede estar en la puerta) y
            admin; el backend aplica la misma regla. */}
          <Route path="/puerta" element={<DoorPage />} />
          <Route
            path="/puerta/:functionId"
            element={
              <Suspense
                fallback={<p className="muted">Abriendo el modo puerta…</p>}
              >
                <DoorModePage />
              </Suspense>
            }
          />
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
                <SeasonPage />
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
          {/* C16: el panel de ventas no tenía contenido propio —su franja es la
            de Ventas y su agrupación, los filtros de Ventas y la columna
            "Vendidas" de Equipo—. La ruta queda redirigiendo: hay favoritos
            en celulares que apuntan acá. */}
          <Route
            path="/panel/ventas"
            element={<Navigate to="/ventas" replace />}
          />
          <Route
            path="/panel/rendiciones"
            element={
              <RequireAdmin>
                <SettlementsScreen />
              </RequireAdmin>
            }
          />
          <Route
            path="/panel/rendiciones/historial"
            element={
              <RequireAdmin>
                <SettlementsHistoryPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/panel/rendiciones/:sellerId"
            element={
              <RequireAdmin>
                <SettlementsScreen />
              </RequireAdmin>
            }
          />
          <Route
            path="/panel/asistencia"
            element={
              <RequireAdmin>
                <AttendancePage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SeasonProvider>
  );
}

export function App() {
  return (
    <Routes>
      {/* Las paginas de entradas son publicas: van antes del gate de sesion. */}
      <Route path="/e/:saleCode" element={<TicketPage />} />
      <Route path="/t/:ticketCode" element={<SingleTicketPage />} />
      <Route path="*" element={<AuthenticatedApp />} />
    </Routes>
  );
}
