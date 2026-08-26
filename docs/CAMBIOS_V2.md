# Acapelius — Cambios v2 (UX + funcionalidad)

> Paquete de iteración sobre la app ya construida. Complementa (no reemplaza) `acapelius-spec.md` y `DESIGN_SYSTEM.md`. Cada cambio referencia su mockup HTML en `design/` — **el mockup es la referencia visual canónica** de ese cambio. Los tokens, tipografías y componentes existentes del design system siguen vigentes; acá se agregan componentes nuevos (§10) que deben construirse una vez en `src/ui/` y reusarse.

Orden de implementación recomendado: C4 (bug) → C10 (componentes comunes) → C1/C2 → C3 → C8 (backend primero) → C5 → C6 → C7 → C9.

---

## C1 — Eliminar duplicado de "Nueva venta" en el inicio

La pestaña **Vender** de la tab bar es el acceso canónico para registrar una venta. En la home (Inicio), la card de categoría **Ventas** ya no muestra el ítem "Nueva venta o cortesía".

**Aceptación:** en Inicio no existe ningún link "Nueva venta"; la pestaña Vender funciona igual que antes.

## C2 — Card "Mis ventas" del inicio, expandida

La card de categoría Ventas del inicio pasa a centrarse en **Mis ventas** con accesos por acción visibles como sub-ítems: **Pagos pendientes** (con contador, filtra el listado en "Deben"), **Links y reenvíos**, y acceso general al listado. Los sub-ítems navegan al listado de C3 con el filtro correspondiente preaplicado vía query param (ej: `/ventas?filtro=deben`).

**Aceptación:** desde Inicio, "Pagos pendientes" abre el listado ya filtrado en Deben; el badge de la card muestra la cantidad de ventas pendientes del usuario (o globales si es admin).

## C3 — Listado de Ventas escalable

**Mockup:** `design/acapelius-ventas-listado.html`

La pestaña Vender muestra por defecto el **listado de ventas** (las propias para corista; todas para admin) con:
1. **Tira resumen** arriba: entradas vendidas, cobrado, por cobrar.
2. **Búsqueda + filtros sticky** al scrollear. La búsqueda matchea `buyer_name` **y** nombre de la vendedora (case/acentos-insensible), con resalte del match y resultados agrupados por tipo de match. Filtros chip: Todas / Deben (con contador) / Pagas / Cortesías + selector de función.
3. **Filas mínimas agrupadas por función**: avatar iniciales, nombre, "N entradas · vendió X", chip de estado. Virtualizar con `@tanstack/react-virtual` a partir de ~50 filas.
4. **Acciones en bottom sheet** (tap en fila o "⋮"): Marcar pagó efectivo / Marcar pagó transferencia / Copiar link / Reenviar email (mostrando cuándo fue el último envío) / Anular (confirmación destructiva). Nada de botones en la fila.
5. **FAB "＋ Nueva venta"** abre el formulario de registro (el actual).

**Backend:** `GET /api/sales` acepta `q` (búsqueda), `status` (`pending|paid|comp`), `function_id`, paginación por cursor. Devuelve además el agregado del resumen y el timestamp del último email por venta (de la tabla de envíos).

**Aceptación:** con 200 ventas de seed, el listado scrollea fluido; buscar "caro" devuelve ventas de Carolina y compradoras que matcheen; el sheet muestra "enviado hace N días"; los filtros y la búsqueda componen.

## C4 — Fix: cámara del modo puerta no se ve

Diagnóstico y corrección (en este orden de probabilidad):
1. **Contexto seguro:** `getUserMedia` solo funciona en HTTPS o localhost. Documentar y dejar listo dev con HTTPS (`vite-plugin-mkcert` o instrucción de túnel) en el README. En producción (Fly) ya hay HTTPS.
2. **Gesto de usuario:** `Html5Qrcode.start()` debe dispararse desde un tap ("Escanear"), no en un `useEffect` de montaje (iOS Safari lo bloquea).
3. **Contenedor:** el div de la cámara debe tener dimensiones reales antes de `start()` y ningún elemento (fondo crema, borde punteado, overlay) encima del `<video>` inyectado; revisar z-index/posicionamiento.
4. **Config y errores:** `facingMode: "environment"`; capturar y loguear el error de `start()`; **nunca fallar en silencio**.

