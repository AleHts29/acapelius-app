# Acapelius C19 — "B": afiche × suizo

> Reemplaza la capa de presentación completa. **No se toca el backend, ni el modelo de datos, ni los flujos**: vender, mandar el QR, escanear en la puerta y rendir funcionan exactamente igual. Es una pasada sobre `web/src`.
>
> Base: commit `edcde55` (C18.1).

---

## 0. Por qué

Medí `web/src` del repo antes de escribir esto. El problema no es la estética — el afiche está bien y los tokens de C18.1 son correctos. El problema está una capa más arriba: dieciocho iteraciones dejaron sedimento, y cada pantalla nueva trajo clases nuevas en vez de reusar las que había.

| Medición | Hoy |
|---|---|
| Líneas en `styles.css` | **7.256** para 15 pantallas |
| Clases definidas | **555**, de las cuales **100 no se usan en ningún `.tsx`** |
| Familias de "fila de lista" | **10** — `srow` `prow` `seasonrow` `dirrow2` `trow2` `door-row` `alertrow` `lrow` `mrow` `fnline` |
| Familias de "tarjeta" | **6** — `acard` `fncard` `alertcard` `cat` `panel` `sblock` |
| Tamaños de tipografía | **27**, de 8,5px a 44px, con saltos de medio píxel |
| Clases con `text-transform: uppercase` | **58** |
| Reglas `letter-spacing` | **109** |
| Reglas de borde escritas a mano | **258** |
| Valores de `padding` distintos | **95** |

Dos consecuencias visibles: la misma fila de datos se dibuja distinto en cada pantalla, y las mayúsculas mono —que eran para etiquetas— se filtraron a títulos, nombres, montos, metadatos y hasta al placeholder del buscador. Cuando todo grita, nada es etiqueta.

**Objetivo medible:** `styles.css` baja de 7.256 a ~2.000 líneas, con ~45 clases en lugar de 555.

---

## 1. La idea en una línea

**El afiche es la marca. El suizo es el mueble. De Apple se toman dos comportamientos, no su piel.**

- **El afiche se concentra y desaparece.** Sobrevive en tres lugares de alto impacto y baja frecuencia: el **talón** negro (hero, puerta, cabecera de popup), los **títulos en Anton**, y la **regla negra** que encabeza cada grupo. Ahí la app es inconfundiblemente Acapelius.
- **El suizo se queda con el mueble** — el 90% que se mira ocho horas: grilla, jerarquía tipográfica, columnas alineadas, números tabulares, aire como mecanismo de separación. **Cero bordes, cero sombras.**
- **De Apple, dos comportamientos y nada más:** la fila de dos líneas (el resto va al detalle) y la hoja/popup de detalle. Son invisibles: no tienen piel. **No se toma** su radio grande, ni la sombra difusa, ni los pills rellenos, ni los avatares circulares.

### 1.1 La regla que decide card o fila

Esta regla gobierna todas las pantallas:

| | Pieza | Por qué |
|---|---|---|
| **Entidad** — una persona, una función, una temporada | **Card** (`.tile` / `.fn`) | Tienen identidad y estado propio, son pocas, y lo que se quiere es compararlas de un vistazo. Una card muestra barra de progreso, estado y dos números a la vez sin verse apretada. Se entra al detalle con un **popup**. |
| **Transacción** — una venta, un ingreso, una rendición | **Fila** (`.row`) | Son muchas, homogéneas, y lo que se hace es escanear una columna o buscar una. La fila va **debajo de su entidad**, nunca como la pantalla entera. |

---

## 2. Referencias visuales y precedencia

En `design/` van dos archivos. **Ambos son canónicos, cada uno para lo suyo:**

| Archivo | Manda para |
|---|---|
| `acapelius-B-entidades.html` | **Ventas, Asistencia, Equipo, Temporadas** y el componente **popup**. |
| `acapelius-B-referencia.html` | **Inicio, Dirección, Rendiciones (con drawer), Puerta (escritorio y celular), y todas las vistas de celular**: Inicio corista, Nueva venta, Mi plata, Ventas mobile, hoja de detalle, puerta escaneando / válido / ya usada / sin conexión. |

⚠️ **`acapelius-B-referencia.html` contiene versiones viejas de Ventas, Asistencia, Equipo y Temporadas, hechas con filas.** Están superadas. Para esas cuatro pantallas manda `acapelius-B-entidades.html`. Ignorá las de `referencia`.

**Precedencia general:**
1. Dudas funcionales (qué hace un flujo, qué campos tiene algo, qué estados existen) → `docs/acapelius-spec.md` del repo.
2. Dudas visuales → el HTML que corresponda según la tabla de arriba.
3. **Dudas de token, contraste o accesibilidad → este documento gana sobre los HTML.** Los mockups usan algunos valores que no pasan AA; la sección 3 los corrige y es la que vale.
4. Lo que no esté cubierto: la opción más simple coherente con todo lo anterior, con un comentario `// DECISION:` y una línea en `DECISIONS.md`.

---

## 3. Tokens

Reemplazan el bloque `:root` actual de `styles.css` por completo. **Ningún componente define un color, un radio, un grosor o un tamaño a mano: todos leen de acá.**

