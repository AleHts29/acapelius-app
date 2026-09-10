# Acapelius — Sección Vender (C15)

> Spec de la pestaña **Vender** en desktop: listado de ventas, tabla, estados, acciones y selección múltiple. Referencia visual canónica: `design/acapelius-ventas-estado.html` (tabla final y la comparación de tratamientos de la columna Estado) y `design/acapelius-ventas-listado.html` (versión mobile, sigue vigente).
>
> Complementa `CAMBIOS_V2.md` (C3, listado de ventas) y `CAMBIOS_V3.md` (C11 paleta, C13 desktop, C14 pop-ups). Todo lo de acá usa los tokens de **Papel pautado** y los componentes ya existentes: `SearchBar`, `FilterChips`, `StatusChip`, `ActionPanel`, `Menu`.

---

## 1. Alcance

En desktop (≥1024px), la pestaña **Vender** muestra por defecto el **listado de ventas**: todas para dirección, solo las propias para una corista. El registro de una venta nueva es una pantalla aparte, no un pop-up (es un flujo de varios campos). En mobile no cambia nada respecto de lo ya implementado.

## 2. Estructura de la vista

```
Header de página        título + subtítulo + [＋ Nueva venta]
Franja resumen          4 casillas en un solo contenedor con divisores
Toolbar                 búsqueda + filtros (chips y menús)
Bloques por función     una caja por función, separadas 20px
Barra de selección      flotante, solo cuando hay filas seleccionadas
```

### 2.1 Header
- Título "Ventas". Subtítulo: `Temporada 2026 · N ventas` (o `N ventas con pago pendiente` cuando hay filtro activo).
- Acción primaria a la derecha: **＋ Nueva venta** (índigo). Nunca FAB en desktop.

### 2.2 Franja resumen
Un solo contenedor blanco con 4 celdas separadas por divisores de 1px (no cuatro cards sueltas):
`Entradas vendidas` · `Cobrado` (verde) · `Por cobrar` (ámbar) · `Cortesías`.
Los valores respetan el filtro activo.

### 2.3 Toolbar
En una línea: `SearchBar` (máx. 340px, placeholder "Buscar comprador o vendedora…") + chips de estado `Todas · N` / `Deben · N` / `Pagas` / `Cortesías` + menús `Todas las funciones ▾` y `Todas las vendedoras ▾`.
- El chip activo va en carbón; **"Deben" activo va en ámbar**, no en carbón — es un filtro de alerta.
- Los menús usan el componente `Menu` (nunca `<select>` nativo) y muestran el conteo de cada opción.
- Búsqueda insensible a mayúsculas y acentos, matchea comprador **y** vendedora.

## 3. Bloques por función

**Cada función es una caja independiente**, no una tabla larga con bandas internas:
- Caja blanca, borde 1px `--line`, radio 13, sombra suave, **separadas 20px** entre sí.
- **Acento lateral de 4px**: índigo si la función está en venta, verde si ya pasó.
- Orden: primero las funciones en venta (por fecha más próxima), después las pasadas (más reciente primero).

### 3.1 Encabezado del bloque (va ARRIBA de los nombres de columna)
`Nombre de la función` (11.5px, Archivo 800, uppercase, tracking .08em) · `Vie 14 ago, 21:00` en muted · y a la derecha los subtotales:
`N ventas` · `N entradas` · `Recaudó $X` · `Debe $Y` (el monto en ámbar; en verde `$0` si no debe nada).
Plegable con el chevron: recordar el estado por función en la sesión.

### 3.2 Fila de encabezados de columna
Va **debajo** del encabezado del bloque y **se repite en cada función** (así el scroll largo no pierde referencia). Alto 32px, fondo `--surface-alt`, tipografía Archivo 8.5px uppercase muted.

Columnas y anchos (grid):
| # | Columna | Ancho | Contenido |
|---|---------|-------|-----------|
| 1 | selección | 26px | checkbox |
| 2 | Comprador | 1.7fr | avatar iniciales (índigo, **siempre**) + nombre en 700 + email en 10px muted; "Sin email" si no tiene |
| 3 | Vendedora | 1.1fr | nombre en muted |
| 4 | Entr. | 50px | número, Archivo 800, alineado a la derecha |
| 5 | Total | 92px | monto, Archivo 800, derecha; `—` si es cortesía |
| 6 | Vendida | 86px | fecha; absoluta si es de este mes (`14 ago`), relativa si es vieja (`hace 26 d`) |
| 7 | Entrada | 110px | estado de entrega (§4.2) |
| 8 | Estado | 92px | chip, alineado a la derecha, ancho mínimo 70px, texto centrado |
| 9 | acción | 96px | reservada, vacía salvo hover (§5.1) |
| 10 | ⋮ | 30px | menú de fila |

**No existe columna "Función"**: es redundante con el encabezado del bloque.

Columnas ordenables: Comprador, Entr., Total, Vendida. Indicador de orden en índigo.

### 3.3 Filas
Alto 44px, borde inferior 1px, hover con fondo `--surface-alt`, seleccionada con fondo `--indigo-soft`. Toda la fila abre el `ActionPanel` (drawer en desktop) salvo los clicks en checkbox, botón de acción o ⋮.

## 4. Estados

