# Acapelius — La app en lenguaje afiche (C18)

> Rediseño estético de toda la app (`/app/*`) al sistema visual de la landing. **No cambia ninguna funcionalidad, ninguna ruta y ninguna arquitectura de información**: es un reemplazo de tokens y de primitivos de UI.
>
> Referencia visual canónica: `design/acapelius-app-afiche.html` (Inicio, Ventas, Puerta y las dos vistas de celular) y `design/acapelius-landing-afiche.html` para el registro original.
>
> Reemplaza a Papel pautado como sistema de la app. La landing y la app pasan a compartir un único lenguaje, con distinta intensidad.

---

## 1. Tokens

```css
:root {
  /* Superficies */
  --paper:  #F4F1EA;   /* fondo de la app */
  --paper2: #FFFFFF;   /* paneles */
  --paper3: #EBE7DD;   /* encabezados de tabla, bandas de grupo, pies */
  --hair:   #D6D1C4;   /* divisiones internas (1px) */

  /* Tinta */
  --ink:    #141414;   /* texto y bordes estructurales */
  --ink2:   #5A564C;   /* secundario */

  /* Acento y semánticos */
  --ticket: #C4401E;   /* acción primaria, acento lateral, progreso */
  --ok:     #1E6B4A;   /* pagó, al día, ingreso válido */
  --warn:   #8A5A08;   /* debe, sin asignar, sin conexión */
  --bad:    #A32D2D;   /* anulada, error, ya usada */
  --indigo: #3A3FC4;   /* cortesías (único resto del sistema anterior) */

  /* Modo nocturno de puerta */
  --night-bg:   #141414;
  --night-text: #F4F1EA;
  --night-hair: #33312B;
}
```

Todos los tokens de Papel pautado (`--bg:#F2F3F5`, `--indigo-s`, `--line:#E3E5E9`, etc.) se eliminan. **Cero hexas fuera de esta lista** en `/app`.

## 2. Tipografía

| Uso | Familia | Detalle |
|---|---|---|
| Títulos de pantalla, cifras, contadores, nombres en la puerta, títulos de panel y de bloque | **Anton** | uppercase, `letter-spacing: 0.02–0.06em` |
| Etiquetas, encabezados de columna, metadatos, botones, chips, estados, fechas relativas | **JetBrains Mono** | uppercase, `letter-spacing: 0.05–0.12em`, 9–11.5px |
| Cuerpo: celdas de tabla, nombres de personas, subtítulos, formularios, textos largos | **Inter** | 12.5–14px, sin uppercase |

**Regla dura:** Anton nunca aparece en una celda de tabla ni en un párrafo. Si aparece, está mal aplicado. Anton es para mirar; Inter es para leer.

## 3. Forma

- **`border-radius: 0` en toda la app.** Ninguna excepción: ni botones, ni paneles, ni inputs, ni avatares, ni chips. Al terminar, `grep -r "border-radius" web/src` (excluyendo `web/src/public/`) debe dar cero.
- **Sin sombras, sin gradientes, sin blur.** La jerarquía la dan el grosor de borde y el color.
- Bordes: **2px `--ink`** para contenedores y elementos interactivos; **1px `--hair`** para divisiones internas (filas de tabla, separadores). Líneas punteadas (`dashed`) solo para troqueles: divisiones internas del hero y de la franja de resumen.
- Acento lateral de bloque: **6px** sólido (`--ticket` en venta, `--ok` pasada).
- Ítem activo de la navegación: fondo `--ink`, texto `--paper`, borde izquierdo de 4px `--ticket`.

## 4. Componentes a rehacer

Todos viven en `src/ui/`; se reescribe su estilo, **no su API ni su comportamiento**.

