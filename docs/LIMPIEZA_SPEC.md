# Acapelius — Limpieza y lavado de cara (C16)

> Consolidación del frontend: eliminar vistas y accesos duplicados, reducir la navegación a cinco destinos planos y que cada dato viva en un solo lugar. Referencia visual canónica: `design/acapelius-limpieza.html` (incluye el análisis completo con archivos y líneas).
>
> Relevado sobre `fd8847a`. **Ventas (C15) y Puerta no se tocan.** Todo usa los tokens de Papel pautado y los componentes existentes (`ActionPanel`, `Menu`, `StatusChip`, `controls`).

---

## Principios

1. **Cada destino responde una sola pregunta** y no muestra datos que son de otro.
2. **Una acción primaria por pantalla.** Nada de repetir el mismo botón en el header, en una fila del celular y en un acceso rápido.
3. **La navegación es la lateral / la barra de abajo.** Ninguna pantalla repite la navegación con "accesos rápidos".
4. **Un dato, un lugar.** Si otra pantalla lo necesita, linkea; no lo recalcula.

## El mapa

| Rol | Hoy | Propuesta |
|---|---|---|
| Dirección | Inicio · Vender · Puerta · Dirección ▸ (Rendiciones, Asistencia, Temporadas, Equipo) · Panel de ventas | **Inicio · Ventas · Puerta · Temporada · Plata** |
| Corista | Inicio · Vender · Puerta | Inicio · Ventas · Puerta |
| Puerta | Puerta | Puerta |

Sin segundo nivel. En el celular la barra muestra las cinco pestañas completas (se elimina el patrón de "Dirección" que agrupaba cinco destinos).

### Rutas

| Ruta actual | Ruta nueva | Nota |
|---|---|---|
| `/` | `/` | Home unificada (Fase 5) |
| `/ventas`, `/ventas/nueva` | igual | Solo renombrar la etiqueta "Vender" → "Ventas" |
| `/puerta`, `/puerta/:id` | igual | Sin cambios |
| `/direccion` | **se elimina** → redirect a `/` | Contenido repartido (ver Fase 5) |
| `/temporadas` | **se elimina** → redirect a `/temporada` | El índice pasa al selector global |
| `/temporadas/:id` | `/temporada` (usa la temporada del selector) | Pestaña Funciones |
| — | `/temporada/funciones/:fnId` | Detalle de función (master-detail) |
| `/panel/asistencia` | **se elimina** → redirect a `/temporada` | Pasa a pestaña del detalle de función |
| `/usuarios` | `/temporada/equipo` | Pestaña Equipo |
| `/panel/rendiciones[/:sellerId]` | `/plata[/:sellerId]` | Renombre + barra de plata |
| `/panel/rendiciones/historial` | `/plata/entregas` | |
| `/panel/ventas` | **se elimina** → redirect a `/ventas` | Sin contenido propio |

**Todas las rutas eliminadas quedan como `<Navigate replace>`** durante al menos una temporada: hay links en emails y en favoritos del celular.

---

## Fase 1 — Arreglos sin riesgo

**1.1 Bug: "Mi rendición" de la corista.** `HomePage` apunta a `/panel/rendiciones`, que está bajo `RequireAdmin` en `App.tsx`: la corista rebota al inicio. Se reemplaza el acceso por un bloque en su home (ver 5.3). Backend: `GET /api/home`, para rol `seller`, agrega:
```json
"my_settlement": { "collected_cents": 124000, "settled_cents": 80000, "balance_cents": 44000, "sales": 3 }
```
Reutilizar la misma query que usa Rendiciones para una corista (no un cálculo nuevo).

**1.2 Eliminar `SalesReportPage`** (`/panel/ventas`) y `api.salesReport` del cliente. Si el endpoint no tiene otros consumidores, eliminarlo también del backend con su test.

**1.3 Eliminar "Accesos rápidos"** de `HomePage` (bloque `.qa` y el componente `QuickAccess`) para ambos roles.

**1.4 Un solo "Nueva venta" por pantalla.** En `HomePage` hoy hay tres (header, fila `.home-actions` del celular, CTA del hero de la corista). Queda **uno**, en el header, responsive: en celular se renderiza debajo del hero en el mismo componente, no duplicado. El CTA del hero de la corista se elimina. Idem "Modo puerta": sale del header y de la home; su lugar es la pestaña.