**Estados de UI obligatorios del viewfinder:** `iniciando` (spinner) / `activo` (video visible) / `sin permiso` (mensaje + cómo habilitarlo en iOS/Android) / `no disponible` (sin cámara o contexto inseguro → mensaje + destacar "Buscar nombre" como camino principal).

**Aceptación:** en un iPhone real vía HTTPS, tocar "Escanear" muestra el video de la cámara trasera en <2s y escanea un QR; con permiso denegado se ve el estado explicativo, no un recuadro vacío.

## C5 — Rendiciones v2: prioridad + historial por corista

**Mockup:** `design/acapelius-rendiciones-v2.html`

1. **Listado principal:** tira resumen (total por rendir, barra rendido/cobrado) → sección "Deben rendir" (cards con borde ámbar, detalle cobró/rindió y CTA "Registrar rendición") → sección "Al día" (filas compactas, chip verde, **sin botón**). El "por cobrar" de compradores se muestra como nota secundaria separada de la deuda, con el texto "no exigible aún". Botón pill **"Historial"** junto al título.
2. **Detalle por corista** (tap en cualquier fila/card): perfil con KPIs cobró/rindió/debe, chip de estado, **CTA "Registrar rendición" siempre disponible** (cubre correcciones), nota de por cobrar, y su timeline personal de rendiciones.
3. **Historial general** (desde el botón): cronológico, agrupado por día, chips de filtro por corista. Misma query con/sin `seller_id`.
4. **Sheet de registro:** monto precargado con la deuda + chip "Todo ($X)" / "Otra cifra", segmento Transferencia/Efectivo, nota opcional, CTA con el monto, y preview "Después de esto X queda al día" cuando el monto salda la deuda.
5. Filas de historial: ícono, "X rindió **$N** · método", nota en cursiva debajo, fecha/hora compacta a la derecha.

**Backend:** `GET /api/settlements` acepta `seller_id` opcional y devuelve orden cronológico descendente; el reporte de rendiciones expone por corista: cobrado, rendido, saldo, y por-cobrar-de-compradores como campo separado.

**Aceptación:** una corista al día no muestra botón en el listado pero sí en su detalle; registrar el monto exacto de la deuda la mueve a "Al día" sin recargar; el historial general filtrado por corista coincide con su timeline del detalle.

## C6 — Asistencia v2: por comprador, toggle Ingresaron/Faltan

**Mockup:** `design/acapelius-asistencia.html`

1. **Una fila por comprador (venta), no por entrada.** Contador chip `k/N` (verde si k=N, ámbar si parcial), método del último ingreso (📷 escaneo / ✋ manual — iconos lucide, no emoji), hora del último ingreso, vendedora.
2. **Tap expande** el detalle por entrada: estado, hora, método, quién registró.
3. **Toggle Ingresaron / Faltan** con contadores. "Faltan" lista ventas con entradas sin usar (incluye parciales tipo 2/3) mostrando cuántas faltan y la vendedora.
4. **Búsqueda sticky** por comprador o vendedora (mismo componente y comportamiento que C3).
5. **Header vivo:** contador grande N/M con barra de ocupación, punto "EN VIVO" pulsando durante el polling (reemplaza el texto "se actualiza solo"), y segunda lectura "X de Y compradores completos". Selector de función como pill compacta junto al título.

**Backend:** el endpoint de asistencia devuelve datos agrupados por venta: comprador, vendedora, `is_comp`, total de entradas, y por entrada su check-in (hora, método, usuario) o null. El polling sigue como está.

**Aceptación:** un comprador con 3 entradas y 2 ingresos aparece una vez como "2/3"; el toggle Faltan lo incluye mostrando "falta 1 de 3"; buscar por vendedora filtra ambas pestañas.

