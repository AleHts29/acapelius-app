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

## La paleta vive sólo en los tokens

C11 cambió la paleta sin tocar lógica: todo salió del bloque `:root`. Los pocos
hexas sueltos que había —el ámbar del "sin conexión" nocturno, el fondo del
visor de la puerta, el resalte de búsqueda, el gris de los chips— eran deuda de
iteraciones anteriores y se convirtieron en tokens (`--night-warn`,
`--surface-alt`, `--mark`, `--ink-soft`). Hoy no queda un solo color fuera del
bloque de tokens en `styles.css`, ni ninguno en los componentes.

Se renombraron los tokens para que un color tenga un nombre: `--brand-blue` →
`--indigo`, `--blue-soft` → `--indigo-soft`, `--muted` → `--text-muted`. Dejar
"blue" apuntando a un índigo era garantía de confusión en la próxima lectura.

**Dos tokens de la spec no llegaban a AA** y se corrigieron:

- `--text-muted` #7C818C da 3.91 sobre blanco y 3.52 sobre el fondo. Es el
  color del texto de 11–12px de toda la app, así que necesita 4.5, no 3.0.
  Quedó en **#6B6F78** (5.04 y 4.54): el mínimo que pasa en los dos fondos.
- `--warn` #9C6A0C sobre `--warn-soft` da 4.06, y el chip es de 10px. Quedó en
  **#90620B** (4.62).

El resto de los pares se verificó por cálculo, incluido el modo nocturno de la
puerta sobre carbón: ninguno baja de 4.5 salvo los que son decorativos.

El crema queda reservado para lo que sale del producto. La entrada pública lo
pinta con `body:has(.ticket-page)`, así la página no necesita tocar el DOM ni
hay una clase que alguien pueda olvidarse de sacar. El email no se tocó.

Los PNG del isologo se recolorearon proyectando cada pixel sobre la recta entre
los dos colores de origen y reconstruyéndolo sobre la nueva: así el
antialiasing se mantiene en vez de aparecer un borde duro. El logo azul original
se conserva porque lo sigue usando la entrada pública.

## Un solo panel de acciones, dos presentaciones

C14 pedía un componente con modal en escritorio y sheet en celular. Había dos:
`BottomSheet` (que en escritorio era un cajón lateral) y `Modal` (centrado, para
la venta nueva). Quedó uno solo, `ActionPanel`, con un `size`: `panel` (420px,
acciones cortas) y `form` (560px, un formulario completo). El cajón lateral se
fue: la spec pide centrado y no vale la pena sostener tres presentaciones.

**El foco se anota en el render, no en un efecto.** Un campo con `autoFocus`
adentro del panel se lleva el foco durante el commit, antes de que corra
cualquier efecto: si el opener se capturara ahí, se guardaría ese campo en vez
del botón de afuera, y al cerrar el foco se iría al body. Leer
`document.activeElement` durante el render es de las pocas veces que mirar el
DOM ahí está justificado, porque es el único momento en que la respuesta
todavía es la correcta.

El scrim se llama `scrim` y no `dim`: en el mockup ese nombre chocaba con el
gris de texto.

Se usa `aria-label` en vez de `aria-labelledby`: el título del panel llega como
prop y no siempre existe como nodo con id. El nombre accesible es el mismo.

**Queda un conflicto declarado con la spec.** C14 dice que la venta nueva
completa no va en pop-up, pero es lo que pediste explícitamente en la iteración
anterior y quedó andando. Se mantuvo el modal de 560px; si preferís la regla de
la spec, es sacar tres líneas de SalesPage.

## La home la arma el server, no el frontend

C12 pedía una home por rol. Se resolvió con un `GET /api/home` que devuelve la
carga ya recortada según quién pregunta, en vez de que el frontend pida cinco
endpoints y esconda lo que no corresponde.

La razón no es la cantidad de requests: es que **la corista no recibe ni un
dato global**. Lo recaudado de la función, las ventas de las demás y las
alertas de dirección no viajan y después se ocultan — no se arman. Un bug de
render no puede filtrar lo que nunca estuvo en la respuesta.

La estructura de la pantalla es la misma para los dos roles (hero → lo
accionable → contenido propio → accesos): cambian los datos, no el layout. Los
campos del rol que no corresponde vienen en cero.

**Las alertas se arman una sola vez.** `attentionAlerts` salió del handler de
Dirección para que la home use exactamente la misma lista: dos armados
distintos era la forma segura de que las dos pantallas terminaran contando
cosas diferentes.

La alerta de rendición trae `collected_cents` y `settled_cents` para que el
pop-up de la home pueda mostrar su encabezado sin pedir el reporte entero.
Resolver ahí adentro invalida `['home']` y la alerta desaparece sola.

La lateral tiene dos niveles para dirección; la barra del celular sólo muestra
el primero y se reparte en tantas columnas como pestañas tenga el rol. Cuando
dos ítems coinciden con la ruta gana el más específico: parado en
`/panel/rendiciones` se prende Rendiciones, no Dirección.

`.card` ya existía como la tarjeta angosta del login, con un `max-width` de
400px. La de la home se llama `.hcard`: el choque de nombres del que avisaba
C14 pasó igual, y se resolvió con un nombre propio en vez de tocar el login.

## Dirección muestra conclusiones, no tablas

La versión anterior era un tablero: KPIs, alertas, funciones, chart y accesos.
Mucho dato y ninguna respuesta. Ahora responde una sola pregunta —"¿cómo viene
la temporada?"— con tres bloques, y la regla es explícita: **si un dato
necesita explicación, contexto o comparación para entenderse, no va en la
pantalla, va detrás de un click**.

La plata es un solo número —lo vendido— partido en los tres estados en que
puede estar: entregado a dirección, cobrado y sin rendir, y sin cobrar. Los
tres suman exactamente lo vendido, y hay un test que lo verifica: es la clase
de cuenta que se rompe callada.

Los hallazgos los arma el server, no la pantalla, porque son comparaciones
entre funciones y necesitan umbrales. Una asistencia baja se nombra sólo si
además quedó lejos del resto: si todas rondaron el 55%, eso no es un problema
de esa función, es cómo viene el coro, y decirlo de una sola sería mentir por
recorte. Si no hay nada que decir, no se inventa una tarjeta.

