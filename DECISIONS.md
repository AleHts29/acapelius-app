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

## Los cupos se sueltan al salir del rol de corista

El tablero de asignaciones lista coristas activas (`role='seller' AND
is_active`), pero `SumAllocations` sumaba todas las filas. Cambiarle el rol a
una corista, o desactivarla, dejaba su cupo en la base: invisible en pantalla
y contando en la validación. El tablero decía "quedan 36 sin asignar", se
asignaban 36 y saltaba "las asignaciones suman 81 y el cupo es 80" — dos
números que no aparecían en ninguna pantalla.

Se eligió soltar los cupos al salir del rol (`DeleteAllocationsForUser` desde
`UpdateUser`) en vez de mostrar las filas fantasma en el tablero: un cupo de
alguien que ya no vende no es información, es un lugar bloqueado. Volver al
rol de corista no devuelve el cupo viejo; hay que reasignarlo, que es lo que
dirección haría igual.

Además, todo lo que suma cupos cuenta lo mismo que muestra el tablero
(`SumAllocations`, `FunctionsSummary.assigned` y la alerta de entradas sin
repartir filtran por corista activa), y `PUT /allocations` rechaza con 409 un
cupo para alguien que no es corista activa: por API se le podía asignar cupo a
la puerta o a dirección.

## La puerta busca por comprador, no por entrada

La búsqueda por nombre listaba una fila por entrada: una compra de tres daba
tres renglones idénticos, sin forma de distinguirlos. Marcabas uno, la hoja se
cerraba, y al volver encontrabas dos filas iguales otra vez. Asistencia ya se
había resuelto por comprador (C6); la puerta seguía por entrada.

Ahora es una fila por compra, con "1 de 3 entraron" y dos acciones: la familia
entera ("Marcar las 3") o la persona que llegó sola ("Solo 1"). Marcar el
grupo muestra un solo cartel verde con la cantidad: repetir el verde tres
veces no le sirve a nadie con gente esperando. Si alguna entrada del grupo
falla, se muestra esa y no el verde.

El agrupado usa `sale_id`, que se agregó al snapshot de la puerta. Un
dispositivo que quedó offline con un snapshot viejo no lo trae: ahí se cae a
comprador+vendedora, que en la puerta alcanza.

## Cobros parciales: un historial, no un saldo

Una venta estaba paga o no. Si el comprador dejaba una seña, la corista no
tenía dónde anotarla y la venta figuraba debiendo todo. Se eligió modelar cada
cobro como un registro (`sale_payments`: monto, método, quién y cuándo) en vez
de un solo número `paid_cents` en la venta, por tres razones: una venta se
puede cobrar mitad en efectivo y mitad por transferencia y un campo único no
lo representa; se puede quitar un cobro mal cargado sin recalcular a mano; y
es el mismo modelo que ya tienen las rendiciones, así que la app no aprende
dos formas distintas de anotar plata.

`sales.paid_cents` queda igual, como caché de `SUM(sale_payments)`, junto a
`payment_status` que ya era caché de lo mismo. Se recalcula **entero** —nunca
sumando de a poco— dentro de la transacción del cobro, así el caché no puede
separarse del historial. Tenerlo en la fila deja todos los reportes de plata
en una suma simple, sin un join extra en cada consulta.

`payment_status` sigue siendo `pending`/`paid`, sin un tercer valor
`partial`: significa "¿terminó de pagar?", que es exactamente lo que necesitan
el filtro "Deben" y los chips. Lo parcial se lee del saldo.

No se aceptan cobros por encima del saldo: eso es una vuelta, no un cobro de
esa venta. Los dos botones de siempre ("Marcar pagó — efectivo/transferencia")
ahora registran un cobro por lo que falte, y "Volver a pendiente" borra los
cobros de la venta: no hay un camino paralelo que pudiera desincronizar.

## Escritorio: media queries, no una app aparte

En una pantalla grande la app se veía igual que en el celular: una columna de
480px al medio de 1440 y la barra de pestañas abajo. Se eligió resolverlo con
una media query en 1024px —la barra de abajo se convierte en columna lateral y
el contenido usa el ancho— en vez de una segunda interfaz para escritorio: el
celular es donde se vende y se entra a la puerta, y mantener dos capas de
pantallas en sincronía cuesta el doble por cada cambio.

La navegación vive una sola vez en `components/nav.ts`; `TabBar` (celular) y
`SideNav` (escritorio) la consumen. Las dos se renderizan siempre y el CSS
elige cuál se ve: ningún componente necesita saber el tamaño de la ventana, así
que no hay parpadeo al cargar ni estado duplicado.

El modo puerta no participa: es táctil y a pantalla completa se use donde se
use, así que no lleva navegación alrededor y en escritorio se centra en el
ancho de una tablet.

## Escritorio: una sola app, no dos

C11 se resolvió con media queries y un solo juego de componentes y rutas. Se
descartó una interfaz aparte para escritorio: el celular es donde se vende y
donde se abre la puerta, y mantener dos capas de pantallas en sincronía cuesta
el doble por cada cambio.

Casi todo es CSS. `useIsDesktop()` existe sólo para los tres lugares donde el
tamaño cambia **qué se monta**, no cómo se ve: la puerta no monta html5-qrcode
en una notebook, y Rendiciones y Asistencia eligen entre master-detail y una
sola columna.

Los agrupadores que sólo tienen sentido en escritorio (`.attngrid`, `.dirrow2`,
`.md`) son `display: contents` en celular: existen en el DOM pero no en el
layout, así que el markup es uno solo y el flujo de celular queda intacto.

Decisiones puntuales:

- **El sheet y el cajón son el mismo componente.** Se mantuvo el nombre
  `BottomSheet`: lo usan cinco pantallas y el comportamiento no cambia, sólo la
  presentación.
- **El FAB no existe en escritorio.** La acción se declara una vez en
  `PageHead`, que renderiza el botón del header y el FAB; el CSS muestra el que
  corresponde. Declararla dos veces por pantalla era la forma segura de que se
  desincronizaran.
- **Una sola URL para el master-detail.** `/panel/rendiciones/:id` abre lista +
  detalle en escritorio y sólo el detalle en el celular. Un link que alguien
  manda por WhatsApp abre lo mismo de los dos lados.
- **La puerta en escritorio no tiene cámara.** Nadie escanea un QR con la webcam
  de una notebook; la mesa de entrada resuelve búsquedas con el teclado y lo
  dice al pie. De paso, una superficie menos que probar contra webcams raras.