```css
:root{
  /* --- SUPERFICIES ---------------------------------------------------
     La separación la hace el contraste de superficie, no el borde.
     Por eso el papel es un punto más hondo que en C18: para que la card
     blanca se despegue sola. */
  --paper:#F2F0E9;        /* canvas de la app */
  --card:#FFFFFF;         /* tarjetas y paneles */
  --card2:#FAF8F2;        /* sub-superficie: pies de card, listas de datos */
  --hair:#E8E4DA;         /* el ÚNICO divisor */
  --sunk:rgba(26,26,24,.045); /* inputs, segmented, barras de fondo, hover */

  /* --- TINTA — nunca negro puro, salvo el talón ---------------------- */
  --ink:#1A1A18;          /* texto principal */
  --ink2:#6B665B;         /* secundario — 5,7:1 sobre card ✓ AA */
  --ink3:#7A7465;         /* metadato — 4,7:1 sobre card ✓ AA */
  --ink-mark:#97917F;     /* SOLO marcas no textuales (chevron, iconos
                             decorativos). Nunca texto: da 3,2:1. */
  --black:#141414;        /* el talón, y nada más */

  /* --- ACENTO Y SEMÁNTICOS (verificados AA sobre --card) -------------- */
  --ticket:#C4401E;       /* acción primaria y acento · 5,1:1 */
  --ok:#1E6B4A;           /* pagó, al día, ingreso válido · 6,5:1 */
  --warn:#8A5A08;         /* debe, sin asignar, sin conexión · 5,9:1 */
  --bad:#A32D2D;          /* anulada, error, ya usada · 7,0:1 */
  --indigo:#3A3FC4;       /* cortesías · 7,8:1 */
  /* fondos suaves, sólo para bandas de aviso */
  --warn-soft:#F6EEDF; --ok-soft:#E7F0EB; --bad-soft:#F6E7E6;
  /* semánticos sobre talón (negro): los de arriba no llegan a AA ahí */
  --ok-on-black:#6DC79A; --warn-on-black:#E8A33D; --ticket-on-black:#EC6E4C;

  /* --- RADIOS — 8 es la posición: empaquetado sin ser iOS ------------- */
  --r:8px;                /* cards, tiles, popup, barras de progreso */
  --rc:5px;               /* botones, inputs, segmented, cuadrado de iniciales */
  /* El talón y los paneles de veredicto de puerta van en 0. Son los
     únicos. Ese contraste ES la marca. */

  /* --- ESPACIO — base 4 ---------------------------------------------- */
  --s1:8px; --s2:12px; --s3:16px; --s4:20px; --s5:28px; --s6:40px;

  /* --- TIPOGRAFÍA — seis tamaños, no veintisiete --------------------- */
  --t-label:10px;    /* mono 500 uppercase .15em — ÚNICO uso de mayúsculas */
  --t-meta:11.5px;   /* Inter 400, --ink3 */
  --t-body:13.5px;   /* Inter 400/500 */
  --t-title:15px;    /* Inter 600, sentence case */
  --t-page:29px;     /* Anton */
  --t-figure:36px;   /* Anton */

  --fd:'Anton',Impact,sans-serif;
  --fm:'JetBrains Mono',ui-monospace,monospace;
  --fb:'Inter',system-ui,sans-serif;

  --tab-h:62px;
  color-scheme:light;
}
```

### 3.1 Modo oscuro

El modo oscuro ya existe en el repo y hay que mantenerlo. **Dos excepciones obligadas**, porque el mecanismo de "contraste de superficie" no funciona igual en oscuro:

```css
:root[data-theme='dark']{
  --paper:#1A1815; --card:#211E1A; --card2:#272420;
  --hair:rgba(244,241,234,.10);
  --sunk:rgba(244,241,234,.06);
  --ink:#F4F1EA; --ink2:#A89F8D; --ink3:#8E887A; /* 4,7:1 sobre --card ✓ */
  --ink-mark:#6E6959;
  --black:#0E0D0B;        /* el talón, más hondo que el papel */
  --ok:#4BBF8A; --warn:#E0A84A; --bad:#D96B6B; --indigo:#8E92F0;
  --warn-soft:#2E2718; --ok-soft:#17291F; --bad-soft:#2E1C1C;
  color-scheme:dark;
}
```

**Excepción 1 — la card lleva hairline en oscuro.** En claro, blanco sobre papel alcanza; en oscuro `#211E1A` sobre `#1A1815` es demasiado sutil. En oscuro, y sólo en oscuro:
```css
:root[data-theme='dark'] .card,
:root[data-theme='dark'] .tile,
:root[data-theme='dark'] .fn{ box-shadow:0 0 0 1px var(--hair); }
```

**Excepción 2 — el talón en oscuro.** `--black` pasa a `#0E0D0B`, más hondo que el papel, para que siga leyéndose como bloque aparte. Los paneles de veredicto de puerta (verde/rojo) **no cambian en oscuro**: son semánticos, no superficie.

### 3.2 Accesibilidad — no negociable