El detalle no desaparece: la comparación completa —ticket promedio, cortesías,
totales— y el reparto de cupos viven en pop-ups. Eso contradice a C14, que
ponía la asignación masiva fuera de los pop-ups; gana el documento más nuevo,
que es el que muestra esa pantalla.

El promedio se redondea al peso. En un promedio los centavos son ruido:
"$7.483,87" se lee peor que "$7.484" para la misma decisión.

## El detalle de rendición sirve para reclamar

La vista respondía "cuánto debe" pero no "de dónde sale esa deuda", que es lo
que hace falta para hablar con la corista. Un "$112.000" a secas la obliga a
reconstruir de memoria de dónde sale, y en esa reconstrucción aparecen las
discusiones. Ahora el panel lista las ventas que ya cobró —comprador, función,
monto y cuándo— y suma exactamente lo que debe, con test: si el origen no
cierra con el total, el detalle no sirve para nada.

**El recordatorio manda lo mismo que muestra la pantalla.** Por eso el armado
del detalle vive en una función y no en el handler: si el mail y la pantalla se
armaran por separado podrían discrepar, y esa discusión la pierde siempre
dirección.

Cada envío queda registrado con **cuánto debía en ese momento**. La deuda
cambia; sin ese número el historial no se puede leer más tarde. También se
registran los que fallan: un recordatorio que no salió es información.

"Recordar a las N" manda emails de verdad a varias personas, así que pide
confirmación antes. No es un pop-up: el botón se transforma en la pregunta, que
para una sola decisión alcanza y no tapa el ranking que la justifica.

El panel sin selección muestra el ranking con barras comparables en vez de una
caja vacía. La barra es lo que hace comparable una deuda con la de al lado; los
números solos obligan a hacer la cuenta de cabeza.

## Temporadas: una fila por función

La vista anterior gastaba ~180 px de alto por función para mostrar cuatro
datos, y ponía dos botones índigo a todo el ancho que pesaban más que los
nombres de las funciones. Ahora cada función es una fila de ~70 px con la
barra de ocupación, vendidas sobre cupo, asignadas y recaudado en columnas
alineadas: la temporada entera entra sin scrollear. El índigo vuelve a ser
sólo para acciones.

**Temporadas ya no es una lista de temporadas.** `/temporadas` abre
directamente la que está en curso, que es lo que dirección quiere ver casi
siempre; el selector del header cambia de temporada y trae "＋ Crear
temporada…" como última opción. Crear y activar dejaron de tener pantalla
propia: eran dos acciones sueltas sosteniendo una vista entera.

Cuando se mira una temporada que no es la que está en curso aparece una barra
que lo dice y ofrece activarla. Sin ese aviso, ver números viejos y creer que
son los de hoy es cuestión de tiempo.

**Próximas y Ya pasaron, con la más cercana destacada.** Mezcladas no se podía
distinguir dos funciones con el mismo nombre. El corte usa las mismas 3 horas
de gracia que Inicio: a las 21:00, la función de las 20:00 todavía no "pasó".

Las acciones son las mismas en todas las filas: Asignar (en ámbar cuando falta
repartir, con cuánto falta), Editar y ⋮ para duplicar. En las que ya pasaron no
se ofrece Asignar: repartir cupo de una función que ya fue no arregla nada. Por
eso "Sin asignar" de la franja cuenta sólo las próximas — si contara las
pasadas quedaría un número en ámbar que nunca se puede bajar.

**Duplicar deja la fecha en blanco.** Es el único dato que seguro cambia, y
prellenarlo con el de la función vieja es la forma segura de crear dos
funciones el mismo día sin darse cuenta.

**El precio arranca bloqueado si ya se vendió, pero se puede destrabar.** El
motivo va adentro del pop-up de edición, no suelto en la lista, porque se lee
justo cuando se intenta tocar el campo. La razón verdadera no es que se alteren
las ventas hechas: `sales.amount_cents` guarda el importe de cada venta y no
cambia nunca. Lo que pasa es que de ahí en adelante la misma función tiene dos
precios y lo recaudado deja de coincidir con cupo × precio. El candado es guía,
no regla: el server sigue aceptando el cambio. Un bloqueo duro dejaría sin
salida a quien cargó mal el precio y ya vendió dos entradas, y para salir de
ahí haría falta SQL.

El chip de bloqueo cambia de texto según el caso: "Cerrada" en una función que
ya pasó, "No se edita" en una que todavía se vende. "Cerrada" en una función
futura no se entiende; el chip tiene que decir qué es lo que no se puede hacer.

**"Cancelar función" no se implementó.** El mockup la lista en el ⋮, pero no
existe en el modelo: una función no se puede dar de baja sin decidir antes qué
pasa con las entradas vendidas, con lo que las coristas ya cobraron y con lo
que tienen que rendir. Eso es una decisión de negocio, no un botón.

## Los menús son de la app, no del sistema operativo

El `<select>` nativo se dibuja distinto en cada sistema y no puede mostrar más
que una línea de texto por opción. El componente `Menu` lo reemplaza en toda la
app —no queda ninguno— y cada opción lleva su contexto: la función con su fecha
y cuántas entradas vendió, la temporada con su estado, la corista con el cupo
que le queda.

Es un solo componente con dos presentaciones, igual que `ActionPanel`: en
escritorio es un panel anclado al disparador; en celular entra desde abajo,
donde una lista pegada al dedo se toca mejor que un popover de 260 px. Va en un
portal porque los disparadores viven adentro de tarjetas con `overflow: hidden`
—las filas de Temporadas— y ahí un panel absoluto queda cortado a la mitad.

El teclado se escucha en `document` y no en el panel: al abrir, el foco todavía
está en el disparador, que vive afuera del portal, y un `onKeyDown` del panel no
vería ni la primera flecha ni el Escape.

**Una opción deshabilitada dice por qué.** "Cancelar función" en gris no explica
nada; "Ya vendió 14 entradas: primero hay que resolver los reembolsos" cierra la
pregunta sin que haya que probar.

## Cancelar una función: sólo si nunca vendió

