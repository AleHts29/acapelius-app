# Prompt para Claude Code — C16: limpieza del frontend

Vamos a simplificar Acapelius: eliminar vistas y accesos duplicados y dejar la navegación en cinco destinos planos. La fuente de verdad es:

1. `docs/LIMPIEZA_SPEC.md` — el mapa de rutas, las cinco fases con sus cambios de frontend y backend, y los criterios de aceptación.
2. `design/acapelius-limpieza.html` — el análisis de duplicaciones (con archivos y líneas del repo) y las vistas nuevas: Inicio, Temporada con detalle de función, Plata, y las homes del celular. Es la referencia visual canónica.

Siguen vigentes el design system (Papel pautado), C15 (Ventas) y el modo puerta: **esas dos pantallas no se tocan**.

## Cómo trabajar
- Una fase por vez, en orden (1 → 5), cada una en su propio PR con tests y los criterios de la fase verificados. Mostrame el checklist al cerrar cada una y esperá mi OK.
- Toda ruta que se elimina queda como `<Navigate replace>` hacia su reemplazo.
- Reutilizá lo que existe: `AllocationsEditor`, el contenido de `AttendancePage` y de `UsersPage` se convierten en componentes de Temporada; no los reescribas.
- Si un endpoint queda sin consumidores, eliminalo con su test. Si dudás, dejalo y anotalo en `DECISIONS.md`.
- No agregues pantallas ni accesos fuera del spec.

## Primer encargo
Fase 1 completa: el bug de "Mi rendición" (con `my_settlement` en `GET /api/home` para la corista), la eliminación de `/panel/ventas`, de los accesos rápidos y de los botones duplicados de la home, y el renombre "Vender" → "Ventas". Mostrame cómo se ve la home de una corista con saldo y sin saldo.
