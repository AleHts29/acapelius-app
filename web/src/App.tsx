import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { SeasonProvider } from "./season/SeasonProvider";

import { useSession } from "./auth/session";
import { Layout } from "./components/Layout";
import { puedeEntrar } from "./components/nav";
import { AttendancePage } from "./pages/AttendancePage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DireccionPage } from "./pages/DireccionPage";
import { DoorPage } from "./pages/DoorPage";
import { HomePage } from "./pages/HomePage";
import { MiPlataPage } from "./pages/MiPlataPage";
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

/**
 * Deja pasar a quien le corresponde la ruta (`puedeEntrar`, en nav.ts: la
 * misma regla que prueban los tests); el resto vuelve al inicio.
 */
function Acceso({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { pathname } = useLocation();
  if (!user || !puedeEntrar(user.role, pathname)) return <Navigate to="/" replace />;
  return children;
}

/**
 * Sin sesion se va a /entrar, que es una pagina del sitio publico y no de la
 * app (C17 §B.1). Se conserva a donde queria ir para volver despues del login.
 */
function IrAEntrar() {
  const destino = window.location.pathname + window.location.search;
  window.location.replace(
    `/entrar?next=${encodeURIComponent(destino)}`,
  );
  return (
    <div className="centered-screen">
      <p className="rs">Redirigiendo…</p>
    </div>
  );
}

/** Las pantallas que piden sesion. */
function AuthenticatedApp() {
  const { user, loading, mustChangePassword } = useSession();

  if (loading) {
    return (
      <div className="centered-screen">
        <p className="rs">Cargando…</p>
      </div>
    );
  }

  if (!user) return <IrAEntrar />;
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
                <Acceso>
                  <Suspense fallback={<p className="rs">Cargando…</p>}>
                    <DevUIPage />
                  </Suspense>
                </Acceso>
              }
            />
          )}
          <Route
            path="/direccion"
            element={
              <Acceso>
                <DireccionPage />
              </Acceso>
            }
          />
          {/* El modo puerta lo usan door, seller (puede estar en la puerta) y
            admin; el backend aplica la misma regla. */}
          <Route path="/puerta" element={<DoorPage />} />
          <Route
            path="/mi-plata"
            element={
              <Acceso>
                <MiPlataPage />
              </Acceso>
            }
          />
          <Route
            path="/puerta/:functionId"
            element={
              <Suspense
                fallback={<p className="rs">Abriendo el modo puerta…</p>}
              >
                <DoorModePage />
              </Suspense>
            }
          />
          <Route
            path="/ventas"
            element={
              <Acceso>
                <SalesPage />
              </Acceso>
            }
          />
          <Route
            path="/ventas/nueva"
            element={
              <Acceso>
                <NewSalePage />
              </Acceso>
            }
          />
          <Route
            path="/temporadas"
            element={
              <Acceso>
                <SeasonsPage />
              </Acceso>
            }
          />
          <Route
            path="/temporadas/:seasonId"
            element={
              <Acceso>
                <SeasonPage />
              </Acceso>
            }
          />
          <Route
            path="/usuarios"
            element={
              <Acceso>
                <UsersPage />
              </Acceso>
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
              <Acceso>
                <SettlementsScreen />
              </Acceso>
            }
          />
          <Route
            path="/panel/rendiciones/historial"
            element={
              <Acceso>
                <SettlementsHistoryPage />
              </Acceso>
            }
          />
          <Route
            path="/panel/rendiciones/:sellerId"
            element={
              <Acceso>
                <SettlementsScreen />
              </Acceso>
            }
          />
          <Route
            path="/panel/asistencia"
            element={
              <Acceso>
                <AttendancePage />
              </Acceso>
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