El mockup pone "Cancelar función" en el ⋮ y ahora existe, con un límite: sólo se
puede si la función no tiene ninguna venta, ni siquiera anulada. Eso cubre el
caso real —se cargó mal y hay que sacarla— sin meterse en el otro, que no es un
botón: una función con entradas vendidas no se da de baja sin decidir antes qué
pasa con los reembolsos, con lo que las coristas ya cobraron y con lo que tienen
que rendir. El ítem queda visible pero deshabilitado, con el motivo.

Las asignaciones se borran con la función en la misma transacción: sin función
no hay cupo que repartir.

## Temporadas vuelve a tener índice

`/temporadas` es de nuevo el listado —cada temporada con su resultado— y
`/temporadas/:id` el detalle de funciones. La versión anterior mandaba
directamente al detalle de la temporada en curso; eso deja sin lugar a las
temporadas viejas, que es donde se consulta el historial.

**Tres estados, no dos.** Una temporada que se carga para el año que viene no
está en curso, pero llamarla "cerrada" es exactamente al revés de lo que es:
`en curso` (la activa), `cerrada` (ya pasaron todas sus funciones) y
`preparándose` (todo lo demás). El renglón de contexto y la barra siguen ese
estado, no `is_active`.

## Alta de temporada: los dos atajos

**Copiar la estructura.** Cargar cinco funciones a mano cada año era el trabajo
que nadie quería hacer. La copia trae lugar, cupo y precio, sin ventas. El
mockup pedía copiarlas "sin fechas", pero `starts_at` es NOT NULL y hacerlo
nullable se propagaría a todo lo que ordena por fecha —Inicio, la puerta, la
próxima función—. En vez de eso las fechas se corren **364 días**: 52 semanas
exactas, así cada función cae el mismo día de la semana del año siguiente, que
para un coro que canta los sábados es la diferencia entre ajustar y rehacer.

**"Cerrar la temporada anterior" es opcional y arranca apagada.** Antes, crear
una temporada movía Inicio, Rendiciones y Dirección de una, sin preguntar. Ahora
la nueva se carga aparte y el resto de la app sigue mostrando la de ahora; la
casilla es la que decide el cambio. Es el caso de preparar el año que viene
mientras el actual todavía vende.

El endpoint acepta `activate` y `copy_from_season_id`, y hace las dos cosas en
una transacción: una temporada creada a medias, con la mitad de las funciones
copiadas, sería peor que un error.

## Modo puerta: la app sabe cuál es la función

La pantalla pedía "elegí la función de hoy" y mostraba las cinco de la
temporada, tres de hace tres semanas. La app conoce la fecha y los horarios: lo
resuelve sola. La función de hoy ocupa la pantalla —un bloque, un botón, cero
decisiones— y el resto queda abajo. A las 20:45, en la puerta, nadie busca en
una lista.

El bloque va en carbón, el mismo fondo del modo puerta al que lleva: no es
decoración, es la continuidad entre "estoy por empezar" y "estoy escaneando".
Trae emitidas, ingresadas y cortesías, que es lo que hace falta para operar;
"38 de 45 vendidas" no decía cuántos ya entraron.

**El día que no hay función —casi todos— se muestra la próxima** con su cuenta
regresiva, y abrir la puerta pasa a ser deliberado: "Abrir igual para probar",
diciendo que los ingresos que se marquen quedan registrados. Sin esa aclaración,
probar el escáner ensucia la asistencia de una función que todavía no pasó.

**El resto de las funciones vive en la columna de al lado**, en la misma
grilla asimétrica que usa Dirección: la de hoy a la izquierda, lo que puede
hacer falta comprimido a la derecha. Cada fila dice cuándo fue y cómo terminó
—"3 sept · 29 de 61 ingresaron"— y cuando ya no queda ninguna por delante, la
lista aclara para qué sirve abrirlas: corregir un ingreso mal marcado.

Al lado va también un recordatorio de con qué conviene abrir la puerta: el
celular escanea los QR con la cámara, la compu sirve para buscar por nombre y
marcar a mano. La app ya se comporta así en cada tamaño, pero eso sólo se
descubre entrando; decirlo antes evita que alguien se plante en la puerta con
la notebook.

**La copia local se baja acá, no al entrar.** El modo puerta ya funcionaba
offline, pero la primera bajada necesita conexión y se hacía recién al abrir la
puerta —adentro del teatro, que es justo donde puede no haber señal—. Ahora la
pantalla de selección prepara el snapshot de la función destacada y lo dice:
"Listo para trabajar sin conexión · sincronizado hace 2 min". Si nunca se pudo
bajar y no hay copia previa, lo avisa en ámbar en vez de dejarlo pasar.

`comp_tickets` y `sellers` se sumaron a `ListFunctions`, que leen todos los
roles. Son conteos, no plata: mantienen la regla de esa query, y en la puerta
importa saber cuántos de los que vienen no pagaron entrada.

"Ver quiénes compraron" aparece sólo para dirección: Asistencia es una pantalla
suya, y a la persona de la puerta el botón la mandaría a un redirect.

## Vender: una caja por función (C15)

La tabla larga con bandas adentro obligaba a repetir el nombre de la función en
cada fila. Ahora cada función es su propia caja, con acento lateral índigo si
todavía se vende y verde si ya pasó, y el nombre aparece una sola vez arriba.
Por eso **no existe columna "Función"**: sería la misma palabra cincuenta veces.

Los encabezados de columna se repiten adentro de cada bloque. En un scroll
largo, un encabezado único allá arriba deja de servir a la tercera función.

**El orden de los bloques lo decide el server.** Primero las que se venden (la
más cercana primero), después las que pasaron (la más reciente primero). Se
expresa como dos claves numéricas —`past_rank` y `fn_rank`— para que el keyset
de la paginación siga siendo monótono: si el orden lo decidiera el cliente,
cada página nueva insertaría bloques arriba de lo que estás leyendo.

### El chip dice el estado, nada más

`Pagó` · `Debe` · `Cortesía` · `Anulada`, todos con el mismo ancho mínimo y
pegados a la derecha, así el borde contra el ⋮ es una línea recta. El monto y
el método viven adentro de un `<small>` que la tabla esconde: ahí el monto ya
tiene su columna y el método está en el ⋮, y repetirlos era lo que producía
chips de 46 a 108px. En celular no hay columnas, así que el `<small>` se ve y
el saldo sigue en el chip.

### La acción rápida tiene su propia columna

