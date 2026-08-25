# Relevamiento UI de Acapelius

Inventario completo de la interfaz actual, para usar como base de un
rediseño. Refleja el estado del codigo a la fecha (rama `main`). Fuentes:
`web/src/` (React + TS), estilos en un unico `web/src/styles.css` (~800
lineas, CSS plano con custom properties, sin framework ni libreria de
componentes).

---

## 1. Principios actuales

- **Un solo tema, oscuro.** La app se usa de noche (puerta del teatro) y desde
  el celular. No existe modo claro.
- **Mobile-first estricto.** Columna unica de `max-width: 34rem` centrada
  (`.app-main`). En desktop simplemente queda una columna angosta centrada.
- **Targets grandes**: `--tap-target: 3.25rem` (52 px) para botones e inputs.
  Inputs con `font-size: 1rem` (16 px) para que iOS no haga zoom al enfocar.
- **Tipografia del sistema** (`system-ui`), 17 px base. Sin webfonts.
- **Sin iconografia.** Casi no hay iconos: chevrones `›` de texto, checks `✓`,
  un emoji puntual (📧). El logo es la unica imagen de marca.

## 2. Tokens de diseño (`:root` en styles.css)

Paleta de marca aplicada: azul `#415DA7`, crema `#F8ECDE`, negro `#1D1D1B`.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#131316` | Fondo de pagina |
| `--surface` | `#1D1D1B` | Tarjetas, header (negro de marca) |
| `--surface-raised` | `#2A2A2D` | Hover, chips |
| `--border` | `#3B3B3E` | Bordes de tarjetas e inputs |
| `--text` | `#F8ECDE` | Texto principal (crema de marca) |
| `--text-muted` | `#AAA294` | Texto secundario (crema apagado) |
| `--accent` | `#415DA7` | Botones primarios, tabs activos, focos (azul de marca) |
| `--accent-strong` | `#5570B8` | Hover del boton primario |
| `--accent-contrast` | `#FFFFFF` | Texto sobre azul |
| `--accent-soft` | `#93A8DD` | Links/acentos de texto sobre oscuro (poco usado) |
| `--cream` / `--ink` | `#F8ECDE` / `#1D1D1B` | Tarjeta de entrada (QR) |
| `--danger` / `--danger-bg` | `#FF6B81` / `#3A1A24` | Alertas y acciones destructivas |
| `--ok` | `#4ADE80` | Verde semantico (pagado, al dia, contador) |
| `--warn` | `#FBBF24` | Ambar semantico (deudas, offline) |
| `--radius` | `14px` | Radio de tarjetas (10px en botones/inputs) |
| `--tap-target` | `3.25rem` | Alto minimo de controles |

## 3. Inventario de componentes (clases CSS)

Todo vive en `styles.css`; no hay componentes de UI abstraidos en React salvo
`NavCard`, `QRCanvas`, `ResultOverlay`, `Scanner`, `AllocationsEditor`.

### Estructura
- `.app-shell` / `.app-header` / `.app-main` — layout general. Header **no
  sticky** con logo + wordmark a la izquierda (link a `/` fuera del home),
  badge de rol + boton "Salir" a la derecha. Respeta `safe-area-inset-top`.
- `.centered-screen` — pantallas centradas (login, carga, errores publicos).
- `.card` — tarjeta angosta (26rem) para login/cambio de password.
- `.panel` — tarjeta generica de contenido. Variantes: `--success` (borde
  verde), `--voided` (opacidad 0.55).
- `.panel__label` — eyebrow: uppercase, letterspaced, chico, muted. Es el
  titulo de casi todas las tarjetas.
- `.page-title` — h1 de 1.5rem. `.page-head` — h1 + accion a la derecha.
- `.stack` — espaciado vertical entre hermanos (0.75rem).

### Controles
- `.button` — primario: azul, blanco, full-width, 52px, radio 10.
- `.button--ghost` — secundario: transparente con borde, auto-width, 40px.
- `.button--danger` — ghost con borde/texto rojo (anular).
- `.field` / `.field__label` / `.field__input` / `.field__hint` — formularios.
  Inputs sobre `--bg` (mas oscuro que la tarjeta). Selects nativos.
