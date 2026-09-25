# Prompt para Claude Code — C17: multi-cliente, landing y demo

Acapelius pasa de ser la app de un coro a un producto para **coros y elencos de teatro independiente**. Tres piezas en orden estricto: multi-tenancy, landing pública con alta de cuenta, y demo abierta.

Fuente de verdad:
1. `docs/PUBLICO_SPEC.md` — modelo, rutas, reglas de aislamiento, vocabulario por tipo de organización, y criterios de aceptación de cada pieza.
2. `design/acapelius-landing-afiche.html` — referencia visual canónica de la landing y del alta. Abrila y replicá estructura, tipografía y tono.

Siguen vigentes el design system Papel pautado y todo lo ya construido.

## Regla que no se negocia
**La app no cambia de diseño.** Papel pautado sigue igual en todo `/app`. El lenguaje "afiche" (Anton, mono, bordes duros, sin radios ni sombras) vive solo en las superficies públicas y en `web/src/public/`, con sus propios tokens. No importes los tokens de la app en la landing ni al revés.

## Cómo trabajar
- Orden obligatorio: A (multi-tenancy) → B (landing + alta) → C (demo). Una pieza por PR, con sus tests y el checklist de aceptación verificado. Esperá mi OK entre piezas.
- A es backend puro: no toca UI. Los **tests de aislamiento entre organizaciones son la condición de salida**: para cada endpoint autenticado, que la organización A no vea, modifique ni cuente nada de B.
- El filtro por organización tiene que salir del contexto de la sesión en la capa de datos, no de cada handler: si un handler puede olvidarse, el aislamiento se rompe tarde o temprano.
- Nada de hardcodear "corista" en componentes nuevos: usar el diccionario por `kind` (§A.3).
- Lo que el spec no cubra, decidilo por lo más simple y anotalo en `DECISIONS.md`.

## Primer encargo
**Pieza A completa**: migración `organizations` + `organization_id` en `users` y `seasons`, migración de los datos actuales a la organización "Acapelius", filtro por organización en la capa de datos, verificación de pertenencia en los recursos por id (404, no 403), y la batería de tests de aislamiento. Al terminar, mostrame el listado de endpoints cubiertos por esos tests y confirmame que el coro actual quedó funcionando igual.