## C7 — Equipo (ex Usuarios): lista primero, alta en sheet

**Mockup:** `design/acapelius-usuarios-cupos.html` (pantallas 1 y 2)

1. Renombrar la sección a **"Equipo"**. La vista abre con el listado agrupado por rol (Dirección / Coristas / Puerta): avatar, nombre, email, chip de rol.
2. Chip ámbar **"Invitación pendiente"** para usuarios que nunca hicieron login (usar `last_login_at` nullable — agregarlo a `users` y setearlo en cada login; `must_change_password` no alcanza porque también aplica a resets).
3. **FAB "＋ Nuevo usuario"** abre sheet: nombre, email, rol como segmento de 3, CTA "Crear y enviar invitación" + hint del email con contraseña temporal.
4. **Tap en un usuario → detalle:** editar nombre/rol, **Reenviar invitación** (si pendiente), **Resetear contraseña**, **Desactivar** (soft: `is_active`, bloquea login; nunca borrar, tiene ventas asociadas).

**Backend:** migración `users` + `last_login_at`, `is_active`; `POST /api/users/{id}/resend-invite`; `POST /api/users/{id}/reset-password`; `PATCH /api/users/{id}` para rol/estado. El alta ya existente pasa a disparar el email de invitación (driver log en dev).

**Aceptación:** Josefina recién creada aparece con chip pendiente; tras su primer login el chip desaparece; un usuario desactivado no puede loguearse y no aparece en asignaciones de cupo.

## C8 — Cupos de venta asignados por Eli (allocations) — CAMBIO DE BACKEND

**Mockup:** `design/acapelius-usuarios-cupos.html` (pantallas 3 y 4)

**Regla de negocio (modo estricto):** una corista solo puede vender entradas que dirección le asignó para esa función. Sin cupo asignado → no puede registrar ventas de esa función. Los usuarios con rol dirección venden sin límite de cupo personal (siempre contra `capacity`). **Las cortesías no consumen cupo personal** (sí validan contra capacity).

**Modelo:**
```sql
allocations (
  id          BIGSERIAL PRIMARY KEY,
  function_id BIGINT NOT NULL REFERENCES functions(id),
  seller_id   BIGINT NOT NULL REFERENCES users(id),
  quantity    INTEGER NOT NULL CHECK (quantity >= 0),
  UNIQUE (function_id, seller_id)
)
```

**Invariantes (validar en transacción, con lock de la función igual que capacity):**
1. `SUM(allocations.quantity)` de una función ≤ `functions.capacity`.
2. Ventas no-cortesía de una corista en una función ≤ su allocation. Se valida en `POST /api/sales` dentro de la misma transacción que ya valida capacity.
3. No se puede reducir una allocation por debajo de lo ya vendido por esa corista (el server rechaza; la UI deshabilita el "−" al llegar y muestra "no podés bajar de N").
4. Anular tickets devuelve el cupo automáticamente (se deriva contando ventas no anuladas; **no** llevar contador desnormalizado).

**API:** `GET /api/functions/{id}/allocations` (lista coristas activas con asignado y vendido) · `PUT /api/functions/{id}/allocations` (upsert batch, valida invariantes) · `GET /api/me/allocations?function_id=` (cupo y restante de la corista logueada). Errores con códigos distinguibles (`allocation_exceeded`, `allocation_below_sold`, `no_allocation`).

**UI Eli — "Asignar entradas"** (desde la card de función): barra apilada asignadas / ya vendidas / sin asignar + "QUEDAN N"; fila por corista con stepper y subtexto "Vendió X de Y"; guardar batch. Estados de error inline.

**UI corista — Vender:** banner azul "Te quedan X de Y para {función} · Asignadas por dirección". El stepper de cantidad se frena en `min(restante_cupo, restante_capacity)` con mensaje "Llegaste a tu cupo. Si necesitás más, pedile a Eli." Si no tiene allocation para la función elegida: la función se muestra deshabilitada en el selector con "Sin cupo asignado" y no se puede enviar.

