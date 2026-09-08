# Acapelius — Cambios v3 (paleta, home por rol, desktop, pop-ups)

> Tercera iteración. Complementa `acapelius-spec.md`, `DESIGN_SYSTEM.md` y `CAMBIOS_V2.md`. Referencias visuales canónicas en `design/`:
> - `acapelius-home-A-papel.html` → **C11, C12, C14** (4 frames: desktop Eli, desktop corista, mobile ambos roles, pop-ups)
> - `acapelius-desktop.html` → **C13** (shell de escritorio para el resto de las pantallas)
>
> Orden: **C11 → C13 → C12 → C14**. La paleta primero porque todo lo demás se construye sobre los tokens nuevos.

---

## C11 — Nueva paleta: "Papel pautado"

Reemplaza la paleta cálida actual. El crema `#F8ECDE` **deja de ser el fondo de la app** y queda reservado para la marca fuera del producto: página pública de la entrada, email de la entrada, y materiales del coro.

**Motivo:** el crema como fondo del 100% de la interfaz aplana la jerarquía (las cards blancas no se despegan) y tira a rosado; el azul `#415DA7` hacía de fondo, primario y acción a la vez. La paleta nueva es fría, las cards blancas flotan de verdad sobre el gris, y el índigo aparece **solo** donde hay una acción o un estado activo.

```css
:root {
  /* Base */
  --bg:          #F2F3F5;  /* fondo de app */
  --surface:     #FFFFFF;  /* cards, sidebar, tab bar */
  --surface-alt: #FAFBFC;  /* inputs en reposo, thead de tablas */
  --line:        #E3E5E9;  /* bordes */
  --ink:         #1A1C22;  /* texto principal */
  --text-muted:  #7C818C;  /* secundario */

  /* Marca / acción */
  --indigo:      #3A3FC4;  /* primario: CTAs, links, tab activa, foco */
  --indigo-soft: #E8E8FA;  /* fondos de chip/badge índigo, item activo de sidebar */
  --indigo-light:#8A8DEA;  /* progreso y eyebrow sobre carbón */
  --carbon:      #1A1C22;  /* hero de próxima función, botones oscuros */

  /* Semánticos */
  --ok:     #0E7A55;  --ok-soft:     #E2F2EB;
  --warn:   #9C6A0C;  --warn-soft:   #F6EEDC;
  --danger: #B3403F;  --danger-soft: #F7E6E5;
}
```

**Reglas:**
- El **hero de próxima función pasa a carbón** (`--carbon`), no índigo: el índigo saturado en un bloque grande satura; en carbón el dato respira y el índigo claro marca el progreso.
- Índigo **nunca como fondo de área grande**. Solo botones, links, chips, tab/nav activa, foco, barras de progreso.
- Modo puerta nocturno: se mantiene el patrón, ahora sobre `--carbon` con texto `--bg`.
- Focus ring: `0 0 0 3px rgba(58,63,196,.12)` + borde `--indigo`.
- Verificar AA en todo texto; `--warn` sobre `--warn-soft` y `--ok` sobre `--ok-soft` cumplen.

**Implementación:** cambiar los tokens en un solo lugar (CSS vars + `tailwind.config`). Si algún componente tiene hexas hardcodeados, es un bug de la iteración anterior: corregirlo para que consuma tokens. Actualizar también favicon/PWA theme-color y las variantes de logo usadas en la app (isologo en carbón o índigo; el crema queda para la entrada pública).

**Aceptación:** ningún hexa de la paleta vieja queda en el código de la app; la entrada pública `/e/{code}` y el email conservan el crema de marca; contraste AA verificado.

## C12 — Home por rol: de menú a tablero

**Mockup:** frames 1, 2 y 3 de `acapelius-home-A-papel.html`

**Problema:** en desktop la home replica los destinos de la sidebar — la pantalla más grande de la app se usa como índice. Y en cualquier tamaño no muestra ni un dato accionable.

**Estructura única para ambos roles** (cambian los datos, no el layout): `header de página → hero de próxima función → acciones primarias → lo accionable → contenido propio → accesos rápidos`.

### Header de página
Saludo ("Hola, Eli"), subtítulo con fecha y temporada. En desktop, acciones primarias a la derecha. En mobile, las acciones van en una fila debajo del hero.

### Hero de próxima función
Fondo `--carbon`, eyebrow en `--indigo-light`, nombre de función, fecha/venue, barra de progreso y stats a la derecha (desktop) o bajo la barra (mobile).
- **Admin:** progreso = vendidas/cupo de la función; stats = recaudado, entradas sin asignar; CTA "Ver función".
- **Corista:** progreso = **su** venta contra **su cupo** ("Vendiste 17 de tus 20"); stats = te quedan N, cobraste $X; CTA "＋ Vender".

### Acciones primarias
- **Admin:** "＋ Nueva venta" (primaria) + "Modo puerta" (ghost) — en el header en desktop, en fila bajo el hero en mobile.
- **Corista:** "＋ Nueva venta".

### Bloque accionable (izquierda en desktop)
- **Admin — "Necesita tu atención · N":** las alertas de C9 (rendición pendiente, cupo sin asignar, invitación pendiente), máximo 4 visibles + "Ver todo". Cada una **se resuelve en pop-up sin salir de la home** (ver C14) y desaparece al resolverse.
- **Corista — "Te falta cobrar · N":** sus ventas con pago pendiente (nombre, monto, cuántas entradas, hace cuánto) → acción "Marcar pago" en pop-up; más el caso "sin email cargado" → "Copiar link".
- Debajo: **"Últimas ventas"** (admin: todas; corista: las suyas) como tabla de 3 filas + "Ver todas".