- Todo texto esencial en AA (≥4,5:1). Los valores de arriba están verificados; **si se inventa un color nuevo, hay que verificarlo**.
- `--ink-mark` (#97917F) **nunca es texto**. Los mockups lo usan en `.rs` y en `.lbl`; eso da 3,2:1 y está mal. En la implementación, `.rs` y `.lbl` usan `--ink3`.
- Estado nunca sólo por color: el punto de `.st` va **siempre acompañado de la palabra** ("Pagó", "Debe"). Lo mismo las barras de progreso, que llevan su número al lado.
- Focus ring visible en todo interactivo: `outline:2px solid var(--ticket); outline-offset:2px`.
- Touch targets ≥44px en celular; en modo puerta, botones ≥52px de alto.
- `aria-live="polite"` en el contador de puerta, en el resultado de escaneo y en el contador de Asistencia.
- Respetar `prefers-reduced-motion` (el ritmo de Asistencia no debe animarse si está activo).

---

## 4. Los componentes

Son **once**. Van todos en `web/src/ui/`, se renderizan en `/dev/ui`, y **nada fuera de esta lista se construye sin anotarlo en `DECISIONS.md`**.

### 4.1 `.lbl` — la etiqueta
El único lugar de la app con mayúsculas.
```css
.lbl{font-family:var(--fm);font-size:var(--t-label);font-weight:500;
     text-transform:uppercase;letter-spacing:.15em;color:var(--ink3)}
```
Nombra un número o una sección. **Nunca** un título, un nombre propio, un monto ni un metadato. Si no es etiqueta, va en sentence case.

### 4.2 `.card` — el panel
```css
.card{background:var(--card);border-radius:var(--r);overflow:hidden}
.card__h{display:flex;align-items:baseline;justify-content:space-between;
         gap:var(--s2);padding:var(--s2) var(--s3) var(--s1)}
.card__t{font-size:var(--t-title);font-weight:600;letter-spacing:-.01em}
.card__a{font-size:12px;font-weight:600;color:var(--ticket);text-decoration:none}
.card__f{display:flex;justify-content:space-between;align-items:center;
         padding:9px var(--s3);font-size:var(--t-meta);color:var(--ink3);
         border-top:1px solid var(--hair)}
.card__f a{color:var(--ticket);font-weight:600;text-decoration:none}
```
Sin borde, sin sombra (salvo la excepción de oscuro). **Nada anidado adentro lleva borde propio.**

### 4.3 `.grp` — el grupo, con la regla negra
Acá vive el afiche. Encabeza toda lista agrupada.
```css
.grp{margin-bottom:var(--s4)}
.grp__h{display:flex;justify-content:space-between;align-items:baseline;
        gap:var(--s2);padding-bottom:7px;border-bottom:1px solid var(--ink)}
.grp__n{font-family:var(--fm);font-size:var(--t-meta);color:var(--ink2);
        font-variant-numeric:tabular-nums}
.grp .card{border-radius:0 0 var(--r) var(--r)}
```
A la izquierda un `.lbl`, a la derecha el total en mono tabular.

### 4.4 `.row` — la fila
Dos líneas como máximo. Columnas alineadas.
```css
.row{display:grid;grid-template-columns:1fr 96px 88px 14px;align-items:center;
     gap:var(--s2);padding:9px var(--s3);text-decoration:none;color:inherit;
     position:relative}
.row+.row:before{content:"";position:absolute;top:0;left:var(--s3);
                 right:var(--s3);height:1px;background:var(--hair)}
.row:hover{background:var(--sunk)}
.row--2{grid-template-columns:1fr auto 14px}   /* sin columna de monto */
.row--3{grid-template-columns:1fr auto}        /* sin chevron (no navega) */
.row--nav{grid-template-columns:1fr 14px}      /* sólo navega */
.row--dim{opacity:.45}                          /* anulada, función pasada */

.rt{font-size:var(--t-body);font-weight:500;letter-spacing:-.005em;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt--off{text-decoration:line-through}
.rs{font-size:var(--t-meta);color:var(--ink3);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rn{font-family:var(--fm);font-size:12.5px;font-weight:500;text-align:right;
    font-variant-numeric:tabular-nums;white-space:nowrap}
.rn s{display:block;text-decoration:none;font-size:10px;color:var(--ink3);
      font-weight:400;letter-spacing:.02em}
.go{color:var(--ink-mark);font-size:13px;text-align:right}
```

**La regla de las dos líneas:** `.rt` + `.rs`, y nada más. Si el dato no cambia lo que vas a hacer *en esa pantalla*, no va en la fila — va al popup. El mail del comprador no cambia nada mientras mirás quién debe.

El divisor va **inset** (arranca y termina donde arranca el texto). Entre cards no hay divisor: las separa el aire.

### 4.5 `.st` — el estado
Punto de color + palabra. Reemplaza al chip con borde y mayúsculas de C18.
```css
.st{font-size:var(--t-meta);font-weight:500;display:flex;align-items:center;
    gap:6px;white-space:nowrap}
.st i{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.st--ok{color:var(--ok)} .st--warn{color:var(--warn)}
.st--bad{color:var(--bad)} .st--cor{color:var(--indigo)}
.st--mute{color:var(--ink3)}
```
**Es el único sistema de estado de la app.** Mismo texto y mismo color en Ventas, Rendiciones, Equipo, Temporadas, Asistencia y Puerta. Prohibido expresar estado de otra forma.

| Estado | Clase | Texto |
|---|---|---|
| Pagó | `st--ok` | `Pagó` / `Pagó (transf.)` |
| Al día | `st--ok` | `Al día` |
| Debe | `st--warn` | `Debe $ X` |
| Sin cupo / sin repartir / falta | `st--mute` | el texto que corresponda |
| Cortesía | `st--cor` | `Cortesía` |
| Anulada / ya usada | `st--bad` | `Anulada` / `Ya entró` |

### 4.6 `.fig` — la cifra
```css
.fig{font-family:var(--fd);font-size:var(--t-figure);line-height:1}
.fig--ok{color:var(--ok)} .fig--warn{color:var(--warn)}
.fig span{font-family:var(--fb);font-size:15px;font-weight:400;color:var(--ink3)}
.subfigs{display:flex;gap:var(--s6);flex-wrap:wrap}
.subfig b{font-family:var(--fm);font-size:16px;font-weight:500;display:block;
          font-variant-numeric:tabular-nums}
.subfig .lbl{display:block;margin-top:2px}
```
**Una cifra grande por pantalla**, la que contesta la pregunta de esa pantalla. Las demás van en `.subfigs`, sin caja. Nunca cuatro KPI del mismo tamaño en cuatro cajas: si todos pesan igual, hay que leerlos todos.

### 4.7 Controles
```css
.btn{font-size:12.5px;font-weight:600;padding:8px 15px;border:0;
     border-radius:var(--rc);background:var(--sunk);color:var(--ink);
     text-decoration:none;display:inline-block;cursor:pointer}
.btn--go{background:var(--ticket);color:#fff}
.btn--w{display:block;text-align:center;padding:12px}  /* ancho completo, celular */
.search{flex:1;background:var(--sunk);border-radius:var(--rc);padding:8px 11px;
        font-size:12.5px;color:var(--ink3);min-width:180px}
.seg{display:flex;gap:1px;background:var(--sunk);border-radius:var(--rc);padding:2px}
.seg b{font-size:var(--t-meta);font-weight:500;color:var(--ink2);
       padding:5px 11px;border-radius:4px;white-space:nowrap;cursor:pointer}
.seg b.on{background:var(--card);color:var(--ink);font-weight:600}
```
**Un solo `.btn--go` por pantalla**, que es la acción de esa pantalla. El segmented control reemplaza a los chips de filtro sueltos.

### 4.8 `.heel` — el talón
El único radio 0 fuera de la puerta. Hero de Inicio, bloque de función en Puerta, cabecera del popup.
```css
.heel{background:var(--black);color:#F4F1EA;padding:var(--s4);border-radius:0}
.heel .lbl{color:rgba(244,241,234,.5)}
.heel__t{font-family:var(--fd);font-size:24px;line-height:1.05;margin:7px 0 2px}
.heel__m{font-size:12px;color:rgba(244,241,234,.6)}
.heel__bar{height:4px;background:rgba(244,241,234,.18);margin-top:var(--s3)}
.heel__bar i{display:block;height:100%;background:var(--ticket)}
.heel__l{display:flex;justify-content:space-between;font-size:var(--t-meta);
         color:rgba(244,241,234,.65);margin-top:7px;font-family:var(--fm)}
```
Dentro del talón, los semánticos usan sus variantes `--*-on-black`.

### 4.9 `.tile` / `.fn` — la tarjeta de entidad **(nuevo)**
Misma estructura, dos caras.
```css
.tiles{display:grid;gap:var(--s2)}
.tiles--3{grid-template-columns:repeat(3,1fr)}
.tiles--5{grid-template-columns:repeat(5,1fr)}

.tile,.fn{background:var(--card);border-radius:var(--r);padding:var(--s3);
          text-decoration:none;color:inherit;display:block;position:relative}
.tile:hover,.fn:hover{background:var(--card2)}

/* iniciales en CUADRADO, no círculo: el círculo es el gesto social de Apple
   y en una herramienta de trabajo no aporta dato. */
.mono-sq{width:34px;height:34px;border-radius:var(--rc);background:var(--sunk);
         color:var(--ink2);display:grid;place-items:center;
         font-family:var(--fm);font-size:11.5px;font-weight:700;flex:none}

.tile__top{display:flex;align-items:flex-start;gap:10px;margin-bottom:var(--s2)}
.tile__n{font-size:14px;font-weight:600;letter-spacing:-.01em;
         white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile__r{font-size:var(--t-meta);color:var(--ink3);
         white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* cuatro píxeles que cuentan la historia de la entidad */
.tile__bar{height:4px;background:var(--sunk);margin:var(--s2) 0 7px;overflow:hidden}
.tile__bar i{display:block;height:100%;background:var(--ink)}
.tile__bar i.ok{background:var(--ok)}
.tile__bar i.tk{background:var(--ticket)}
.tile__meta{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.tile__q{font-family:var(--fm);font-size:12.5px;font-weight:500;
         font-variant-numeric:tabular-nums}
.tile__q em{font-style:normal;color:var(--ink3);font-weight:400}
.tile__f{display:flex;justify-content:space-between;align-items:center;gap:8px;
         margin-top:var(--s2);padding-top:var(--s2);border-top:1px solid var(--hair)}
/* punto naranja: "esta pide atención" */
.tile--flag:after{content:"";position:absolute;top:var(--s3);right:var(--s3);
                  width:6px;height:6px;border-radius:50%;background:var(--warn)}
.tile--off{opacity:.5}   /* función que ya pasó */

/* cara "función": la fecha manda, en Anton */
.fn__d{font-family:var(--fd);font-size:25px;line-height:1;margin:5px 0 1px}
.fn__v{font-size:var(--t-meta);color:var(--ink3)}
/* función seleccionada (Ventas): el talón marcando dónde estás */
.fn--on{background:var(--black);color:#F4F1EA}
.fn--on .lbl,.fn--on .fn__v,.fn--on .tile__q em{color:rgba(244,241,234,.55)}
.fn--on .tile__bar{background:rgba(244,241,234,.2)}
.fn--on .tile__bar i{background:var(--ticket)}
.fn--on .tile__f{border-top-color:rgba(244,241,234,.18)}
```
`.tile--flag` se pone cuando la entidad requiere una acción: corista que debe plata o no tiene cupo, función con entradas sin repartir.

**Detalle de copy:** una función agotada muestra `AGOTADA` en `.fn__d` en lugar de `80 / 80`. Un número que no pide nada no merece el mismo espacio que uno que sí.

### 4.10 `.modal` — el popup **(nuevo)**
**Uno solo para toda la app**: corista, función, venta e ingreso. Cabecera negra (el talón), cuerpo y pie de acciones.
```css
.modal-wrap{position:fixed;inset:0;display:grid;place-items:center;
            z-index:50;padding:var(--s4)}
.modal-scrim{position:absolute;inset:0;background:rgba(26,26,24,.3)}
.modal{position:relative;width:520px;max-width:100%;background:var(--card);
       border-radius:var(--r);box-shadow:0 20px 60px rgba(20,20,20,.22);
       overflow:hidden;max-height:100%;display:flex;flex-direction:column}
.modal__h{background:var(--black);color:#F4F1EA;padding:var(--s4);position:relative}
.modal__h .lbl{color:rgba(244,241,234,.5)}
.modal__t{font-family:var(--fd);font-size:26px;line-height:1.05;margin:6px 0 2px}
.modal__s{font-size:12px;color:rgba(244,241,234,.6)}
.modal__x{position:absolute;top:var(--s3);right:var(--s3);
          color:rgba(244,241,234,.65);font-size:15px;cursor:pointer}
.modal__b{padding:var(--s4);display:flex;flex-direction:column;
          gap:var(--s4);overflow:auto}
.modal__f{display:flex;gap:8px;padding:var(--s3) var(--s4);
          border-top:1px solid var(--hair);background:var(--card2)}
.modal__f .btn{flex:1;text-align:center}
.mini{background:var(--card2);border-radius:var(--r);overflow:hidden}
```
Comportamiento: `role="dialog"` + `aria-modal="true"`, foco atrapado adentro, **Esc cierra**, clic en el scrim cierra, el foco vuelve al elemento que lo abrió. **En celular el mismo contenido se presenta como hoja** (`.sheet`, abajo), no como modal centrado.

**Cuándo modal y cuándo lateral:** popup para la **ficha de una entidad** (corista, función). Panel lateral / hoja para cuando se está **trabajando una lista de corrido** (Rendiciones, detalle de una venta): ahí importa no perder la lista de atrás.

### 4.11 `.dl` — la lista de datos
Vive dentro del popup, de la hoja y del drawer.
```css
.dl{background:var(--card2);border-radius:var(--r);overflow:hidden}
.dl__r{display:flex;justify-content:space-between;gap:var(--s3);
       padding:9px var(--s3);font-size:12.5px;position:relative}
.dl__r+.dl__r:before{content:"";position:absolute;top:0;left:var(--s3);
                     right:var(--s3);height:1px;background:var(--hair)}
.dl__k{color:var(--ink3)}
.dl__v{font-weight:500;text-align:right;font-variant-numeric:tabular-nums}
```

### 4.12 `.rhythm` — el ritmo de entrada **(nuevo)**
Sólo en Asistencia y en el resumen de puerta.
```css
.rhythm{display:flex;align-items:flex-end;gap:3px;height:76px;margin:var(--s2) 0 6px}
.rhythm b{flex:1;background:var(--ok-on-black);border-radius:1px;min-height:2px;opacity:.85}
.rhythm b.now{background:var(--ticket-on-black);opacity:1}
.rhythm b.soft{background:rgba(244,241,234,.12)}  /* tramo futuro */
.rhythm-x{display:flex;justify-content:space-between;font-family:var(--fm);
          font-size:9.5px;color:rgba(244,241,234,.6);letter-spacing:.06em}
```
Va **dentro del talón**, por eso usa las variantes `--*-on-black`.

### 4.13 La hoja de celular y el drawer de escritorio
```css
/* celular */
.sheet{position:fixed;left:0;right:0;bottom:0;background:var(--card);
       border-radius:16px 16px 0 0;padding:10px 0 var(--s4);z-index:50;
       box-shadow:0 -10px 40px rgba(20,20,20,.16)}
.grab{width:36px;height:4px;border-radius:999px;background:var(--hair);
      margin:0 auto var(--s3)}
/* escritorio */
.drawer{position:fixed;top:0;right:0;bottom:0;width:360px;background:var(--card);
        padding:var(--s4);box-shadow:-20px 0 50px rgba(20,20,20,.1);
        display:flex;flex-direction:column;gap:var(--s3);z-index:50}
```
Mismas reglas de accesibilidad que el modal (Esc, foco, scrim).

### 4.14 Veredicto de puerta
Semántico, pantalla completa, **radio 0**. Se lee a un metro con el teatro lleno.
```css
.verdict{flex:1;display:flex;flex-direction:column;align-items:center;
         justify-content:center;gap:6px;text-align:center;padding:var(--s4);
         color:#F4F1EA}
.verdict--ok{background:var(--ok)} .verdict--bad{background:var(--bad)}
.verdict__n{font-family:var(--fd);font-size:26px;line-height:1.1;margin-top:6px}
.verdict__s{font-family:var(--fm);font-size:10px;text-transform:uppercase;
            letter-spacing:.14em;opacity:.7;margin-top:var(--s3)}
```
Estos colores **no cambian en modo oscuro**.

---

## 5. Pantalla por pantalla

### 5.1 Inicio — `pages/HomePage.tsx`
Referencia: `acapelius-B-referencia.html` §01.

- Grilla asimétrica 1.75 / 1.
- Izquierda: el `.heel` con la próxima función (para la corista, su cupo; para dirección, la venta de la función) + **una cifra grande**: "Falta cobrar" para dirección, "Tenés que rendir" para la corista. Debajo, `.subfigs` con tres números de contexto.
- Derecha: card "Te están esperando" (`.row--nav`, lo accionable) + card "Últimas ventas".
- Se elimina cualquier KPI en caja.

### 5.2 Ventas — `pages/SalesPage.tsx`
Referencia: **`acapelius-B-entidades.html` §01**.

Este es el cambio más grande de C19.

1. **Tira de funciones arriba** (`.tiles--5` de `.fn`). La función elegida lleva `.fn--on` (negra). Es un selector, no un encabezado.
2. Debajo, grilla asimétrica:
   - Izquierda: `.search` + `.seg` (Todas / Debe / Pagó / Cortesías / Anuladas) y el `.grp` con las ventas **de la función elegida**, 5 filas + `.card__f` con "Ver todas". No se muestran todas las funciones de corrido.
   - Derecha: `.grp` **"Quién vendió"** — ranking de coristas de esa función, con `.tile__bar` dentro de la fila y el número en mono. En el pie, "Sin repartir · N entradas" linkeando a repartir cupos.
3. Tocar una fila abre la **hoja/drawer** de la venta (no el popup): mail, corista, total, pago, ingreso, y acciones "Reenviar QR" / "Ver entrada".
4. `.btn--go` "Nueva venta" en el encabezado de página, **una sola vez en toda la pantalla**.

### 5.3 Asistencia — `pages/AttendancePage.tsx`
Referencia: **`acapelius-B-entidades.html` §02**.

Es una pantalla en vivo y tiene que notarse.

1. Grilla asimétrica. Izquierda: un `.heel` grande que contiene todo el estado en vivo:
   - contador `62 de 80` en Anton con `--ok-on-black`, y a la derecha "Entrando ahora · N / min".
   - **`.rhythm`**: una barra por tramo de 10 minutos. El tramo actual lleva `.now` (naranja); los futuros, `.soft`. Eje debajo con hora de inicio, mitad, AHORA y fin.
   - pie con tres datos: Pico (hora y cantidad), Faltan (N personas), Cortesías (usadas de total).
2. Derecha: card "Buscar en la puerta" con `.search` + el `.grp` **"Todavía no llegaron"**, cada fila con botón "Marcar" (ingreso manual). Es lo único accionable de la pantalla.
3. Abajo, ancho completo: `.grp` "Entrando", con el **feed** — una fila especial donde la **hora va primero, en mono y en `--ok`**, seguida del nombre, el detalle, y a la derecha quién escaneó.
```css
.feed{display:grid;grid-template-columns:52px 1fr auto;gap:var(--s2);
      align-items:baseline;padding:8px var(--s3);position:relative}
.feed+.feed:before{content:"";position:absolute;top:0;left:var(--s3);
                   right:var(--s3);height:1px;background:var(--hair)}
.feed__t{font-family:var(--fm);font-size:12.5px;font-weight:700;
         font-variant-numeric:tabular-nums;color:var(--ok)}
```
4. Autorefresh con el indicador `.st--ok` "En vivo" en el encabezado.

### 5.4 Equipo — `pages/UsersPage.tsx`
Referencia: **`acapelius-B-entidades.html` §03**. Es el archivo más grande del front (1.061 líneas); debería quedar bastante más chico.

1. `.subfigs` arriba: cupos repartidos, sin asignar, sin rendir.
2. `.grp__h` "Coristas" + **`.tiles--3` de `.tile`**. Cada tarjeta: `.mono-sq` con iniciales, nombre, mail, `.tile__bar` del cupo vendido, `.tile__meta` con "6 de 12 vendidas" y el porcentaje, y `.tile__f` con el `.st` de plata y cuándo fue la última rendición. `.tile--flag` si debe plata o no tiene cupo.
3. `.grp__h` "Dirección y puerta" + `.tiles--3` de tarjetas compactas (sólo `.tile__top`).
4. `.grp__h` "Temporadas anteriores".
5. Clic en una tarjeta → **popup de corista**: dos cifras (Debe / Vendió), `.mini` con el cupo función por función, `.dl` con cobró / ya rindió / última rendición / cortesías usadas. Pie: "Cambiar cupo" · "Recordarle" · "Registrar rendición".
6. **"Sumar persona" abre el formulario; no está siempre desplegado.**
7. `AllocationsEditor` se usa desde "Cambiar cupo" (dentro del popup) y desde "Repartir cupos" (encabezado).

### 5.5 Temporadas — `pages/SeasonPage.tsx` y `pages/SeasonsPage.tsx`
Referencia: **`acapelius-B-entidades.html` §04**.

1. Encabezado: `.lbl` "Temporadas · 2026" arriba del `.pgt` con el nombre. Botón "Cambiar temporada" usa el `Menu` existente — **nunca un `<select>` nativo**.
2. `.subfigs`: funciones, vendidas, precio, potencial.
3. `.grp__h` "Vienen" + `.tiles--3` de `.fn`: `.lbl` con el día y cuánto falta, `.fn__d` con la fecha en Anton (`12 DIC`), `.fn__v` con hora y lugar, `.tile__bar`, `.tile__meta` con vendidas y recaudado, `.tile__f` con el `.st`.
4. `.grp__h` "Ya pasaron" + `.tiles--3` con `.tile--off`, y el `.st` mostrando cuántos entraron.
5. Clic → **popup de función**: dos cifras (Vendidas / Recaudado), `.mini` con **cupos por corista** (nombre, `.tile__bar`, "18 / 20") y una fila final con fondo `--warn-soft` para "Sin repartir · N". `.dl` con capacidad, precio, cortesías, anuladas. Pie: "Editar" · "Ver ventas" · "Repartir las N".
6. **Se conserva la vista índice de temporadas y la creación de temporadas.** No eliminar.

### 5.6 Dirección — `pages/DireccionPage.tsx`
Referencia: `acapelius-B-referencia.html` §01 (mismo patrón que Inicio).

- Una cifra grande ("Falta cobrar") + `.subfigs`.
- Card "Quién todavía debe" (3 filas + "Ver las 6").
- Card "Próxima función" y card "Pendientes".
- **Se elimina la tarjeta "Administración"**: esos cuatro links ya están en la lateral y en la pestaña del celular. Es navegación dibujada dos veces. → ver §7.
- Evaluar si `DireccionPage` sigue justificándose como pantalla separada de Inicio para el rol admin. Si queda, no puede repetir lo que muestra Inicio.

### 5.7 Rendiciones — `pages/SettlementsPage.tsx`
Referencia: `acapelius-B-referencia.html` §03. **Se mantiene con filas**: son plata y movimientos, no entidades.

- Cifra grande "Sin rendir" + `.subfigs`.
- Dos `.grp`: "Con deuda" y "Al día". La columna de monto usa `.rn` con `<s>` para la unidad ("debe", "rindió").
- Clic → **drawer lateral** (no popup): nombre, cifra de deuda, `.dl`, y "De dónde sale la deuda" con las ventas que la componen. Pie: "Recordarle" · "Registrar rendición".

### 5.8 Puerta — `pages/DoorPage.tsx` y `pages/DoorModePage.tsx`
Referencia: `acapelius-B-referencia.html` §05 y §07.

- **Escritorio: sin cámara.** Grilla asimétrica: izquierda el `.heel` con la función de hoy y el contador + `.search` por nombre con resultados en `.grp` (botón "Marcar ingreso" por fila). Derecha: "Otras funciones" y "Quién está en la puerta".
- **Celular:** `.heel` compacto con contador, visor de cámara, y dos botones ≥52px ("Siguiente escaneo" / "Buscar por nombre").
- **Veredictos** a pantalla completa, radio 0: válido (verde, ✓, nombre en Anton, "N entradas · le vendió X", sello con hora) y ya usada (rojo, ✕, "Ya entró", nombre, hora y quién escaneó, con opción "Dejarla pasar igual").
- **Sin conexión:** `.st--warn` en el encabezado y una card con fondo `--warn-soft` que dice "Seguí escaneando — la lista está guardada en el teléfono, se sincroniza sola", con el contador de la cola. **El flujo offline (snapshot en IndexedDB + cola idempotente) no se toca**, sólo su presentación.

### 5.9 Celular — corista
Referencia: `acapelius-B-referencia.html` §06.

- **Inicio:** talón con la próxima función y su cupo, cifra "Tenés que rendir", dos subcifras, card "Tus últimas ventas", `.btn--go btn--w` "Nueva venta".
- **Nueva venta:** función (fila con "Cambiar"), comprador (nombre y mail), cantidad con stepper y total en vivo, "Marcar como cortesía", y el CTA abajo.
- **Mi plata** (nueva pestaña, ver §7): cifra "Le tenés que dar a Eli", dos subcifras, `.grp` "De dónde sale" con las ventas que componen la deuda, `.grp` "Ya rendiste" con el historial.
- **Ventas:** título, search, seg, `.grp` por función. Tocar una fila abre la `.sheet`.

---

## 6. Navegación

`components/nav.ts` se mantiene como la única fuente de navegación, con **un cambio**: se agrega "Mi plata" para el rol `seller`.

Primer nivel (pestañas del celular y lateral de escritorio):
- `admin`: Inicio · Ventas · Puerta · Dirección
- `seller`: Inicio · Ventas · Puerta · **Mi plata**
- `door`: sólo Puerta

Segundo nivel (sólo lateral, bajo "Administración", rol `admin`): Rendiciones · Asistencia · Temporadas · Equipo.

La lateral activa va con `.nav-i.on` (fondo `--card`, sin borde), y el contador al costado en mono naranja.

---

## 7. Dos arreglos que salen en el camino

**7.1 — Bug real en producción.** El link "Mi rendición" de la corista apunta a `/panel/rendiciones`, que está envuelto en `RequireAdmin`. La corista rebota a Inicio y **nunca puede ver lo que debe**. Se arregla con la pestaña **"Mi plata"** (`/mi-plata`), con su propia ruta fuera de `RequireAdmin`, que muestra sólo lo suyo. Agregar un test que cubra que un usuario con rol `seller` llega a su propia rendición.

**7.2 — Navegación duplicada.** Se elimina la tarjeta "Administración" de Dirección.

---

## 8. El borrado

Es la mitad del trabajo y la que más se va a notar. **En este orden:**

1. **Clases muertas.** 100 clases definidas en `styles.css` que no aparecen en ningún `.tsx`. Borrado puro, riesgo cero. Para encontrarlas:
   ```bash
   cd web/src
   for c in $(grep -oE '^\s*\.[a-zA-Z][a-zA-Z0-9_-]*' styles.css | tr -d ' .' | sort -u); do
     n=$(grep -ro "\b$c\b" --include=*.tsx . | wc -l)
     [ "$n" -eq 0 ] && echo "$c"
   done
   ```
2. **Las 10 familias de fila → `.row`.** `srow` `prow` `seasonrow` `dirrow2` `trow2` `door-row` `alertrow` `lrow` `mrow` `fnline`. (`dirrow2` y `lrow` ya tienen 0 usos: se van en el paso 1.)
3. **Las 6 familias de tarjeta → `.card` / `.tile`.** `acard` `fncard` `alertcard` `cat` `panel` `sblock`.
4. **Las 3 familias de tabla → `.row`.** `mtbl` `sthead` `tstrip`.
5. **27 tamaños de tipografía → 6.** Cada `font-size` suelto se reemplaza por su token.
6. **58 clases con mayúsculas → 1** (`.lbl`). Títulos, nombres, montos, metadatos, hints y placeholders pasan a sentence case.
7. **258 bordes a mano → ninguno.** La card no lleva borde; el único divisor es `--hair` y va inset. En oscuro, la excepción de §3.1.
8. **95 paddings → la grilla de 6 pasos.**

**Regla de oro del borrado:** una familia vieja se elimina **cuando su último consumidor migró**, no antes. Después de cada pantalla, correr el script del paso 1 otra vez y barrer lo que quedó huérfano.

---

## 9. Plan de ejecución

Fase por fase. **No empezar una sin que la anterior compile, pase tests y se vea al nivel del mockup.**

| Fase | Qué | Criterio de aceptación |
|---|---|---|
| **0** | Tokens nuevos en `:root` (claro + oscuro). Barrido de las 100 clases muertas. | La app compila y sigue andando aunque se vea mezclada. El script del §8.1 devuelve 0. |
| **1** | Los 11 componentes en `web/src/ui/`, renderizados en `/dev/ui`: `Label` `Card` `Group` `Row` `Status` `Figure` `Button/Search/Seg` `Heel` `Tile/FnTile` `Modal` `DataList` `Rhythm` `Sheet/Drawer`. | `/dev/ui` muestra los 11 en claro y oscuro. Contrastes verificados contra §3. Modal con Esc, foco atrapado y retorno de foco. |
| **2** | **Equipo** completo con `.tile` + popup. | Coincide con `entidades.html` §03. `UsersPage.tsx` baja considerablemente de 1.061 líneas. Las familias que dejó de usar, borradas. |
| **3** | **Temporadas** (índice + detalle) con `.fn` + popup. | Coincide con §04. La creación de temporadas y de funciones sigue funcionando. |
| **4** | **Ventas** con tira de funciones, lista filtrada, "Quién vendió" y hoja de detalle. | Coincide con §01. Una sola función visible por vez. Un solo "Nueva venta" en la pantalla. |
| **5** | **Asistencia** con talón + `.rhythm` + feed + lista de faltantes. | Coincide con §02. El ritmo se calcula de los check-ins reales. |
| **6** | **Inicio**, **Dirección** y **Rendiciones**. Se elimina la tarjeta "Administración". | Una cifra grande por pantalla. Rendiciones con drawer. |
| **7** | **Puerta** (escritorio y celular) y **celular completo**, incluida la pestaña **Mi plata** y el arreglo de §7.1. | Veredictos legibles a un metro. Flujo offline intacto. Test: un `seller` llega a su rendición. |
| **8** | Barrido final. | `styles.css` ≈ 2.000 líneas. Ninguna clase de las familias viejas. Script del §8.1 en 0. Tests en verde. |

---

## 10. Datos que la UI nueva necesita

Varios bloques necesitan datos que hoy no se muestran. **Antes de agregar un endpoint, fijarse si se puede derivar en el cliente de lo que ya se trae.** Si un dato no existe y no se puede derivar, **se omite el bloque — no se inventa el número ni se deja un placeholder.**

| Dónde | Dato | Cómo conseguirlo |
|---|---|---|
| Asistencia · `.rhythm` | ingresos agrupados por tramo de 10 min | derivable en el cliente de los check-ins con su timestamp, que ya se traen |
| Asistencia · "Entrando ahora" | ritmo por minuto | derivable de los últimos check-ins |
| Asistencia · "Pico" | tramo con más ingresos | derivable |
| Asistencia · feed | quién escaneó cada ingreso | el check-in debería tener `scanned_by`; si no está, omitir esa columna |
| Ventas · "Quién vendió" | ventas por corista para una función | derivable agrupando las ventas de la función; si el listado viene paginado, hace falta un agregado del backend |
| Equipo · `.tile` | vendidas / asignadas por corista en la temporada | `allocations` + ventas; ya existe |
| Equipo · popup | cupo función por función | `allocations` por función; ya existe |
| Equipo · popup | cortesías usadas / tope | si no hay tope modelado, mostrar sólo las usadas |
| Temporadas · popup | cupos por corista + "sin repartir" | `allocations` de la función vs capacidad; ya existe |
| Temporadas · `.subfigs` | "si se vende todo" | capacidad total × precio, derivable |

---

## 11. Qué NO hacer

- No inventar colores, sombras, gradientes, radios ni tipografías fuera de §3.
- **No agregar bordes.** Si un bloque "se pierde", es un problema de espacio o de jerarquía, no de borde.
- **No usar mayúsculas fuera de `.lbl`.**
- No usar el círculo de iniciales: el cuadrado `.mono-sq` es deliberado.
- No agregar un segundo `.btn--go` en la misma pantalla.
- No tocar backend, modelo de datos ni flujos. No cambiar el QR, el HMAC ni el flujo offline de la puerta.
- No usar `localStorage` / `sessionStorage` para datos de negocio (sólo preferencia de tema); el estado offline de puerta sigue en IndexedDB.
- No dejar pantallas "de relleno": cada pantalla entregada se ve al nivel del mockup.
- No eliminar la vista índice de temporadas ni la creación de temporadas.
- **Cuidado con nombres de clase y token duplicados.** Ya pasó una vez en este proyecto: `.dim` existía como texto apagado y como scrim de modal, y cada metadato se renderizaba como un overlay negro a pantalla completa. Antes de crear una clase, verificar que el nombre esté libre.

---

## 12. Tests

- Los que ya exige `docs/acapelius-spec.md` §10 siguen valiendo.
- **Nuevo:** un usuario con rol `seller` puede llegar a su propia rendición (§7.1).
- **Nuevo:** el agrupado del ritmo de Asistencia (dado un set de check-ins, devuelve los tramos correctos).
- Los tests existentes de `nav.ts` se actualizan para la pestaña "Mi plata".
- Lógica offline de puerta y cálculo de totales/saldos: intactos, sus tests tienen que seguir pasando sin cambios.

---

## 13. Copy

Español rioplatense con voseo, sentence case, sin tecnicismos. Los textos de los mockups son la referencia de tono: *"Te están esperando"*, *"Quién todavía debe"*, *"Le tenés que dar a Eli"*, *"De dónde sale"*, *"Seguí escaneando"*, *"Todavía no llegaron"*.

Dato a respetar: en Equipo la columna dice `6 / 12` con la unidad `vendidas` debajo — cupo y venta en un solo dato.