Reservada siempre, aunque esté vacía. Si apareciera en el lugar del chip, el
estado desaparecería justo cuando se lo va a cambiar; si no tuviera columna
propia, la fila entera se movería al pasar el mouse. Verificado: con y sin
hover la fila mide 44px y el borde derecho del chip no se mueve un píxel.

### Estado de entrega: tres, no cuatro

`Enviada`, `No llegó` y `Sin email` salen de `email_sends`. **`Abierta` no
existe**: saber si el comprador abrió el mail necesita un webhook de Resend con
su secreto de firma y una tabla nueva, y un cuarto estado que la app no puede
distinguir sería decorativo. La spec lo contempla en §4.2.

### Ordenar carga todo primero

Ordenar por total sobre media lista y llamarlo "ordenado por total" es mentir
sobre lo que todavía no se cargó. Por eso ordenar es una acción explícita que
primero termina de traer las páginas que falten (con tope de 20, o sea 1.000
ventas) y recién después reordena. El orden es por bloque: entre funciones el
orden lo sigue mandando el server.

### Los subtotales los calcula el server

El encabezado de cada bloque dice la verdad de toda la función, no de las filas
que se alcanzaron a cargar. Lo mismo la franja de arriba, que además responde
al filtro activo: hay dos resúmenes, uno con el filtro de estado (la franja) y
otro sin él (los contadores de los chips, que tienen que seguir diciendo
cuántas hay de cada tipo aunque estés mirando una sola).

### Acciones en lote

`bulk-payment` cobra lo que falte de cada venta y saltea las anuladas, las
cortesías y las ya cobradas: en una selección de veinte, que una no aplique no
puede frenar al resto. Cada cobro entra al historial como cualquier otro —en
lote o de a una, la venta termina contando lo mismo—. Pide confirmación porque
mueve plata de verdad, y el método se elige en esa confirmación.

`bulk-resend` informa cuántas se omitieron por no tener email. El export es del
server y no del cliente para que salga **todo el filtro** y no las filas
cargadas; acepta `ids` para exportar solo una selección.

La selección múltiple es de escritorio: en un celular la barra flotante tapa la
lista y compite con la barra de pestañas.

### Lo que quedó afuera

**Virtualizar dentro de un bloque.** El listado paginado ya limita lo montado
(50 por página, más a medida que scrolleás) y una temporada real tiene decenas
o pocos cientos de ventas. Virtualizar por bloque recién importa arriba de unas
500 en una sola función; con la caja por función y el virtualizador de ventana
no componen sin acrobacias, así que se difiere hasta que haga falta.

**Anular desde el ⋮.** El ítem está, pero abre el drawer en vez de anular:
anular desde un menú, sin ver la venta entera, es demasiado fácil de hacer sin
querer. La confirmación vive donde están todos los datos.

## Quién es una persona y quién participa de una temporada

`users.role` + `users.is_active` mezclaban dos cosas distintas. No había forma
de decir "Norma cantó en 2025 pero no en 2026": desactivarla la borraba también
del año en que sí vendió, porque el rol vivía en la persona y no en su
participación.

Ahora `users` guarda identidad y credenciales, para siempre, y
**`season_members`** dice quién está en cada temporada y con qué rol. Las
ventas y las asignaciones ya colgaban de funciones, que cuelgan de temporadas,
así que el histórico quedó intacto sin tocar nada más.

**El rol es por temporada.** Alguien puede ser corista un año y estar en la
puerta al siguiente. Los permisos se resuelven contra la temporada en curso: el
rol efectivo sale de `season_members`, y con `left_at` puesto se apaga —dejó el
coro a mitad de año, no vende más, pero sus ventas y su deuda siguen contando—.

**Nunca se borra una persona.** Si este año no participa, simplemente no tiene
fila para esta temporada. Sigue existiendo, sigue apareciendo en los números de
los años en que estuvo, y se la reincorpora con un click.

**Sacar a alguien de la temporada ya no le saca la cuenta.** Antes,
`is_active = false` bloqueaba el login. Ahora entra igual pero sin rol, y sin
rol no puede hacer nada: lo único que le queda es mirar su propio historial de
ventas y su rendición. Eso es lo que habilita `RequireHistory`, que pasa a quien
es corista ahora o lo fue alguna vez —quien sólo estuvo en la puerta no tiene
ventas propias que mirar, así que no pasa—.

### El arranque

Con el rol adentro de `season_members`, sin temporada nadie tiene rol, y sin
rol nadie puede crear la primera temporada. Por eso `make seed` ahora crea el
admin **y** la primera temporada juntos. Y por las dudas, cuando no hay ninguna
temporada cargada el rol se cae a la membresía más reciente que la persona
tenga: es el único caso en que mirar el pasado es lo correcto.

**Crear una temporada te mete en ella como dirección**, y activar una temporada
que no tiene dirección también. Sin eso, cambiar de temporada era una forma de
quedarse afuera de la propia app.

### El backfill

Quien tuvo actividad en una temporada —ventas, asignaciones o rendiciones—
queda como miembro de esa temporada con el rol que tenía. Es la parte que
arregla el histórico. Y la temporada en curso se lleva a todo el que estaba
activo, tenga o no actividad todavía: ese es el equipo de ahora. Quien estaba
desactivado no entra en la temporada en curso, que es exactamente lo que era.

Verificado sobre los datos reales: 12 usuarios (1 dirección, 10 coristas, 1
puerta) → 12 membresías con su rol, y los $458.000 sin rendir siguen dando lo
mismo.

## Equipo: bloques por rol y las columnas que Eli necesita

La vista mostraba nombre y mail, nada más, con el chip "Corista" repetido once
veces debajo del encabezado "Coristas · 11". Ahora **el rol lo dice el bloque**
—con su acento lateral: carbón dirección, índigo coristas, verde puerta— y la
columna Estado dice lo que sí varía: activa, invitación pendiente o dejó el
coro. Son cosas distintas y ahora viven en lugares distintos: antes
"Invitación pendiente" pisaba el rol y de esas dos personas no se sabía qué
eran.

Las cuatro columnas nuevas responden por qué se entra a Equipo: **vendidas**,
**uso del cupo** —con barra, porque un 94% al lado de un 31% se compara de un
vistazo y los números solos obligan a leer fila por fila—, **sin rendir** con
enlace a Rendiciones, y **último acceso**. Arriba de 100% el porcentaje se
pinta en ámbar: no es que aprovechó bien el cupo, es que vendió más de lo que
tiene asignado, y eso hay que mirarlo.