### Columna derecha (desktop)
- **Admin — "La temporada":** una fila por función con barra, badge (HECHA / próxima con fecha) y vendidas/cupo.
- **Corista — "Tu cupo por función":** una fila por función con su progreso y su N/M.
- Debajo, **"Accesos rápidos"**: 2 cards (admin: Rendiciones con contador, Panel de ventas; corista: Links, Mi rendición).

En mobile todo se apila en ese mismo orden; la columna derecha va después del bloque accionable.

### Sidebar (desktop) y tab bar (mobile)
- **Sidebar admin, dos niveles:** Inicio · Vender · Puerta — sección **DIRECCIÓN** — Rendiciones · Asistencia · Temporadas · Equipo. Badges numéricos a la derecha del ítem (Vender = pagos pendientes, Rendiciones = coristas que deben). Ítem activo con fondo `--indigo-soft` y texto índigo.
- **Sidebar corista:** Inicio · Mis ventas (con badge) · Puerta.
- **Tab bar (mobile):** se reparte en **tantas columnas como tabs tenga el rol** — nunca una grilla fija de 4 con huecos. Admin: 4 (Inicio, Vender, Puerta, Dirección). Corista: 3 (Inicio, Vender, Puerta).

**Backend:** el endpoint de la home devuelve la carga según rol en una sola llamada: `GET /api/home` → próxima función con progreso (global o del usuario según rol), acciones pendientes, últimas ventas, resumen de funciones/cupos, contadores para badges. Reutiliza los agregados de C9 y las allocations de C8.

**Aceptación:** con seed, Eli ve atención + últimas ventas + temporada y resuelve una rendición desde la home sin navegar; Carolina ve su cupo real en el hero, sus 3 pagos pendientes y su cupo por función, y **no ve ningún dato global**; la tab bar de Carolina ocupa el ancho completo en 3 columnas; una corista sin cupo asignado ve el hero con "Sin cupo asignado para esta función" y el CTA de vender deshabilitado.

## C13 — Shell de escritorio para el resto de las pantallas

Aplicar `docs/DESKTOP_UI.md` (breakpoints, sidebar, tablas, drawer, master-detail, modo puerta sin scanner) al resto de las vistas: Ventas, Rendiciones, Asistencia, Equipo, Dirección, Temporadas. Ese documento ya está escrito y sigue vigente **con una corrección**: sus ejemplos usan la paleta vieja; los colores válidos son los de C11.

**Aceptación:** los 6 criterios de `DESKTOP_UI.md`, más: ninguna vista deja más de ~25% de fondo vacío a los lados en 1440px, y regresión visual cero en mobile.

## C14 — Pop-ups: modal en desktop, sheet en mobile

**Mockup:** frame 4 de `acapelius-home-A-papel.html`

Un solo componente lógico (`ActionPanel`, el de C10) con dos presentaciones por breakpoint: **modal centrado ~420px en ≥1024px**, **bottom sheet en mobile**.

**Van en pop-up** (acciones cortas que no merecen perder el contexto): registrar rendición · acciones de una venta (marcar pago efectivo/transferencia, copiar link, reenviar email, anular) · nuevo usuario · reenviar invitación · asignar cupo a una corista · editar función · confirmaciones destructivas · marcar ingreso manual desde la búsqueda de puerta.

**No van en pop-up** (pantalla propia): nueva venta completa · modo puerta · listados · detalle de corista con historial · panel de ventas · asignación masiva de cupos de una función.

**Reglas obligatorias:**
- Uno solo a la vez; **nunca un pop-up sobre otro**.
- Cierre por ✕, `Escape` y click en el scrim; en mobile además deslizando hacia abajo.
- **Foco atrapado** dentro mientras está abierto y devuelto al elemento que lo abrió al cerrar. `role="dialog"` + `aria-modal="true"` + `aria-labelledby` al título.
- No cambia la URL, salvo que la acción sea deep-linkeable.
- Contenido del modal de rendición como referencia: título con contexto ("Debe $112.000 · cobró $112.000 · rindió $0"), monto **precargado con la deuda**, chips "Todo ($X)" / "Otra cifra", segmento Transferencia/Efectivo, nota opcional, pie con preview del resultado a la izquierda ("Después de esto queda **al día**") y Cancelar + Confirmar a la derecha.
- Al confirmar: cerrar, invalidar las queries afectadas y que **la alerta desaparezca de la home sin recargar**.

**Aceptación:** resolver una rendición desde la alerta de la home actualiza atención, KPIs y el listado de rendiciones sin navegar ni recargar; el mismo flujo en un iPhone abre sheet y se cierra deslizando; navegación por teclado completa (Tab dentro, Escape cierra, foco vuelve al botón "Registrar").

## Notas transversales

- Iconos `lucide-react` (los emojis de los mockups son placeholders).
- **Cuidado con nombres de clase/token duplicados**: en el mockup hubo una colisión entre `dim` (texto gris) y `dim` (scrim del modal). Usar nombres explícitos: `scrim`, `text-muted`.
- Voseo y sentence case en los copys nuevos; los textos de los mockups son la referencia de tono.
- Los cambios de C11 no deben requerir tocar lógica: si un componente necesita edición para cambiar de paleta, es porque tenía color hardcodeado.