**1.5 Etiqueta "Vender" → "Ventas"** en `nav.ts` (la pantalla es el listado; vender es una acción dentro).

**Aceptación Fase 1:** una corista ve su saldo a rendir en la home sin navegar; `/panel/ventas` redirige a `/ventas`; en la home hay exactamente un botón de nueva venta por viewport; no existe `QuickAccess`.

## Fase 2 — Un solo selector de temporada

Hoy `SeasonPage`, `SettlementsPage`, `DireccionPage` y `UsersPage` llaman cada una a `listSeasons` y guardan su propia elección.

- Nuevo `SeasonProvider` (contexto) con la temporada activa. Fuente de verdad: query param `?t=<seasonId>` si existe; si no, la temporada en curso (`is_active`). Persistir la última elegida en `localStorage` (es preferencia de UI, no dato de negocio).
- **El selector vive arriba de la navegación** en la lateral (desktop) y en el header (mobile), con el componente `Menu`: opciones con estado ("En curso" / "Cerrada · N funciones") y, separadas, las acciones **"Crear temporada…"** (abre el asistente que hoy está en `SeasonsPage`) y **"Ver todas"**.
- Las cuatro páginas dejan de llamar a `listSeasons` y consumen el contexto. Cambiar la temporada cambia **toda** la app.
- Visible solo para admin. La corista y la puerta siempre operan sobre la temporada en curso.

**Aceptación Fase 2:** elegir "Temporada 2025" en el selector y navegar a Plata, Temporada y Ventas muestra 2025 en las tres; `grep listSeasons web/src/pages` devuelve cero resultados.

## Fase 3 — Temporada (fusión de Temporadas, Asistencia y Equipo)

`/temporada` con dos pestañas: **Funciones** y **Equipo**. Header: nombre de la temporada, rango de fechas, cantidad de funciones y de coristas; acción: `＋ Agregar función` (ghost: la primaria de la app es nueva venta).

### 3.1 Pestaña Funciones — master-detail
- **Izquierda**: lista compacta de funciones (próximas primero). Cada fila: nombre + chip (`EN N DÍAS` índigo / `HECHA`), línea secundaria con el dato que importa según estado (`31 sin asignar` si está en venta, `entró el 48%` si ya pasó), barra de ocupación, `vendidas/cupo`.
- **Derecha**: detalle de la función seleccionada (URL `/temporada/funciones/:fnId`): header con Editar, franja de 4 cifras (vendidas, recaudó, entraron, cortesías) y un segmentado **Asignación | Asistencia**.
  - **Asignación** = el `AllocationsEditor` actual. Es el **único** lugar de la app donde se asigna.
  - **Asistencia** = el contenido de `AttendancePage` para esa función (una fila por comprador, `k/N`, toggle Ingresaron/Faltan). Si la asistencia es < 60%, mostrar arriba el insight en rojo ("Entró menos de la mitad…") — reemplaza al hallazgo de Dirección.
- Por defecto se selecciona la próxima función; si no hay, la última.
- En mobile: lista → navegar al detalle (misma URL).

### 3.2 Pestaña Equipo
El contenido actual de `UsersPage` (ya trabaja con `season_members`) sin su selector de temporada propio. **Se quita la columna "Sin rendir"** (vive en Plata); queda Persona, Vendidas, Uso del cupo, Último acceso, Estado.

### 3.3 Qué se elimina
- `AttendancePage` como ruta (su contenido se reusa como componente).
- `SeasonsPage` como ruta (el asistente de alta pasa a un pop-up disparado desde el selector global).
- El editor de asignaciones de `DireccionPage`.

**Aceptación Fase 3:** `AllocationsEditor` se importa en un solo archivo; la asistencia de una función se ve solo desde su detalle; `/panel/asistencia`, `/temporadas` y `/usuarios` redirigen.

## Fase 4 — Plata (ex Rendiciones)

`/plata`. Misma pantalla de rendiciones con dos cambios:
1. **Arriba, la barra de plata** que hoy está en `DireccionPage` (`Plata` component): "Vendido en la temporada" + barra de tres tramos (en tu poder / la tienen las coristas / todavía sin cobrar). Reutilizar `money` del endpoint actual o moverlo a `GET /api/plata?season_id=`.
2. Debajo, grilla 1.75/1: **Quién tiene que rendir** (la lista actual, con Registrar en pop-up) y **Entregas** (últimas rendiciones, link a `/plata/entregas`). Click en una corista → `/plata/:sellerId` (el detalle ya diseñado, sin cambios).