**El avatar es siempre índigo.** El rol lo comunica el bloque; que Eli tuviera
avatar negro y el resto índigo hacía que el color de una persona pareciera
significar algo.

El selector de temporada manda también acá, y quienes no participan de este año
quedan en un bloque plegado abajo, con su historia y un botón para
reincorporarlas.

## El asistente de temporada pregunta quién sigue

Es el momento natural para resolverlo: al crear la temporada nueva, un segundo
paso trae a todo el equipo anterior **tildado y con su rol precargado**, y con
el dato que hace falta para decidir —cuánto vendió cada una y si debe rendir—.
Se destilda a las que se fueron y se les cambia el rol a las que pasan a la
puerta.

El pie no es decorativo: dice *"Seguirán 11 de 12 · Beatriz queda fuera con
deuda pendiente"*. Dejar afuera a alguien que todavía debe plata es una
decisión válida, pero no puede ser una que se tome sin verla; por eso el pie
vive fuera de la lista que scrollea.

## C16 · Fase 1 — el saldo de la corista y los accesos que sobraban

**El bug.** "Mi rendición" en la home de la corista apuntaba a
`/panel/rendiciones`, que está bajo `RequireAdmin`: tocaba y rebotaba al
inicio. El número no se veía en ningún lado, así que la única forma de saber
cuánto tenía que entregar era preguntárselo a Eli.

Ahora viaja en `GET /api/home` como `my_settlement` y se muestra en su home.
Sale de **la misma consulta que usa Plata** —`SettlementsReport` filtrada por
su fila— y no de un cálculo nuevo: dos cuentas del mismo saldo terminan
discrepando, y esa discusión la pierde siempre la corista. Hay un test que
compara los dos números y falla si divergen.

El bloque tiene dos estados, y el segundo importa tanto como el primero: con
saldo va en ámbar con el monto y cuántas ventas lo componen; sin saldo dice
**"Estás al día"** en verde. Un bloque que desaparece cuando no hay deuda deja
a la persona sin saber si está al día o si la app no se enteró.

**El panel de ventas se fue.** `SalesReportPage` mostraba la misma franja que
Ventas y agrupaba por corista o por función, que ya resuelven los filtros de
Ventas y la columna "Vendidas" de Equipo. Se eliminó la pantalla, el cliente,
el handler y la query `SalesReport`. Los dos tests que lo usaban ahora le
hacen la misma pregunta al listado (`GET /api/sales`), que es donde vive: la
invariante de que una venta anulada no cuenta sigue cubierta.

`/panel/ventas` queda como redirect a `/ventas`. Todas las rutas que C16
elimina quedan redirigiendo: hay links en emails y favoritos en celulares que
no se pueden romper.

**Una acción primaria por pantalla.** La home tenía tres botones de "Nueva
venta" —header, fila del celular y CTA del hero de la corista— y dos de "Modo
puerta". Queda uno de nueva venta por viewport: el del header en escritorio, el
de abajo del hero en celular. Es la misma acción declarada una vez por
breakpoint, no dos botones. "Modo puerta" salió de la home: es una pestaña de
la navegación.

Los "Accesos rápidos" se eliminaron enteros. Repetían la lateral, y uno de sus
cuatro links era justamente el que estaba roto.

**"Vender" pasa a "Ventas"** en la navegación: la pantalla es el listado;
vender es una acción adentro.

## C16 · Fase 2 — una sola temporada para toda la app

`SeasonPage`, `SettlementsPage`, `DireccionPage` y `UsersPage` llamaban cada
una a `listSeasons` y guardaban su propia elección. Cambiar de temporada en
Rendiciones no cambiaba Temporadas, y las cuatro podían estar mirando años
distintos a la vez sin que nada lo dijera.

Ahora hay un `SeasonProvider` y el selector vive **arriba de la navegación**,
no adentro de una pantalla: la temporada es contexto de todo lo que está
debajo, no una opción de una vista.

**La fuente de verdad es `?t=<id>` en la URL**, con `localStorage` como memoria
entre sesiones y la temporada en curso como default. La URL primero porque así
un link comparte lo que la persona está viendo; y si se eligió una que no es la
en curso, el provider la escribe en la URL aunque se haya llegado por un link
sin parámetro — recargar cae en la misma temporada.

**Que no sea la temporada en curso se ve sin abrir el menú**: un punto verde
cuando lo es, un chip "Cerrada" cuando no. Es la diferencia entre mirar el año
pasado y creer que estás mirando el de ahora.

Sólo dirección elige. La corista y la puerta operan siempre sobre la temporada
en curso: para ellas ni se pide la lista, y `GET /api/home?season_id=` ignora
el parámetro si no es admin.

### Dos cosas que el selector obligó a arreglar

**Ventas no estaba acotada a una temporada.** El listado mezclaba todos los
años: con una sola temporada cargada no se notaba, pero el selector lo habría
vuelto mentira al toque. `ListSalesPage` y sus tres agregados —el resumen, el
resumen filtrado y los subtotales por función— ahora filtran por
`f.season_id`, igual que el export y el menú de vendedoras.

**La home tampoco.** `GET /api/home` usaba siempre la temporada activa, así que
el selector podía decir 2025 mientras la home mostraba la próxima función de
2026. Acepta `season_id` para dirección. El subtítulo dejó de repetir el nombre
de la temporada: lo dice el selector, dos centímetros más arriba.

El asistente de alta salió de `SeasonsPage` a `season/NuevaTemporada.tsx`, para
que "Crear temporada…" se pueda abrir desde el selector sin pasar por el
índice. `SeasonsPage` lo importa; no hay dos formularios.

## C17 · Pieza A — una organización por grupo

Acapelius deja de ser la app de un coro: cada grupo es una `organization` y
todo lo que tiene dueño cuelga de ella. Backend puro; la app no cambia.

**La columna va sólo en `users` y `seasons`.** Lo demás —funciones, ventas,
entradas, ingresos, cupos, participación, rendiciones, cobros, recordatorios,
envíos— cuelga por FK de una de esas dos y se filtra por join a `seasons`. Un
join más por consulta es barato y no duplica la verdad; una columna repetida
en diez tablas es diez lugares donde puede quedar mal.