- **Button** — `primary`: fondo `--ticket`, texto papel. `secondary`: fondo papel2, borde 2px ink. `dark`: fondo ink, texto papel. Todos en mono uppercase. Alturas: 44px normal, 36px `xs`.
- **StatusChip** — pasa de relleno suave a **contorno de 1.5px**, mono uppercase 9.5px, `min-width: 74px`, centrado: `Pagó` (ok) · `Debe` (warn) · `Cortesía` (indigo) · `Anulada` (bad, tachado). Sin fondo de color.
- **Panel** (ex Card) — borde 2px ink, fondo papel2, sin radio. Encabezado con borde inferior de 2px, título en Anton.
- **Table** — encabezado de columna con fondo `--paper3`, mono 9px uppercase; filas de 44px separadas por 1px `--hair`; hover con fondo `--paper3`.
- **Tira de resumen** — un contenedor de 2px con celdas separadas por línea **punteada**; cifras en Anton, etiquetas en mono.
- **Hero de función** — fondo `--ink`, texto papel, dividido en columnas por líneas punteadas verticales; eyebrow en `--ticket`.
- **FilterChips** — borde 1.5px; activo con fondo ink; el filtro "Deben" activo usa fondo `--warn`.
- **Input / Select / Search** — borde 2px ink, fondo papel2, foco: borde `--ticket` + `outline: 2px` del mismo color (no `box-shadow`, que es una sombra).
- **BottomSheet / Modal** — sin radio, borde 2px ink, scrim `rgba(20,20,20,.55)`.
- **Avatar de iniciales** — cuadrado, borde 1.5px ink, Anton, fondo transparente. Deja de ser índigo con fondo suave.
- **Tab bar (mobile)** — borde superior 2px; pestaña activa con fondo ink y texto papel; separadores de 1px entre pestañas.
- **Sidebar** — borde derecho de 2px; selector de temporada arriba, separado por 1px; logo en Anton.

## 5. Lo que NO cambia

1. **Rutas, navegación y arquitectura de información.** Los cinco destinos de C16 quedan igual.
2. **Semántica de color.** Verde pagó, ámbar debe, rojo anulada, índigo cortesía.
3. **Ergonomía.** Filas y targets de 44px mínimo, foco visible, contraste AA en todo texto. Si un color del sistema no llega a AA sobre papel, se oscurece el token — no se baja el estándar.
4. **Densidad.** Las tablas no crecen de alto por el cambio de estética.
5. **El lenguaje de la landing no entra**: nada de marquesinas, texto a 90px, contorno hueco ni bandas corrediza dentro de `/app`.

## 6. Modo nocturno del modo puerta — pasa a obligatorio

El papel es más luminoso que el gris anterior; en una sala a oscuras encandila. El modo nocturno deja de ser opcional:

- Se activa **por defecto** si la función empieza después de las 19:00; el usuario puede alternarlo y la preferencia se guarda por dispositivo.
- Fondo `--night-bg`, texto `--night-text`, divisiones `--night-hair`, botón primario invertido (papel con texto tinta).
- Los paneles de resultado verde y rojo se mantienen igual: son semánticos.

## 7. Orden de trabajo

1. **Tokens y primitivos** (`src/ui/`) + la pantalla interna `/dev/ui` con todo el inventario. Parar acá y mostrarlo.
2. **Ventas** — la más densa: si la tabla sobrevive, el resto también.
3. **Inicio** (ambos roles) y **Puerta** (incluido el nocturno obligatorio).
4. **Temporada**, **Plata** y el resto de pantallas.
5. Pasada final: `grep border-radius`, `grep box-shadow` y auditoría de hexas fuera de tokens.

## 8. Criterios de aceptación

1. `grep -r "border-radius\|box-shadow" web/src --exclude-dir=public` devuelve cero.
2. Ningún hexa fuera de la lista de tokens en `/app`.
3. Anton no aparece en ninguna celda de tabla ni en ningún párrafo.
4. Contraste AA verificado en: texto sobre papel, mono `--ink2` sobre papel3, chips de contorno sobre papel2, y el botón primario.
5. Las tablas mantienen filas de 44px y la misma cantidad de filas visibles que antes.
6. El modo puerta arranca en nocturno para una función de las 21:00 y la preferencia persiste.
7. Ningún flujo cambió: los tests de UI existentes pasan sin tocar sus asserts de comportamiento.
8. La landing y `/app` siguen teniendo **hojas de estilo separadas**: `web/src/public/` no importa tokens de la app ni al revés.