**Aceptación:** el server rechaza una venta que exceda el cupo aunque el cliente lo intente por API directa; asignar 20+15+10+15 sobre capacity 80 deja "QUEDAN 20"; bajar a Josefina (vendió 15) a 14 falla con `allocation_below_sold`; una cortesía de Eli no descuenta cupo de nadie; test de concurrencia: dos ventas simultáneas de la misma corista no superan su cupo.

## C9 — Panel de Dirección v2: asistente, no tablero

**Mockup:** `design/acapelius-direccion.html`

1. **Selector de temporada** como pill junto al título (reemplaza el texto estático).
2. **KPIs compactos 2×2** con contexto: "$X POR RENDIR · en manos de N coristas"; "vendidas **131/160**" contra cupo total de la temporada.
3. **Sección "Necesita tu atención"**: lista de alertas accionables con borde de color, ícono, título, contexto temporal y link directo. Fuentes de la v1 de esta sección:
   - Rendición pendiente: "{corista} debe rendir $X · cobró hace N días" → registro.
   - Cupo sin asignar: "{función}: N entradas sin asignar" → pantalla de asignación (C8).
   - Invitación pendiente: "{usuario} nunca entró a la app · invitada hace N días" → reenviar (C7).
   Cuando no hay ninguna: card verde "Todo en orden · Sin rendiciones pendientes ni tareas abiertas".
4. **"La temporada, función por función"**: mini-card por función con barra de venta, vendidas/cupo, recaudado; badge HOY (verde) / HECHA (atenuada, con ingresados finales); "N sin asignar" cuando aplique. Tap → detalle de función.
5. **Ritmo de ventas**: barras de entradas vendidas por día, últimos 14 días, con delta semanal. Sin librería de charts: divs con altura porcentual alcanzan.
6. **Accesos de Administración en grid 2 columnas** (Panel de ventas, Asistencia, Temporadas, Equipo). Rendiciones ya no aparece como card suelta: vive en atención + accesos.

**Backend:** `GET /api/reports/attention?season_id=` (las alertas, calculadas server-side) · `GET /api/reports/functions-summary?season_id=` · `GET /api/reports/sales-timeline?season_id=&days=14`. Mantener respuestas simples; nada de esto requiere tablas nuevas.

**Aceptación:** con el seed, la atención muestra las 3 alertas del mockup y cada link navega al lugar correcto ya enfocado; al saldar la rendición, la alerta desaparece sin recargar (invalidación de query); con cero pendientes aparece "Todo en orden".

## C10 — Componentes nuevos comunes (construir una vez, en `src/ui/`)

`BottomSheet` (grip, dim, cierre por gesto/tap afuera, accesible) · `FAB` · `SearchBar` (sticky, con clear) · `FilterChips` (single-select con contadores) · `SegmentedToggle` (2–3 opciones) · `AlertCard` (borde de color por severidad + link) · `ProgressBar` y `StackedBar` · `LiveDot` (pulso, respeta `prefers-reduced-motion`) · `CounterChip` (k/N verde/ámbar) · `Stepper` compacto (con estados disabled por límite) · `EmptyState` positivo. Todos con tokens del design system; C3, C5, C6, C7, C8 y C9 los consumen — no duplicar implementaciones por pantalla.

## Notas transversales

- Iconos siempre `lucide-react` (los emojis de los mockups son placeholders).
- Toda lista con búsqueda/filtros usa los mismos componentes y comportamiento (C3, C6, C5.3).
- Los chips de estado siguen siendo el sistema único definido en el design system; los nuevos (CounterChip k/N, "Invitación pendiente") se agregan a ese sistema, no por fuera.
- Voseo y sentence case en todos los copys nuevos; los textos de los mockups son la referencia de tono.
- Cada cambio con backend suma sus tests (especialmente C8: invariantes + concurrencia).