**El filtro es un parámetro de cada consulta, no Row-Level Security.** Se
evaluó RLS y se descartó: el rol con el que la app se conecta a la base local
es superusuario con `bypassrls`, así que las políticas se ignorarían en
silencio y el aislamiento sería un decorado. Con el parámetro no hay
ambigüedad: 99 consultas de sqlc reciben `organization_id`, y
`internal/db/isolation_guard_test.go` recorre por reflexión todos los métodos
de `Queries` y falla si alguno no lo lleva —salvo los que están en su lista
con motivo (las públicas, el login, y las hijas de una venta ya resuelta).
Agregar una consulta sin filtro no compila con los tests.

**La organización sale de la sesión, y fallar es cerrado.** `s.org(ctx)` lee
`OrganizationID` del usuario cargado en el contexto. Sin sesión vale 0, que no
coincide con ninguna organización: si a un handler se le escapara una
consulta, no vería nada en vez de ver todo. La cookie sigue guardando sólo
`user_id`; la organización viene de la fila del usuario, que nadie puede
falsificar desde afuera.

**Un recurso ajeno no existe: 404, nunca 403.** Las consultas por id llevan
el filtro en el `WHERE`, así que una venta, función, temporada o persona de
otra organización devuelve `ErrNoRows` y cae en el mismo 404 que un id
inventado. Un 403 confirmaría que el id existe en otro lado. Lo mismo para
los filtros `?season_id=` y `?function_id=`: pedir un listado "de la
temporada de otro" es pedir un recurso ajeno, y responde 404 en vez de una
lista vacía. `?seller_id=` de otra organización sí devuelve vacío: es un
filtro sobre lo propio, no un recurso.

**Escribir sobre algo ajeno tampoco inserta.** Los `INSERT` que reciben un
id (crear venta sobre una función, sumar a alguien a una temporada, asignar
cupo, rendir) están escritos como `INSERT … SELECT … WHERE` la función o la
temporada sea de la organización: con un id ajeno no insertan nada y el
handler recibe `ErrNoRows`. Las acciones masivas (`bulk-payment`,
`bulk-resend`) traen las ventas acotadas y comparan cuántas pidieron con
cuántas volvieron: si falta una, 404 y no se toca ninguna.

**El email es único por organización, no global.** La misma persona puede
cantar en dos grupos. El login prueba la contraseña contra cada cuenta con
ese email, empezando por la que entró más recientemente, y abre la primera
que coincide. Si alguien tiene exactamente la misma contraseña en dos
grupos entra al que usó último; puede cambiar una de las dos. Se anota como
límite conocido; la alternativa (elegir organización en el login) es una
pantalla más para un caso que todavía no existe.

**Una sola temporada en curso por organización, garantizado por la base.**
Índice parcial `seasons_one_active_per_org`. Obligó a partir "activar" en
dos pasos —apagar todas, encender una— dentro de una transacción: un solo
`UPDATE … SET is_active = (id = $1)` chocaba con el índice cuando Postgres
procesaba la nueva antes de apagar la vieja. Por lo mismo `CreateSeason`
recibe `is_active`: crear una inactiva y "restituir" la anterior ya no hace
falta.

**Migración.** `00012_organizations.sql` crea la tabla, agrega la columna a
`users` y `seasons`, y si hay datos crea "Coro Acapelius" (`choir`, slug
`acapelius`) y se los asigna: hoy hay un solo coro, el UPDATE no tiene
ambigüedad. En una base vacía no crea nada; la organización la crea `make
seed` (o, en la pieza B, el alta de cuenta). Verificado en la base local con
los datos del coro: 12 personas, 1 temporada, 48 ventas, 4 funciones, todos
en la organización 1, y cada endpoint devuelve exactamente lo mismo que
antes.

**Vocabulario (A.3).** `useTerms()` en `web/src/auth/terms.ts` lee el
`kind` de la sesión y devuelve corista/integrante, el coro/el elenco,
lugar/sala. Está listo para que ningún componente nuevo escriba "corista" a
mano. Los 17 archivos que hoy lo tienen escrito **no se tocaron** en esta
pieza: A es backend puro, y ese barrido es un cambio de UI que va con la
primera organización `theatre` real (pieza B o después), no antes.

**Pendiente que esto deja a la vista:** `cmd/seeddemo` genera SQL contra el
esquema viejo (`users.role`, `users.is_active`) y no corre desde
`season_members`; lo rehace la pieza C, que necesita sembrar la organización
demo de todas formas.

## C17 · Pieza B — la landing, el alta y la app en /app

**La app se mudó a `/app`; la raíz es de la landing.** `base: '/app/'` en
Vite y `basename` en el router. Las páginas públicas de entradas (`/e/`,
`/t/`) se quedan en la raíz —hay links en emails ya enviados— y son las
únicas rutas del SPA sin el prefijo: `main.tsx` elige el `basename` mirando
la URL. Las rutas viejas de la app (`/ventas`, `/puerta/3`, `/panel/…`)
responden 301 a `/app/…` conservando la query: es la regla del 404 de Go
para cualquier ruta sin extensión.

**El login salió de la app.** Sin sesión, `/app/*` manda a
`/entrar?next=…` (una página del sitio, no un componente); al entrar vuelve
a `next` sólo si empieza con `/app`. `LoginPage.tsx` se borró: un solo login,
en el lenguaje afiche. En desarrollo Vite proxea `/entrar`, `/crear-cuenta`,
`/demo` y `/site` al server Go, así que el flujo es el mismo que en
producción; el frontend se abre en `http://localhost:5173/app/`.

**El sitio público es HTML estático embebido en el binario, sin bundle.**
Vive en `web/src/public/` (landing, alta, login, demo, `afiche.css`,
`site.js`, fuentes y la imagen de Open Graph) y Go lo sirve con
`//go:embed`. Tokens propios (`--paper`, `--ink`, `--ticket`, `--indigo`);
nada de los tokens de la app, ni al revés. Las fuentes (Anton, JetBrains
Mono, Inter) se sirven desde `/site/fonts/` con `font-display: swap` y sólo
Anton se precarga: es la que dibuja el titular. Lighthouse local de la
landing: 99 rendimiento, 100 accesibilidad, 100 buenas prácticas, 100 SEO
(99/100 en mobile); la landing no descarga `/app/assets/*`.