- `.form-grid` — 2 columnas fijas. `.form-row` — fila con boton al lado.
- `.checkbox-field` — checkbox con `accent-color` azul (cortesia).
- `.door-tabs` / `.door-tab(--active)` — segmented control de 2 opciones
  (Escanear/Buscar, Por corista/Por funcion). Activo = azul relleno.
- `.alloc-row` / `.alloc-row__input` — fila corista + input numerico chico.

### Informacion
- `.badge` — pill de estado (rol, "Anulada", "Paga (efectivo)", "Debe $X",
  "Cortesia", "Ya entro"). Siempre gris; el estado no cambia el color.
- `.alert` — caja de error (borde rojo, fondo bordo). Unico patron de error.
- `.list` / `.list__item(--static/--inactive)` — listas con separadores.
- `.nav-card` — tarjeta de navegacion (titulo + subtitulo + `›`).
- `.report-summary` / `__big` / `__ok` / `__warn` — tiles de resumen (3
  columnas; apilado <480px como label/valor por fila).
- `.report-stat(__item)` — pares "Cobrado $X · Por cobrar $Y" que envuelven
  sin cortar cifras.
- `.function-card__head/__title/__line` — cabecera de tarjeta con accion.
- `.settlement-balance(--owes)` — chip de saldo (verde/ambar).
- `.attendance-counter` / `.attendance-time` — asistencia.
- `.credentials(__line)` — credenciales en filas label/valor.
- `.link-chip` — URL larga en chip que envuelve (`overflow-wrap: anywhere`).
- `.success-actions` — grid vertical de la pantalla de exito.
- `.team-edit` — sub-formulario expandible dentro de una fila de lista.