Acción del header: `✉ Recordar a las N` (ghost). Badge de la pestaña: coristas que deben rendir.

**Aceptación Fase 4:** el número "sin rendir" se calcula en un solo endpoint y aparece solo en Plata (y como badge); `/panel/rendiciones/*` redirige a `/plata/*`.

## Fase 5 — Una sola home y adiós a Dirección

### 5.1 Home de dirección
- **Header**: "Hola, Eli" + fecha; acción `＋ Nueva venta`.
- **Hero** (carbón): próxima función, barra de venta, stats `Recaudó` y `Sin asignar` (este último en ámbar si > 0) y, si falta asignar, el botón **Asignar entradas** que abre el editor de esa función. Por eso el cupo sin asignar **deja de ser una alerta** en la lista.
- **Izquierda — Pendiente · N**: una card con grupos: *Rendiciones* (top 3 con monto y Registrar en pop-up; pie "Ver las N en Plata ›") e *Invitaciones sin usar* (agrupadas en una fila con Reenviar).
- **Derecha — Qué pasó**: feed de los últimos 7 días que mezcla ventas, rendiciones y recordatorios. Es lo único de la home que no existe en otra pantalla. Endpoint nuevo: `GET /api/activity?season_id=&days=7&limit=8`.
- Se eliminan de la home: "La temporada", "Últimas ventas" (lo cubre el feed) y los accesos rápidos.

### 5.2 Eliminar `DireccionPage`
Su contenido ya quedó repartido: plata → Plata (Fase 4), asignaciones y funciones → Temporada (Fase 3), hallazgo de asistencia → detalle de función (Fase 3), hallazgo de cortesías → franja del detalle de función. Eliminar la ruta, el componente y, si no tiene otros consumidores, `GET /api/direccion`.

### 5.3 Home de la corista
Header + hero con **su** cupo ("Vendiste 17 de 20 · te quedan 3") + `＋ Nueva venta` + bloque **Tenés que rendir** (de `my_settlement`, en ámbar, texto "Lo que cobraste y todavía no le diste a Eli · N ventas"; si es 0, estado positivo "Estás al día") + **Te falta cobrar · N** (lista actual). Nada más.

**Aceptación Fase 5:** existe una sola pantalla de resumen; `/direccion` redirige a `/`; la home de dirección no muestra ningún listado que exista también en Ventas, Temporada o Plata; el feed muestra una rendición registrada hace un minuto sin recargar (invalidación de queries).

---

## Navegación final (`nav.ts`)

```ts
admin:  Inicio · Ventas(badge: sales_pending) · Puerta · Temporada · Plata(badge: settlements_pending)
seller: Inicio · Ventas · Puerta
door:   Puerta
```
Se elimina `section: 'direccion'` y la lógica de `activeItem` que desempataba primer y segundo nivel. `tabsFor` pasa a ser igual a `navFor`.

## Orden y reglas de trabajo

- **Fases en orden, una por PR**, cada una con sus tests y sus criterios verificados. Fase 1 primero porque arregla un bug en producción y no tiene riesgo; Fase 5 última porque toca el endpoint de la home.
- No agregar pantallas nuevas fuera de este documento. Si algo no entra en los cinco destinos, anotarlo en `DECISIONS.md` y preguntar.
- Al cerrar cada fase, correr `grep` de verificación: rutas viejas solo como redirect, `listSeasons` fuera de las páginas, `AllocationsEditor` importado una vez.
- Mobile: la barra de abajo reparte las pestañas del rol en columnas iguales (5 / 3 / 1).

## Criterios de aceptación globales

1. Admin ve 5 destinos planos en la lateral y 5 pestañas en el celular, sin segundo nivel.
2. `SalesReportPage`, `DireccionPage`, `AttendancePage` (como ruta), `SeasonsPage` (como ruta) y `QuickAccess` no existen.
3. Un solo selector de temporada que gobierna toda la app.
4. `AllocationsEditor` en un solo lugar; asistencia solo en el detalle de función; "sin rendir" solo en Plata.
5. Cada pantalla tiene una sola acción primaria.
6. La corista ve cuánto tiene que rendir desde su home.
7. Toda ruta eliminada redirige; ningún link interno apunta a una ruta vieja.
8. Ventas y Puerta sin regresiones visuales.