**La imagen de Open Graph es una captura.** `og.png` se generó con Chrome a
partir de un HTML en el mismo lenguaje; no hay pipeline: si cambia el
titular, se vuelve a capturar. Las URLs absolutas de `og:image` y
`canonical` van escritas en el HTML (el dominio es uno solo).

**`POST /api/signup` hace todo en una transacción**: organización, su
dirección (sin contraseña provisoria: la acaba de elegir), la primera
temporada activa (`Temporada <año>`) y la membresía admin; después abre la
sesión (`auth.OpenSession`) y la página manda a `/app`. Contraseña ≥ 10
(`domain.MinSignupPasswordLength`, más alta que la de las coristas: es la
cuenta que administra todo). El slug sale del nombre (`domain.Slugify`) con
sufijo `-2`, `-3`… si choca. Límite de 5 requests por hora por IP —cuenta
también las que fallan la validación— y un campo `website` invisible: si
viene lleno, responde "listo" vacío y no crea nada.

**Sin verificación de email.** Deuda conocida (spec §B.3): hoy cualquiera
crea una cuenta con cualquier email. Va junto con "olvidé mi contraseña",
que tampoco existe: la página de login dice que se la pida a la dirección.

**Las PWAs instaladas antes de `/app` tenían un service worker con alcance
`/`.** Ese SW habría respondido la landing con la shell vieja cacheada.
`/sw.js` ahora sirve un worker de baja: borra los caches, se desregistra y
recarga las pestañas, que registran el nuevo en `/app/sw.js` con alcance
`/app/`. El manifest viejo (`/manifest.webmanifest`) sigue existiendo con
`start_url: /app/`, y los íconos y `email-logo.png` (que usan los mails ya
enviados) se siguen sirviendo en la raíz.

**`/demo` todavía no es la demo.** Hasta la pieza C es una página que lo
dice y ofrece crear la cuenta; los botones "Probar la demo" ya apuntan ahí
para no tocar la landing después. Términos, privacidad y contacto no
existen: el pie no los promete.

**Los mails de invitación apuntan a `/entrar`**, no a la raíz: con sesión la
raíz redirige a la app, pero sin sesión mostraba la landing a alguien que
sólo quería loguearse.

## C17 · Pieza C — la demo es una organización más

**Una organización con `is_demo`, no un sistema aparte.** `internal/demo`
la siembra: dirección, 10 integrantes (dos que nunca entraron), una persona
en la puerta, cuatro funciones (tres hechas, una en venta), 50 ventas con
los cuatro estados de pago más una anulada, cortesías, cupos derivados de lo
vendido (el cierre queda con 58 sin asignar a propósito), ingresos con
asistencia dispareja —la gala se vendió bien y fue el 25%: es el hallazgo
que Dirección tiene que mostrar— y rendiciones parciales. Nombres
inventados; mails en `@demo.acapelius.local`, que no rutea.

**`Reset` borra y vuelve a sembrar, en una transacción, sólo lo de esa
organización.** Como casi ninguna FK tiene `ON DELETE CASCADE`, el borrado
va en el orden que exigen las claves, siempre con un join a la organización
demo: el resto de la base ni se mira. El id de la organización se conserva
entre reinicios, así las sesiones abiertas siguen apuntando a ella. Lo
corren tres cosas: el server al arrancar si la demo no existe
(`EnsureSeeded`, para que un deploy nuevo la tenga sin pasos a mano), una
goroutine del server todas las noches a las 4 (hora de `TZ`; hay una sola
instancia, no hace falta un scheduler afuera), y `make demo-reset` /
`go run ./cmd/demoreset`. `DEMO_ENABLED=false` apaga las dos primeras.

**La sesión de invitado es una sesión común con vencimiento propio.**
`POST /api/demo/session` abre sesión como la dirección de la demo y guarda
`demo_until` (6 horas) en la sesión; `CurrentUser` la destruye pasada esa
hora aunque la cookie viva 30 días. Con el rate limit del login. `/demo` la
llama sola al cargar y manda a `/app`: en local, un segundo.

**En la demo no sale ningún mail: `email_status: preview`.** Los tres
puntos que mandan (entrada, invitación, recordatorio) preguntan
`auth.IsDemo(ctx)` y devuelven `preview` sin tocar el driver; el registro
(`email_sends`, `settlement_reminders`) queda con ese estado, que la
migración 00013 agrega a los `CHECK`. La app lo muestra donde diría
"enviada": "En la demo no se mandan mails" y el link de la entrada, que ya
estaba en pantalla. Se eligió no cambiar el driver por request: un driver
`preview` que devuelva éxito diría "enviada" y mentiría; uno que devuelva
error diría "no salió" y también.

**Lo bloqueado**: cambiar la contraseña (403: la cuenta es compartida y
dejaría afuera al siguiente). No hay "eliminar organización" que bloquear.
El resto está habilitado a propósito, incluso crear gente y anular ventas:
el reinicio lo deshace.

**La barra de la demo es la única concesión afiche adentro de `/app`**:
fija arriba, negra con el botón en `--ticket`, tipografía mono; la shell se
corre 34px y la navegación de escritorio también. Colores propios en el
CSS, no tokens de la app.

**`cmd/seeddemo` se borró.** Generaba SQL contra el esquema anterior a
`season_members` (ya no corría) y sembraba dentro del coro real; la demo lo
reemplaza con la misma idea en su propia organización.

## C17 · Pieza D — la entrada pública es un talón

`/e/{code}` y `/t/{code}` son lo único del producto que ve gente que no usa
la app, y son literalmente una entrada: el lenguaje afiche les queda mejor
que el de Papel pautado. Siguen siendo rutas del SPA (el QR se dibuja en el
browser con el payload firmado; eso no cambió), pero con su propio CSS
(`web/src/pages/entrada.css`) y sus propios tokens bajo `.ent`: no usan los
de la app ni la app usa los suyos. Las fuentes son las del sitio público,
servidas por Go en `/site/fonts` (Vite avisa que no las resuelve en el
build; es lo esperado: se resuelven en runtime).