### Modo puerta (los mas especificos)
- `.door-head` + `.door-counter(__big/__small)` — titulo + contador N/M.
- `.door-status(--offline)` — barra de conexion ("● En linea" verde / "○ Sin
  conexion" ambar) + pendientes de sync.
- `.door-scanner-wrap` + `#door-scanner` — video de camara embebido.
- `.door-overlay(--ok/--bad)` — **veredicto a pantalla completa**: fondo
  verde `#15803D` o rojo `#B91C1C`, icono ✓/✕ de 5rem, titulo 2.2rem,
  detalle, "toca para seguir". Auto-cierra (2s verde / 4s rojo) y vibra.
- `.door-ticket` — fila de resultado de busqueda manual.

### Entrada publica (QR)
- `.ticket-page(__head/__title/__meta/__buyer/__note)` — pagina publica.
- `.ticket` — tarjeta **crema con borde azul** (unica superficie clara de la
  app); QR en canvas blanco redondeado; `.ticket__label` uppercase azul;
  `.ticket__share` boton azul "Reenviar esta entrada"; `.ticket__void`.
- `.login-logo` — wordmark en login y paginas publicas.

## 4. Mapa de rutas y acceso

| Ruta | Pantalla (archivo) | Acceso |
|---|---|---|
| `/e/:saleCode` | TicketPage | **Publica** (token en URL) |
| `/t/:ticketCode` | SingleTicketPage | **Publica** (token en URL) |
| — | LoginPage | Sin sesion (cualquier ruta privada) |
| — | ChangePasswordPage | Sesion con password provisoria (bloquea todo) |
| `/` | HomePage | Todos los roles (contenido segun rol) |
| `/puerta` | DoorPage | Todos los roles |
| `/puerta/:functionId` | DoorModePage (lazy, ~370KB scanner) | Todos los roles |
| `/ventas` | SalesPage | Corista + Direccion |
| `/ventas/nueva` | NewSalePage | Corista + Direccion |
| `/temporadas` | SeasonsPage | Direccion |
| `/temporadas/:seasonId` | SeasonDetailPage | Direccion |
| `/usuarios` | UsersPage | Direccion |
| `/panel/ventas` | SalesReportPage | Direccion |
| `/panel/rendiciones` | SettlementsPage | Direccion |
| `/panel/asistencia` | AttendancePage | Direccion |
| `*` | redirect a `/` | — |

**Navegacion:** no hay menu ni tab bar. Todo sale del hub del home
(`.nav-card`s) y se vuelve con el "‹ Acapelius" del header. Maximo 2 niveles
de profundidad.

## 5. Pantalla por pantalla

### LoginPage
Centrada. Wordmark grande, subtitulo "Entradas del coro", email + password,
boton "Entrar". Error como `.alert`. Autofocus en email.

### ChangePasswordPage
Centrada. "Elegi tu contrasena" + saludo por nombre. Password provisoria,
nueva (min 8, hint), repetir. Botones "Guardar y entrar" y "Salir".
Validacion local (coincidencia, largo) + errores del server.

### HomePage (hub)
Orden vertical:
1. Panel "Sesion iniciada" (nombre + email).
2. *Solo corista:* "Mis entradas asignadas" (funcion → vendidas/asignadas ✓)
   y "Mi saldo a rendir" (monto ambar o "Al dia" verde + desglose).
3. Nav-card "Modo puerta" (todos).
4. *Corista y Direccion:* "Nueva venta (o cortesia)" + "(Mis) Ventas".
5. *Solo Direccion:* "Panel de ventas", "Rendiciones", "Asistencia",
   "Temporadas y funciones", "Usuarios".
6. Panel "Todavia no disponible" (roadmap textual por rol).

El home del admin ya acumula **7 nav-cards** + paneles: es la pantalla mas
larga y el principal candidato a re-estructura de navegacion.

### NewSalePage
Formulario en un panel: select de funcion (fecha — nombre), nombre del
comprador, email opcional (hint), telefono + cantidad en `.form-grid`,
checkbox "Cortesia" (solo admin), total calculado en vivo, submit.
**Pantalla de exito** (reemplaza el form): panel verde con estado del email
(enviado 📧 / fallo `.alert` / sin email), boton "Compartir por WhatsApp"
(Web Share API → fallback portapapeles), URL en `.link-chip`, y abajo
"Registrar otra venta" + "Ir a mis ventas".

### SalesPage
`.page-head` con boton "Nueva venta". Lista de `.panel`s por venta:
comprador, cantidad + fecha de funcion (+ "vendio X" si sos admin), badge de
estado (Debe $X / Paga (metodo) / Cortesia / Anulada). Acciones como fila de
ghost-buttons que envuelve: Pago efectivo / Pago transferencia (o "Volver a
pendiente"), Copiar link, Reenviar email (si hay email), Anular (admin,
`window.confirm`). Venta anulada → panel al 55% sin acciones. Sin
paginacion ni filtros.

### SeasonsPage
Form inline nombre + "Crear" (`.form-row`). Lista de temporadas → detalle.

### SeasonDetailPage
Boton "Agregar funcion" (abre form en panel: lugar, fecha `datetime-local`,
cupo + precio en grid, nombre opcional). Tarjetas de funcion: nombre/lugar,
fecha, "Cupo N · $P por entrada", boton "Editar" (form inline con mismos
campos) y "Asignar entradas a coristas" → `AllocationsEditor`: fila por
corista activa con input numerico y "Guardar" (aparece al cambiar), progreso
"vendio X de Y ✓". 0 borra.

### UsersPage
1. *Tras crear:* panel verde de credenciales (filas email/contrasena) +
   "Copiar mensaje para WhatsApp" (mensaje armado completo).
2. Form de alta: nombre, email, rol (Corista/Puerta/Direccion).
3. "Equipo": lista con nombre (+" · inactiva"), email, "todavia no entro",
   badge de rol, "Editar" → sub-form expandible (nombre+rol en grid, email,
   Guardar, Desactivar/Reactivar con confirm). Inactivas al 45%.

### DoorPage
"Elegi la funcion de hoy" + nav-cards de funciones.

### DoorModePage (la pantalla critica)
- Cabecera: nombre de funcion + contador `N / M` (verde, 2rem).
- Barra de estado: en linea/offline + "N sin sincronizar".
- Segmented: **Escanear** (video camara full-width, esquinas redondeadas) /
  **Buscar por nombre** (search con autofocus → filas comprador/corista con
  boton "Marcar ingreso" o badge "Ya entro"/"Anulada"; max 20 resultados).
- Overlay fullscreen verde/rojo con veredicto (ver §3).
- Comportamientos: wake lock (pantalla prendida), offline-first (IndexedDB +
  cola + sync), refresco 30s, dedupe de lecturas repetidas (3s).

### SalesReportPage
Tiles Vendidas (+cortesias) / Cobrado (verde) / Por cobrar (ambar) →
apiladas en angosto. Segmented "Por corista"/"Por funcion". Tarjetas por
grupo: titulo, badge de cantidad, stats de cobrado/por cobrar.

### SettlementsPage
Select de temporada (si hay >1). Tarjeta por corista: nombre + chip de saldo
("Debe $X" ambar / "Al dia" / "A favor $X"), desglose cobro/rindio/por
cobrar, "Registrar rendicion" → form inline (monto con placeholder = saldo,
metodo, nota). Historial: quien rindio cuanto, como, nota, fecha.

### AttendancePage
Select de funcion (default: la mas cercana a hoy). Contador grande
"N / M ingresaron" (self-refresh 15s). Lista: comprador (+badge Cortesia),
"le vendio X · escaneado/manual por Y", hora tabular a la derecha.

### TicketPage (`/e/`) y SingleTicketPage (`/t/`)
Publicas, centradas, max 24rem. Wordmark, nombre de funcion, fecha + lugar,
comprador. Tarjetas `.ticket` crema: QR canvas 240px, "ENTRADA N DE M",
boton "Reenviar esta entrada" (solo en `/e/` con >1). Anulada → `.alert`.
Nota al pie "Entrada general, sin numerar...".

## 6. Email de la entrada

HTML inline-styles (clientes de correo): fondo crema, cabecera azul con
logo, tarjeta blanca con nombre de funcion + fecha/lugar, saludo, una
tarjeta crema con borde azul por entrada (QR hosteado 220px + "Reenviar solo
esta entrada →"), boton azul "Ver mis entradas online", nota legal chica.
Adjuntos: un PNG por QR. Version texto plano equivalente.

## 7. Comportamientos que el rediseño debe respetar

- **Offline en puerta**: el escaneo nunca depende de la red; todo estado
  visible (contador, "sin sincronizar", busqueda) sale de IndexedDB + cola.
- **Overlay de veredicto**: legible a un metro, de noche, en 1 segundo.
  Verde/rojo + vibracion es el contrato; cualquier rediseño lo mantiene.
- **PWA instalada** (standalone, sin chrome del browser): el header propio es
  la unica navegacion. `safe-area-inset` en header y main.
- **Camara**: requiere HTTPS; el video define el layout del modo escanear.
- **iOS**: inputs ≥16px (zoom), `datetime-local` con appearance none.
- **QR sobre blanco**: la zona del QR necesita fondo claro si o si.
- **Scanner lazy**: `/puerta/:id` carga ~370KB extra; el resto no lo paga.
- **Sesiones de 30 dias** + cambio de password forzado al primer ingreso
  (pantalla bloqueante).
- **Textos en es-AR sin tildes** (decision actual, revisable): voseo, plata
  formateada `$ 8.000`, fechas "viernes 5 de diciembre, 21:00".

## 8. Friccion conocida (input para el rediseño)

1. **Navegacion**: sin menu persistente; el admin apila 7 nav-cards en el
   home y todo retorno pasa por el header. Candidato natural: tab bar o
   menu por secciones.
2. **Header no sticky** y sin titulo contextual (el titulo esta en el body).
3. **`safe-area-inset-top` falta en `.ticket-page`**: en iPhone el contenido
   de la entrada publica se mete bajo el notch (visto en capturas reales).
4. **Badges monocromo**: "Debe $90.000" y "Paga" se ven iguales; el estado
   no usa color semantico en las pills.
5. **Sin estados de carga diseñados**: texto "Cargando..." plano; sin
   skeletons ni spinners.
6. **Listados sin paginacion/filtros/busqueda** (ventas crece toda la
   temporada).
7. **Confirmaciones con `window.confirm`** nativo (anular, desactivar).
8. **Feedback de copiado** = cambio de label del boton (sin toast).
9. **Formularios largos en una columna** con scroll (nueva venta, funcion).
10. **Sin iconos**: los nav-cards y acciones son solo texto; escaneabilidad
    baja con muchas tarjetas.
11. **Desktop desaprovechado**: columna de 34rem centrada para todo.
12. **Tildes omitidas** en toda la UI por decision tecnica temprana.
13. **`window.location.origin` para links publicos**: correcto, pero la UI
    no muestra QR de la venta en pantalla del vendedor (solo link).
