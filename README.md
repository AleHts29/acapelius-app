# Acapelius

Entradas del coro: registro de ventas, envio de la entrada con QR por email,
check-in en la puerta escaneando (con busqueda manual como respaldo) y panel de
ventas, rendiciones y asistencia.

La especificacion funcional completa esta en [`docs/spec.md`](docs/spec.md).

**Estado: fase 1 terminada.** Fundaciones, autenticacion, y el catalogo del
admin: temporadas, funciones (lugar, fecha, cupo, precio) y alta de usuarios.
Las ventas y el modo puerta llegan en las fases siguientes (ver
[Plan de fases](#plan-de-fases)).

## Arrancar

Hace falta Docker, Go >= 1.21 y Node >= 20. El Makefile se encarga del resto:
usa `GOTOOLCHAIN=auto`, asi que cualquier Go moderno baja solo la version que
pide `go.mod`, y busca un Node nuevo en nvm o Homebrew si el del `PATH` es
viejo.

```bash
make setup   # crea .env, instala sqlc/goose en ./bin, instala el frontend
make dev     # Postgres + API + Vite, todo junto
```

`make dev` deja:

- Frontend en <http://localhost:5173> — es la URL que hay que abrir.
- API en <http://localhost:8081/api/health>.

La primera vez, `make dev` crea el admin y te imprime sus credenciales
(`eli@acapelius.local` / `acapelius` por defecto, configurables en `.env`). Al
entrar te pide cambiar la contrasena.

`make help` lista todos los comandos.

### Puertos

El server escucha en el `PORT` de `.env`, que en desarrollo es **8081** (el 8080
se pisa seguido con otros proyectos). El proxy de Vite lo lee de ahi, asi que
cambiarlo en `.env` alcanza. Postgres queda en **5433** por el mismo motivo.

## Comandos

| Comando | Que hace |
|---|---|
| `make dev` | Postgres, API y frontend juntos |
| `make dev-api` / `make dev-web` | Cada uno por separado |
| `make test` | Tests unitarios de Go (no necesitan Postgres) |
| `make test-integration` | Tests de handlers contra un Postgres real |
| `make test-web` | Tests del frontend |
| `make check` | `fmt` + `vet` + `test` + `typecheck`, antes de commitear |
| `make build` | Binario unico con el frontend adentro, en `bin/acapelius` |
| `make migrate` / `make migrate-new name=...` | Migraciones |
| `make sqlc` | Regenera las queries tipadas |
| `make db-shell` / `make db-reset` | psql / base limpia desde cero |

## Como esta armado

Un monolito en Go que sirve la API y el frontend compilado desde el mismo
binario, y Postgres. Un solo artefacto para deployar.

```
cmd/server/         binario principal: API + frontend embebido + migraciones
cmd/seed/           crea el primer admin (idempotente)
internal/
  auth/             sesiones, hashing, middleware de roles
  config/           carga y validacion de las env vars
  db/               pool de pgx, migraciones (goose) y queries generadas (sqlc)
  domain/           tipos y reglas de negocio, sin HTTP ni SQL
  http/             router chi y handlers
  httpx/            respuestas JSON y codigos de error compartidos
web/                Vite + React + TypeScript, se embebe en el binario
```

### Decisiones que conviene saber

**Migraciones con goose, embebidas.** Van en `internal/db/migrations` y viajan
adentro del binario. El server las aplica al arrancar si `AUTO_MIGRATE=true`.
Para correrlas a mano: `make migrate`.

**Queries tipadas con sqlc.** El codigo de `internal/db/sqlcgen` es generado; no
se edita a mano. Se cambian los `.sql` de `internal/db/queries` y se corre
`make sqlc`. sqlc lee el esquema de las mismas migraciones, asi que una query
que no cierra con el esquema falla al generar, no en produccion.

**Sesiones en cookie, guardadas en Postgres.** Cookie HttpOnly + SameSite=Lax,
`Secure` solo cuando `BASE_URL` es https (en desarrollo se sirve por http y una
cookie Secure no viajaria). El token se renueva al entrar y al cambiar la
contrasena, para que una sesion vieja no sobreviva.

**Un solo rol por usuario.** `admin` puede hacer todo lo que pueden `seller` y
`door` (`domain.Role.Can`). Es lo mas simple que cumple la tabla de permisos de
la spec.

**Contrasena provisoria obligatoria.** El admin da de alta a la persona y el
sistema devuelve una contrasena generada, una sola vez. Hasta que la cambie, la
API de negocio le responde `403 password_change_required`; `/api/me`,
`/auth/logout` y `/auth/change-password` siguen abiertos para que el frontend
pueda mostrar la pantalla de cambio.

**Errores de API con codigo estable.** Todas las respuestas de error tienen la
forma `{"error": {"code": "...", "message": "..."}}`. El `code` es para el
codigo; el `message` esta en espanol y se puede mostrar tal cual.

## API

Lo que existe hoy:

```
GET    /api/health                  # incluye un ping a Postgres
POST   /api/auth/login              # con rate limit por IP
POST   /api/auth/logout
POST   /api/auth/change-password
GET    /api/me
POST   /api/users                   # admin
GET    /api/users                   # admin
POST   /api/seasons                 # admin
GET    /api/seasons                 # cualquier rol
POST   /api/functions               # admin
GET    /api/functions?season_id=    # cualquier rol
PATCH  /api/functions/{id}          # admin; PATCH parcial
```

Las lecturas del catalogo estan abiertas a todos los roles porque la vendedora
elige funcion al vender y la puerta al abrir su modo; las escrituras son solo
del admin.

## Tests

```bash
make test              # unitarios: dominio y hashing
make test-integration  # handlers contra Postgres real
make test-web          # cliente de la API en el frontend
```

Los tests de `internal/http` levantan el router entero contra un Postgres de
verdad (base `acapelius_test`, que se recrea en cada corrida) y cubren el flujo
de login, el cambio obligatorio de contrasena y la autorizacion por rol. Se
saltean solos si no esta definida `TEST_DATABASE_URL`, que es lo que hace
`make test-integration`.

## Variables de entorno

Estan documentadas en [`.env.example`](.env.example). Las que no pueden faltar:

| Variable | Para que |
|---|---|
| `DATABASE_URL` | Postgres 16 |
| `SERVER_SECRET` | Firma HMAC de los QR y cifrado de sesiones. Minimo 32 bytes: `openssl rand -hex 32` |
| `BASE_URL` | URL publica; define si las cookies van con `Secure` |
| `EMAIL_DRIVER` | `log` en desarrollo, `resend` en produccion |

## Plan de fases

- [x] **0 — Fundaciones.** Repo, Postgres, migraciones, sqlc, router, auth con
      roles, seed del admin, frontend embebido.
- [x] **1 — Temporadas, funciones y usuarios.** Catalogo del admin con
      pantallas propias; PATCH parcial de funciones.
- [ ] **2 — Ventas, entradas con QR y email.**
- [ ] **3 — Check-in online.**
- [ ] **4 — Offline en la puerta.**
- [ ] **5 — Panel de Eli.**
- [ ] **6 — Pulido y deploy.**
