# Prompt para Claude Code — C18: la app en lenguaje afiche

Rediseño estético de toda la app al sistema visual de la landing. **No cambia funcionalidad, rutas ni arquitectura de información**: es un reemplazo de tokens y de primitivos de UI.

Fuente de verdad:
1. `docs/AFICHE_APP_SPEC.md` — tokens, reglas tipográficas, componentes a rehacer, lo que no se toca y criterios de aceptación.
2. `design/acapelius-app-afiche.html` — referencia visual canónica: Inicio, Ventas, Puerta y las dos vistas de celular, ya en el lenguaje nuevo.
3. `design/acapelius-landing-afiche.html` — el registro original, por contexto.

Este spec **reemplaza a Papel pautado** como sistema visual de la app. Todo lo demás (C15 Ventas, C16 limpieza, C17 multi-cliente) sigue vigente tal cual.

## Las tres reglas que definen el resultado
1. **`border-radius: 0` en toda la app**, sin excepciones. Al terminar, `grep -r "border-radius" web/src --exclude-dir=public` tiene que dar cero. Lo mismo con `box-shadow`.
2. **Anton es para mirar, Inter es para leer.** Anton va en cifras, contadores y títulos; nunca en una celda de tabla ni en un párrafo.
3. **Los chips de estado pasan de relleno a contorno.** Resuelve el choque entre el naranja de acción y el ámbar de deuda: el único bloque sólido naranja en la app es el botón primario.

## Cómo trabajar
- Orden: (1) tokens + primitivos en `src/ui/` con `/dev/ui` actualizado — **parás acá y me lo mostrás**; (2) Ventas; (3) Inicio y Puerta; (4) el resto; (5) auditoría final.
- Reescribís el estilo de los componentes, **no su API ni su comportamiento**: los tests de UI existentes tienen que pasar sin tocar sus asserts.
- La landing y la app mantienen hojas de estilo separadas. `web/src/public/` no importa tokens de la app ni al revés.
- Si un color no llega a contraste AA sobre papel, oscurecé el token y anotalo en `DECISIONS.md`. Nunca bajes el estándar.

## Primer encargo
Paso 1: tokens nuevos, eliminación de los de Papel pautado, y los primitivos rehechos (Button, StatusChip, Panel, Table, tira de resumen, hero de función, FilterChips, Input, Modal/Sheet, Avatar, TabBar, Sidebar). Mostrame `/dev/ui` con el inventario completo y el resultado de los greps de `border-radius` y `box-shadow`.