El talón: cabecera negra con la función, la fecha en mono y la sala; "a
nombre de" con el comprador y el chip de cortesía; el troquel punteado con
las dos muescas; un QR por entrada con su etiqueta ("Entrada 2 de 3 · ya
ingresó") y el botón de reenviar cuando la compra tiene más de una. Una
venta anulada muestra el aviso en el lugar de los QR, en rojo. Pie con quién
la vendió. Se borró el bloque de estilos viejo de `styles.css`.

## C18 · Paso 1 — tokens y primitivos en lenguaje afiche

La app deja Papel pautado y pasa al sistema de la landing, con otra
intensidad: papel, bordes de 2px, cero radios, cero sombras, mono en
mayúsculas para etiquetas, Anton para cifras y títulos. Este paso reescribe
los tokens y los primitivos de `src/ui/` y deja `/app/dev/ui` como
inventario; las pantallas se van después, una por una.

**Los tokens viejos siguen existiendo como puente, apuntando a la paleta
nueva.** `styles.css` tiene 7.000 líneas que nombran `--bg`, `--surface`,
`--line`, `--indigo-soft`… en cientos de reglas que todavía no se
reescribieron. Borrarlos hoy dejaba media app sin color. Están en un bloque
marcado "PUENTE" al final de `:root`, apuntando cada uno a su equivalente
afiche (`--surface` → `--paper2`, `--indigo-soft` → `--paper3`, etc.), así
la app entera cambia de temperatura ya y ningún estilo nuevo los usa. El
bloque se borra en el paso 5, cuando el grep de tokens viejos dé cero.

**Radios y sombras se borraron de una, no rule por rule.** Las 140 líneas
`border-radius` y las 17 `box-shadow` del CSS eran declaraciones sueltas;
se eliminaron en bloque, más los dos estilos inline (menú de la cuenta,
formulario de venta). `grep -r "border-radius\|box-shadow" web/src
--exclude-dir=public` da cero. El foco pasa a `outline: 2px solid --ticket`
(la sombra era el anillo de foco). Las muescas del troquel de la entrada
pública, que eran círculos, ahora son cuadrados girados.

**Anton tiene un solo peso.** Las reglas viejas piden `font-weight: 800`
sobre `--font-display`; sin `font-synthesis: none` el browser fabrica una
negrita falsa. Con eso, cualquier `800` que quede sobre Anton rinde el peso
real. Hasta que cada pantalla se reescriba, algunas etiquetas chicas que
eran Archivo 10px uppercase salen en Anton en vez de mono: se ven como
etiqueta condensada, no rompen nada, y se corrigen pantalla por pantalla.

**Contraste (aceptación §8.4), calculado:** tinta/papel 16.3 · `--ink2`
sobre papel 6.5, sobre papel3 5.9, sobre papel2 7.3 · chips de contorno
sobre papel2: ok 6.5, warn 5.9, bad 7.1, índigo 7.8 · papel sobre
`--ticket` (botón primario) 4.54 · papel sobre `--warn` (filtro "Deben"
activo) 5.3. **Uno no llegaba**: el eyebrow del hero, `--ticket` sobre tinta,
da 3.6. Se agregó `--ticket-on-ink: #EC6E4C` (5.1:1) para texto naranja
sobre fondo tinta; `--ticket` sigue igual como fondo y acento. Es el único
hexa fuera de la lista del spec, y está documentado acá.

**Lo que cambió de forma sin cambiar de API:** Button (primary ticket,
ghost papel2 + borde tinta, ink, danger contorno; 44px, `--xs` 36px),
StatusChip (contorno 1.5px, mono 9.5px, `min-width: 74px`, anulada
tachada), Panel (2px tinta, `.panel__head` con borde inferior 2px y título
Anton), tabla de Ventas (thead papel3 mono 9px, filas 44px con 1px `--hair`,
hover papel3), tira de resumen (celdas con troquel punteado), hero de
función (tinta, eyebrow naranja), FilterChips (1.5px, activo tinta, "Deben"
activo ámbar), Input/Select/Search (2px tinta, foco naranja), Sheet/Modal
(2px tinta, scrim `rgba(20,20,20,.55)`), Avatar (cuadrado, 1.5px, Anton,
sin fondo), TabBar (borde superior 2px, activa en tinta, separadores 1px),
Sidebar (borde derecho 2px, temporada arriba separada por 1px, ítem activo
tinta con borde izquierdo ticket). Ningún componente cambió props ni
comportamiento; los 53 tests de front pasan sin tocar.

**`/app` con barra.** Vite en desarrollo sirve `/app/` pero no `/app`; el
login y la demo mandan ahora a `/app/`, que en producción Go resuelve igual.

## C18 · Paso 2 — Ventas

La pantalla más densa, y la prueba de que el sistema aguanta: casi todo
vino de los primitivos del paso 1. Lo que hubo que decidir a mano:

**Qué va en cada tipografía dentro de la fila.** Comprador y vendedora en
Inter (son nombres, se leen); cantidad y total en Anton 14px (son cifras,
se miran); fecha de venta y estado de entrega en mono 10px en mayúsculas
(son datos). El mockup pone a la vendedora en mono; el spec manda Inter
para nombres de personas, y el spec gana. En celular el renglón "3 entradas
· vendió Carolina Vega" vuelve a Inter por lo mismo: lleva un nombre.

**Las etiquetas chicas que heredaban Anton pasaron a mono de una vez, en
todo el CSS.** Toda regla con `--font-display`, mayúsculas y cuerpo ≤ 11.5px
era una etiqueta de Archivo; un script las cambió a `--font-mono` (15
reglas). Lo que queda en Anton (60 reglas) son títulos, cifras y
contadores. Se sacaron de Anton los dos únicos inputs que lo usaban (monto
de cobro y cupo por corista): un campo se lee mientras se escribe.

**La tira de resumen y el sheet.** `.tstrip` (la de Ventas y Temporadas) es
ahora el contenedor de 2px con troqueles punteados, igual que `.sumstrip`.
En la cabecera del sheet, la regla `.sheet-head span` alcanzaba también al
contenedor del nombre y lo pasaba a mono en mayúsculas; ahora solo el
renglón de datos es mono.

**La barra de selección** dejó el carbón redondeado: tinta con borde de
2px, título en Anton y acciones en mono con contorno papel. El aviso de
lote es papel2 con borde verde.
