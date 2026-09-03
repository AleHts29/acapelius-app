# Acapelius — UI Desktop (Cambio C11)

> Spec para adaptar la app a pantallas grandes. Referencia visual canónica: `design/acapelius-desktop.html` (5 frames). Mobile no cambia en nada: mismo markup, los patrones de desktop se activan por breakpoint. Tokens, chips y componentes existentes siguen vigentes.

## Breakpoints

- `< 768px` — mobile: todo queda exactamente como está (tab bar inferior, bottom sheets, FAB, listas de 1 columna).
- `768–1023px` — tablet: layout mobile con contenedor centrado `max-width: 640px`.
- `≥ 1024px` — desktop: se activa el shell y los patrones de este documento. Contenido `max-width: 1200px`.

## El shell de desktop (≥1024)

1. **Sidebar fija izquierda** (~220px, fondo blanco, borde `--line`): logo arriba, navegación vertical (Inicio / Vender / Puerta / Dirección, ítem activo con fondo crema), usuario + logout abajo. Reemplaza a la tab bar inferior, que desaparece en desktop. Misma visibilidad por rol.
2. **Header de página**: título a la izquierda; a la derecha las acciones primarias y selectores contextuales (botón "＋ Nueva venta", pill de temporada, "🕐 Historial general"). **El FAB no existe en desktop** — su acción migra al header.
3. **BottomSheet → Drawer lateral derecho**: mismo contenido y componente lógico, presentación distinta por breakpoint (panel fijo de ~300–360px o overlay deslizante desde la derecha, con ✕ y cierre por Escape/click afuera). Implementarlo como una sola pieza (`ActionPanel`) que renderiza sheet u drawer según viewport.
4. **Hover y teclado**: filas y cards interactivas con estado hover (fondo `--surface-alt` o borde), `cursor: pointer`, focus ring azul. Tooltips nativos (`title`) donde el texto se trunca.

## Patrones por pantalla

### Inicio
Hero de próxima función a ancho completo con las **stats integradas a la derecha** (vendidas, recaudó, sin asignar) y las **tres cards de categoría lado a lado** en grid de 3 columnas. Nada apilado en columna única.

### Ventas (frame 2)
- La lista pasa a **tabla densa** con encabezado sticky: Comprador (avatar+nombre) · Función · Vendedora · Entradas · Total · Estado (chip) · ⋮. Altura de fila ~46px, hover, bandas de grupo por función.
- Búsqueda + filtros en una **toolbar horizontal** con el resumen (entradas / cobrado / por cobrar) alineado a la derecha en la misma línea.
- Click en fila o ⋮ abre el **drawer** con las mismas acciones del sheet mobile; la fila seleccionada queda resaltada.
- Virtualización se mantiene (filas de tabla también se virtualizan).

### Dirección (frame 3)
- KPIs en fila de 4 (ya está bien, conservar).
- **"Necesita tu atención" en grid de 2 columnas** — 10 alertas ocupan 5 filas, no 10. Alertas con título truncable con ellipsis + tooltip.
- Funciones en **grid de 4** mini-cards.
- **Ritmo de ventas y accesos de Administración lado a lado** (grid 1.6fr/1fr): el chart gana ancho real; los accesos son una card compacta con lista de 2 columnas.

### Rendiciones y Asistencia (frame 4)
- **Master-detail**: lista a la izquierda (~330px: resumen + deudoras + al día), **detalle de la selección a la derecha** (perfil, KPIs, CTA, timeline) — sin navegar a otra página. La selección se refleja en la URL (`/direccion/rendiciones/:sellerId`) para deep-linking; en mobile esa misma URL renderiza la vista de detalle apilada.
- Asistencia usa el mismo patrón: lista de compradores a la izquierda (con toggle Ingresaron/Faltan y búsqueda), detalle de entradas del seleccionado a la derecha.

### Modo puerta (frame 5) — SIN scanner en desktop
El escaneo de QR es exclusivo de mobile: nadie escanea con la webcam de una notebook. En ≥1024 el modo puerta se convierte en la **mesa de entrada**, centrada en la búsqueda manual:
- Columna centrada `max-width: 640px`: header de función + estado de conexión, contador grande de ingresados.
- **Buscador protagonista** con autofocus al entrar: input grande, resultados como filas (comprador con match resaltado, vendedora, N entradas, chip k/N) y botón "Marcar ingreso" por fila ("Ya ingresó" deshabilitado si completó). **Keyboard-first**: ↑/↓ navega resultados, Enter marca el ingreso; mostrar el hint de teclas bajo los resultados.
- Sección **"Últimos ingresos"** en vivo (últimos ~6, con método ✋/📷 y quién registró).
- No se renderiza cámara ni botón "Escanear"; `html5-qrcode` **no se monta** en desktop (menos superficie de test con webcams). Nota al pie: "Para escanear QRs usá el celular — esta mesa resuelve búsquedas e ingresos manuales."

### Formularios (Nueva venta, sheets de registro)
En desktop, los formularios de página se centran con `max-width: 560px`; los de acción rápida (registrar rendición, nuevo usuario) van en el drawer.

## Detalles de calidad

- Tipografía y espaciados: mismos tokens; en desktop los títulos de página pueden subir un paso (22px) y las tablas usan 12.5px.
- Nada de contenido "flotando": toda vista llena su grilla o se centra con max-width intencional (640/560) — el criterio es que no haya más de ~25% de crema vacía a los lados del contenido principal en 1440px.
- El scroll es de la zona de contenido; sidebar y headers de página quedan fijos.
- Verificar todo en 1280×800 y 1440×900; el mockup está pensado a ~1200 de contenido.

## Criterios de aceptación

1. En 1440px: Ventas se ve como tabla con drawer al hacer click; no existe FAB ni bottom sheet; el resumen está en la toolbar.
2. Dirección muestra la atención en 2 columnas y el chart con ancho real.
3. `/direccion/rendiciones/5` abre master-detail en desktop y la vista de detalle en un iPhone, sin rutas duplicadas.
4. Modo puerta en desktop: sin cámara ni botón "Escanear" (html5-qrcode no montado); el buscador tiene autofocus y se puede buscar → navegar con flechas → marcar ingreso con Enter sin tocar el mouse; los últimos ingresos se actualizan en vivo.
5. En un iPhone nada cambió respecto de hoy (regresión visual cero en mobile).
6. Navegación completa por teclado en tabla y drawer; hover visible en toda fila interactiva.
