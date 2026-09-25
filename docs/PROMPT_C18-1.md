# Prompt para Claude Code — C18.1: jerarquía de bordes

Ajuste sobre el rediseño afiche que ya está en producción. **Solo cambia el grosor y el color de los bordes, y los tokens del modo oscuro.** Ninguna pantalla, ningún flujo, ninguna tipografía, ningún radio.

Fuente de verdad:
1. `docs/BORDES_C18-1.md` — la escala de seis niveles por modo, los tokens, los cambios por componente y los criterios de aceptación. **Reemplaza la sección 3 (Forma) de `AFICHE_APP_SPEC.md`**; el resto de C18 sigue vigente.
2. `design/acapelius-bordes-claro.html` y `design/acapelius-bordes-oscuro.html` — cada una con el estado actual y el ajustado. **Los paneles "Después" son la referencia.**

## El problema que se corrige
C18 definió un solo grosor (2px) para todo: barra lateral, panel, fila, ícono, modal, botón. Cinco niveles de información con el mismo peso visual = cajas dentro de cajas. En oscuro es peor, porque un borde claro sobre fondo oscuro brilla en vez de imprimir.

## Las tres reglas
1. **El 2px sobrevive en un solo lugar**: la regla bajo el encabezado de página. Al terminar, `grep -rn "2px solid" web/src --exclude-dir=public` no debería devolver nada más.
2. **En oscuro, los contenedores no llevan borde**: se distinguen por superficie (`--sur` sobre `--bg`). La línea se reserva para lo interactivo y las divisiones.
3. **En claro, el borde grueso significa "esto se toca"**: 1.5px solo en botones, inputs, segmentados y filtros. Si algo no es interactivo y tiene 1.5px o más, está mal.

## Cómo trabajar
- Empezá por los tokens y los primitivos de `src/ui/`, mostrame `/dev/ui` **en los dos modos** y esperá mi OK antes de tocar pantallas.
- Ningún componente debe decidir color según el tema con condicionales: todo sale de tokens. `--ink` pasa a significar "color del texto y de los trazos fuertes del modo actual", no "negro".
- No toques tipografía, radios, densidad ni layout. Si algo de eso cambia, es un error.
- Verificá contraste AA del texto del botón primario sobre el naranja de cada modo.

## Primer encargo
Tokens de ambos modos + primitivos ajustados (Panel, Table, Button, Input, Segmented, FilterChips, Modal/Sheet, Sidebar, TabBar, íconos de fila, badges). Mostrame `/dev/ui` en claro y oscuro, y el resultado del grep de `2px solid`.
