# DECISIONS

Decisiones tomadas donde los documentos (spec, design system, mockup) no
cubrian el caso o entraban en tension con el codigo ya existente.

- **CSS plano con tokens en vez de Tailwind.** El prompt del kit sugiere
  Tailwind para un build desde cero; la app ya estaba construida con CSS
  plano tokenizado. Los tokens del design system se implementaron 1:1 como
  custom properties en `web/src/styles.css` — el resultado visual es el del
  mockup y no se hardcodean hexas en componentes. Migrar a Tailwind queda
  como refactor mecanico opcional.
- **Fuentes self-hosted.** El design system pide Archivo/Inter "desde Google
  Fonts"; se descargaron los woff2 variables a `web/public/fonts/` para que
  el modo puerta offline y la PWA no pierdan la tipografia sin red (el SW las
  cachea). Mismas fuentes, mejor disponibilidad.
- **Tab "Vender" → /ventas/nueva.** El mockup muestra la pantalla de Nueva
  venta bajo esa tab; "Mis ventas" queda a un tap desde el home y desde la
  pantalla de exito.
- **Tab "Direccion" → /direccion (hub nuevo).** El mockup de Direccion mezcla
  KPIs + rendiciones; se creo esa pantalla como hub y las paginas de detalle
  (panel de ventas, rendiciones con registro, asistencia) siguen como rutas
  propias, restyladas al sistema.
- **Logo como PNG por fondo.** No hay SVG del isologo (falta exportar del
  .ai): se usan las variantes PNG correctas por fondo (azul sobre crema,
  crema sobre tinta) segun §4 del design system. TODO: reemplazar por SVG
  `currentColor` cuando este.
- **`GET /api/functions` ahora incluye `sold`** (entradas vivas): lo necesita
  la barra de progreso del hero y no expone montos.
- **Rol `door` entra directo a /puerta** y no ve tab bar (su unica area).
- **Busqueda sin acentos con `translate()` en SQL** (C3), no con la extension
  `unaccent`: cero dependencias del servidor Postgres (funciona igual en el
  docker local, el de test y Railway). El mismo mapa de caracteres vive en
  `normalizeText` del frontend para el resaltado de matches.
- **Cursor keyset `(function_starts_at, sale_id)`** para paginar ventas: los
  grupos por funcion quedan contiguos entre paginas, que es lo que el listado
  agrupado necesita. El contador por grupo solo se muestra cuando ya se cargo
  todo (con paginas pendientes seria mentirle al usuario).
- **`last_email_at` con centinela año 1** en SQL (COALESCE) porque sqlc no
  puede inferir la nulabilidad de la subquery; el handler lo convierte a null.
- **C8 endurece las allocations existentes** (antes eran "objetivo de venta"
  blando de una iteracion previa): misma tabla, sin migracion; ahora son cupo
  obligatorio validado en la transaccion de venta. "Vendido" se deriva de
  tickets vivos (anular un ticket suelto tambien devuelve cupo), sin contador
  desnormalizado. Se sumo el invariante simetrico: reducir el capacity de una
  funcion por debajo de la suma asignada tambien falla con
  allocation_exceeded.
