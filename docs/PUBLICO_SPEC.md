# Acapelius — Multi-cliente, landing y demo (C17)

> Tres piezas, en este orden: **(A) multi-tenancy**, **(B) landing pública + alta de cuenta**, **(C) demo abierta**. El orden no es negociable: la landing invita a registrarse y la demo es una organización más; sin A, las dos son imposibles de hacer bien.
>
> Referencia visual canónica de B y C: `design/acapelius-landing-afiche.html`. Relevado sobre `fd8847a`.
>
> **La app no cambia de diseño.** Papel pautado sigue igual en todo `/app`. El lenguaje "afiche" vive solo en las superficies públicas (landing, alta, login, demo y —opcional, §D— la entrada pública).

---

# A · Multi-tenancy

Hoy la base asume un solo coro: `seasons`, `users`, `functions` y todo lo que cuelga no tienen dueño. Para que cualquiera se registre hace falta aislar por organización. **Hacerlo ahora, antes de que haya datos de terceros.**

## A.1 Modelo

```sql
CREATE TABLE organizations (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,                       -- "Coro Acapelius"
  kind       TEXT NOT NULL DEFAULT 'choir'        -- 'choir' | 'theatre' | 'other'
             CHECK (kind IN ('choir','theatre','other')),
  slug       TEXT NOT NULL UNIQUE,                -- para URLs futuras
  is_demo    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`organization_id BIGINT NOT NULL REFERENCES organizations(id)` en: **users, seasons**. El resto (`functions`, `sales`, `tickets`, `checkins`, `settlements`, `allocations`, `season_members`, `sale_payments`, `settlement_reminders`) cuelga por FK de una de esas dos, así que **no** lleva la columna: se filtra por join. Excepción: si alguna query no puede llegar a `seasons` o `users` sin un join caro, agregar la columna ahí y documentarlo en `DECISIONS.md`.

Índices: todos los índices existentes que empiecen por `season_id` o `user_id` siguen sirviendo; agregar `users (organization_id, email)` **único** — el email es único *por organización*, no global, porque la misma persona puede estar en dos grupos.

**Migración de los datos actuales:** crear la organización `Acapelius` (kind `choir`) y asignarle todos los `users` y `seasons` existentes. Es un `UPDATE` sin ambigüedad porque hoy hay un solo coro.

## A.2 Aislamiento

- La sesión guarda `organization_id` además de `user_id` y rol.
- **Toda** query lleva el filtro. La forma más segura acá: que las queries de sqlc reciban `organization_id` como parámetro y que el `Store` lo tome del contexto de la request, no de cada handler. Si un handler puede olvidarse de pasarlo, el aislamiento depende de la disciplina y se va a romper.
- Los recursos pedidos por id (`/api/sales/{id}`, `/api/seasons/{id}`, …) **verifican que pertenezcan a la organización de la sesión** y devuelven `404` —no `403`— si no: un 403 confirma que el id existe en otro lado.
- Las páginas públicas de entrada (`/e/:code`, `/t/:code`) siguen sin sesión: el código firmado ya identifica la venta, y de ahí sale la organización.

**Tests obligatorios (sin esto la fase no cierra):** crear dos organizaciones con datos parecidos y verificar, para **cada endpoint autenticado**, que la organización A no ve, modifica ni cuenta nada de B. Incluir: listados, reportes con agregados (`/api/home`, `/api/plata`, asistencia), acciones por id, y las acciones masivas (`bulk-payment`, `bulk-resend`) pasando ids de la otra organización.

## A.3 Vocabulario por tipo de organización

`kind` decide cómo la app nombra las cosas. Un diccionario en el frontend, no columnas nuevas:

| Clave | choir | theatre | other |
|---|---|---|---|
| `member` / `members` | corista / coristas | integrante / integrantes | integrante / integrantes |
| `cast` | el coro | el elenco | el equipo |
| `venue` | lugar | sala | lugar |

Los roles del modelo **no cambian** (`admin`, `seller`, `door`): cambian las etiquetas. Implementar como un hook `useTerms()` que lee el `kind` de la sesión; prohibido hardcodear "corista" en un componente nuevo.

**Aceptación A:** los tests de aislamiento pasan para todos los endpoints; el coro actual sigue funcionando exactamente igual; una organización `theatre` ve "elenco" e "integrantes" en toda la app.

---

# B · Landing pública y alta de cuenta

## B.1 Rutas

| Ruta | Qué es | Sesión |
|---|---|---|
| `/` | Landing | Pública. **Con sesión activa, redirige a `/app`** |
| `/crear-cuenta` | Alta de organización | Pública |
| `/entrar` | Login (hoy embebido en la app) | Pública |
| `/demo` | Entra a la demo (§C) | Pública |
| `/app/*` | **Toda la app actual** | Con sesión |
| `/e/:code`, `/t/:code` | Entradas públicas | Pública, sin cambios |

Mover la app a `/app` es un `basename` en el router más los redirects de las rutas viejas (`/ventas` → `/app/ventas`, etc.). **Mantener esos redirects**: hay links en emails ya enviados.

## B.2 La landing

Seguir `design/acapelius-landing-afiche.html` sección por sección: nav · hero · los tres pasos como entrada troquelada · banda corrediza · demo (§C) · para quién es · lo que resuelve (listado en numeración romana) · modo puerta en bloque negro · precios como dos talones · preguntas · cierre · pie.

**Sistema visual del afiche** (vive solo acá, en `web/src/public/`, sin tocar los tokens de la app):

```css
--paper:#F4F1EA; --ink:#141414; --ticket:#C4401E; --indigo:#3A3FC4;
```
- Titulares: **Anton**. Etiquetas y datos: **JetBrains Mono** en mayúsculas con tracking. Cuerpo: **Inter**.
- **Sin radios, sin sombras, sin gradientes.** Bordes de 2–3px sólidos; líneas punteadas solo para los troqueles.
- Secciones numeradas con el número en `--ticket` a escala de titular.
- La banda corrediza: animación de marquesina; **respetar `prefers-reduced-motion`** (se frena, no desaparece).
- Responsive: el hero baja a una columna, los tres pasos se apilan manteniendo la línea de troquel horizontal, la banda sigue corriendo.

**Rendimiento y SEO:** la landing se sirve como HTML estático desde el mismo binario Go, **sin cargar el bundle de la app**. Fuentes con `font-display: swap` y precarga solo de Anton. Meta tags y Open Graph con una imagen del afiche. `sitemap.xml` y `robots.txt`.

## B.3 Alta de cuenta

`POST /api/signup` → `{ org_name, kind, name, email, password }`. En **una** transacción: crea `organizations`, crea el `user` como `admin` de esa organización, crea la primera temporada vacía (`Temporada <año>`, activa) y abre la sesión. Devuelve al usuario a `/app`, no a una pantalla de bienvenida.

- Validaciones: email válido y no repetido **dentro de esa organización**, contraseña ≥ 10 caracteres, `org_name` no vacío. `slug` derivado del nombre con sufijo numérico si choca.
- **Rate limit** por IP (el endpoint crea organizaciones: es el blanco obvio de abuso) y `honeypot` en el formulario.
- Sin verificación de email en esta etapa; anotarlo en `DECISIONS.md` como deuda conocida.
- El formulario sigue el mockup: nombre del grupo, segmentado **Coro / Grupo de teatro / Otro**, tu nombre, email, contraseña. Panel derecho negro con los cuatro pasos numerados.

**Aceptación B:** `/` con sesión abierta lleva a `/app`; crear una cuenta deja al usuario adentro con su temporada creada y su organización aislada; Lighthouse de la landing ≥ 95 en rendimiento y accesibilidad; la landing no descarga el bundle de la app.

---

# C · Demo abierta

Que "probá sin registrarte" no sea humo.

- Una organización con `is_demo = true`, sembrada con datos verosímiles: una temporada con 4 funciones (3 hechas, 1 en venta), ~10 integrantes, ~50 ventas con los cuatro estados de pago, cortesías, asignaciones, check-ins con asistencia dispareja (la función de gala con baja asistencia, para que el insight aparezca) y rendiciones parciales. **Nombres inventados**, ninguno real.
- `POST /api/demo/session` crea una sesión temporal (6 horas) contra esa organización con rol `admin`. Escritura **habilitada**: tocar botones es el punto.
- En una organización demo, el driver de mail cambia a modo `preview`: **no se envía nada**, y donde la app diría "enviada" muestra la entrada en pantalla.
- **Job nocturno** que borra y vuelve a sembrar la organización demo. Idempotente, y con un `make demo-reset` para correrlo a mano.
- En la app, una barra fina arriba: *"Estás en la demo · los datos se reinician cada noche · Crear mi cuenta"*. En lenguaje afiche, es la única concesión visual dentro de `/app`.
- Bloquear en demo: cambiar contraseñas, eliminar la organización, y cualquier endpoint que mande mail real.

**Aceptación C:** entrar a `/demo` deja adentro de la app en menos de dos segundos, sin formulario; se puede marcar un pago y registrar una rendición; correr `make demo-reset` devuelve todo al estado inicial; ninguna acción de la demo manda un mail.

---

# D · Opcional: la entrada pública en lenguaje afiche

`/e/:code` es la única pieza que ve gente que no usa la app, y es literalmente un talón de entrada: el afiche le queda mejor que el lenguaje del producto. Cambio chico, alto retorno. **No bloquea nada**: hacerlo después de A, B y C, o nunca.

---

# Orden y reglas

1. **A** (backend puro, con los tests de aislamiento) → 2. **B** → 3. **C** → 4. **D** opcional.
2. Una pieza por PR. Al cerrar cada una, mostrar el checklist de aceptación cumplido.
3. No mezclar: A no toca UI, B y C no tocan el diseño de la app.
4. Todo lo que quede sin decidir va a `DECISIONS.md`.

## Lo que queda pendiente de definir (no lo resuelve el código)

- **El precio.** La landing lo deja en `$—` a propósito.
- **El nombre del producto.** "Acapelius" es el nombre del coro de Eli y suena a cappella; como producto multi-cliente le juega en contra con los grupos de teatro. Conviene decidirlo **antes** de tener usuarios y dominio consolidado.
- **Verificación de email** y recuperación de contraseña: hoy no existen y con alta pública se vuelven necesarias. No están en el alcance de C17.
