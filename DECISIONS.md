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

**Las funciones que ya pasaron viven detrás de un link** que dice para qué
sirven: corregir un ingreso. Es la excepción, no el default.

**La copia local se baja acá, no al entrar.** El modo puerta ya funcionaba
offline, pero la primera bajada necesita conexión y se hacía recién al abrir la
puerta —adentro del teatro, que es justo donde puede no haber señal—. Ahora la
pantalla de selección prepara el snapshot de la función destacada y lo dice:
"Listo para trabajar sin conexión · sincronizado hace 2 min". Si nunca se pudo
bajar y no hay copia previa, lo avisa en ámbar en vez de dejarlo pasar.

`comp_tickets` se sumó a `ListFunctions`, que leen todos los roles. Es un
conteo, no plata: mantiene la regla de esa query, y en la puerta importa saber
cuántos de los que vienen no pagaron entrada.

"Ver quiénes compraron" aparece sólo para dirección: Asistencia es una pantalla
suya, y a la persona de la puerta el botón la mandaría a un redirect.