### 4.1 Estado de pago (columna 8) — chips
Ancho mínimo 70px, texto centrado, alineados a la derecha para que el borde quede parejo. **Texto uniforme, sin monto ni método**:
- `Pagó` → verde (`--ok` sobre `--ok-soft`)
- `Debe` → ámbar (`--warn` sobre `--warn-soft`)
- `Cortesía` → índigo (`--indigo` sobre `--indigo-soft`)
- `Anulada` → rojo (`--danger` sobre `--danger-soft`)

El **monto** ya vive en la columna Total y el **método de pago** (efectivo/transferencia) se ve y se edita en el ⋮ y en el drawer. Repetirlos en el chip era lo que producía chips de 46 a 108px y el borde dentado.

### 4.2 Estado de entrega (columna 7) — punto + texto
Punto de 6px + etiqueta en 11px muted:
- `Enviada` (punto verde) — email enviado, sin apertura registrada
- `Abierta` (punto índigo) — el comprador abrió el email
- `No llegó` (punto ámbar) — rebote o error de envío
- `Sin email` (punto ámbar) — la venta no tiene email cargado

Requiere registrar en el backend el resultado del envío y, si el proveedor lo expone (Resend lo hace), el evento de apertura. Si no hay tracking de apertura disponible, se usan solo tres estados y `Abierta` no existe.

## 5. Acciones

### 5.1 Acción rápida (columna 9)
Columna **siempre reservada** para que el layout no salte. Vacía en reposo; al hacer hover sobre la fila aparece **una** acción contextual:
- Estado `Debe` → **Cobrar** (botón verde suave, borde `#C9E6D9`) → abre el pop-up de cobro con los dos métodos.
- Entrega `Sin email` → **Copiar link** (botón ghost).
- Entrega `No llegó` → **Reenviar** (botón ghost).
- Resto → sin acción.

Prohibido que la acción reemplace al chip de estado: el estado nunca desaparece.

### 5.2 Menú de fila (⋮)
Componente `Menu`, alineado al borde derecho:
`Marcar pagó — efectivo` · `Marcar pagó — transferencia` · separador · `Copiar link de la entrada` · `Reenviar email` (con "enviado hace N días" como texto secundario) · `Ver ingresos (k/N entraron)` · separador · `Anular venta` (rojo, con confirmación).

### 5.3 Selección múltiple
Checkbox por fila + checkbox en el encabezado de cada bloque (selecciona esa función). Con una o más filas seleccionadas aparece una **barra flotante** centrada al pie del área de contenido, en carbón:
`N ventas · $X` | `💵 Marcar como pagadas` | `✉ Reenviar entradas` | `⤓ Exportar` | `✕`
- Las acciones masivas piden confirmación en pop-up cuando afectan dinero.
- "Reenviar entradas" omite las ventas sin email y lo informa en el resultado.

## 6. Rendimiento y detalles

- Virtualizar filas a partir de ~50 por bloque (`@tanstack/react-virtual`).
- Los subtotales del encabezado de bloque se calculan en el backend, no sumando en el cliente sobre la página cargada.
- Toda la vista respeta el filtro activo: resumen, subtotales y contadores de chips.
- Los cambios hechos desde el drawer, el ⋮ o la barra de selección **invalidan las queries** y actualizan resumen, subtotales y chips sin recargar.
- Estado vacío por filtro: "No hay ventas que coincidan" + botón para limpiar filtros. Estado vacío general: "Todavía no registraste ventas" + `＋ Nueva venta`.

## 7. API

- `GET /api/sales` → params: `q`, `status` (`pending|paid|comp|void`), `function_id`, `seller_id`, `sort`, `cursor`. Devuelve las ventas agrupadas por función con: subtotales por función (ventas, entradas, recaudado, adeudado), resumen global filtrado, y por venta: comprador, email, vendedora, entradas, total, fecha de venta, estado de pago, método, estado de entrega y timestamp del último envío.
- `POST /api/sales/bulk-payment` → `{ sale_ids[], method }`
- `POST /api/sales/bulk-resend` → `{ sale_ids[] }` (responde cuántas se enviaron y cuántas se omitieron por falta de email)
- `GET /api/sales/export` → CSV de la selección o del filtro activo.

## 8. Criterios de aceptación

1. No existe columna "Función" en las filas; el nombre aparece una sola vez por bloque.
2. Los chips de Estado tienen todos el mismo ancho mínimo y quedan alineados a la derecha: el borde contra el ⋮ es una línea recta, con y sin hover.
3. Al hacer hover sobre una fila con `Debe`, aparece "Cobrar" en su propia columna **sin que el chip desaparezca ni la fila cambie de alto**.
4. Cada función es una caja separada con 20px entre bloques y acento lateral índigo (en venta) o verde (pasada).
5. Los encabezados de columna se repiten dentro de cada bloque, debajo del título de la función.
6. Seleccionar 3 filas muestra la barra flotante con el total correcto; "Marcar como pagadas" actualiza resumen, subtotales y chips sin recargar.
7. Filtrar por "Deben" pinta ese chip en ámbar y recalcula resumen y subtotales.
8. Cero hexas fuera de tokens; el avatar de iniciales es siempre índigo, nunca refleja estado.
9. En un iPhone la vista sigue siendo la lista con bottom sheet ya implementada: regresión visual cero en mobile.
