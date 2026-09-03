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
- **La invitacion pendiente se mide con `users.last_login_at`** (C7), no con
  `must_change_password`: ese flag tambien queda en true despues de un reseteo
  de contrasena, asi que alguien que ya usa la app volveria a figurar como
  "nunca entro". El sello lo pone el propio login; si esa escritura falla, se
  registra pero no tumba el ingreso.
- **`reset-password` y `resend-invite` son el mismo mecanismo** (clave
  provisoria nueva + `must_change_password`) con dos textos distintos: uno es
  "todavia no entraste", el otro "te la olvidaste". El server rechaza reenviar
  la invitacion a alguien que ya entro, para que la UI no ofrezca las dos
  cosas a la vez.
- **La contrasena provisoria se sigue mostrando en pantalla** aunque el alta
  ya mande el email: mientras el SMTP de produccion este bloqueado es el unico
  camino real, y sirve igual de plan B cuando el envio falla (la tarjeta
  cambia de tono y lo dice). Nunca se guarda en claro ni se puede reconsultar.
- **Las alertas de Direccion (C9) las calcula el server, la copy la pone la
  UI**: `GET /api/reports/attention` devuelve `kind` + los datos (nombres,
  montos, ids, timestamps) y el frontend arma titulo, icono, etiqueta de
  accion y destino. Asi la logica de "que esta pendiente" vive en un solo
  lugar consultable, pero el server no conoce rutas del cliente ni duplica
  textos del design system. Los links llevan estado en la query
  (`/temporadas/{id}?fn=N`, `/usuarios?u=N`) para caer en la pantalla ya
  enfocada; cada pantalla limpia el parametro despues de usarlo.
- **"Cobro hace N dias" se aproxima con la venta paga mas reciente**: no
  guardamos fecha de cobro (marcar como paga no sella `paid_at`), asi que la
  alerta dice "ultima venta cobrada hace N dias", que es lo que el dato
  sostiene. Si en algun momento hace falta la fecha real, es una columna
  nueva en `sales`, no un cambio de la alerta.
- **El dia del ritmo de ventas se corta en la zona horaria de la app**
  (`AT TIME ZONE $tz` con el mismo `cfg.TZ` que usa el handler para la
  ventana): en UTC las ventas de la noche caerian en el dia siguiente y el
  grafico mostraria un ritmo que nadie vivio. El handler completa los dias
  sin ventas en cero para que las barras no mientan sobre el ritmo.

## Una sola temporada en curso

`seasons.is_active` existía en el esquema desde el día uno pero no lo leía ni
lo escribía nadie: "la temporada" era, en los hechos, la última creada
(`ORDER BY created_at DESC` y `seasons[0]` en el frontend). Crear una temporada
nueva dejaba dos activas y mandaba Inicio, Rendiciones y Dirección a la vacía:
Rendiciones decía "Nadie debe rendir" con $458.000 sin rendir en la base.

Se eligió hacer real el campo en vez de agregar un selector de temporada en
cada pantalla. El coro trabaja una temporada por vez; un selector obliga a
elegir en cada visita y deja la puerta abierta a mirar la temporada equivocada
sin darse cuenta. Ahora:

- crear una temporada la deja en curso y apaga la anterior, en una transacción;
- `POST /seasons/{id}/activate` vuelve a cualquier temporada guardada;
- `ListSeasons` devuelve la activa primera, y `activeSeason()` en el frontend
  es el único lugar que decide cuál es;
- el formulario de alta avisa que la nueva pasa a ser la que se ve.

La migración 00008 normaliza lo que ya esté cargado dejando activa la más
nueva. No se agregó un índice único parcial porque el UPDATE que activa una y
apaga el resto lo violaría fila por fila (los índices únicos no se difieren);
la garantía queda en la transacción del handler.
