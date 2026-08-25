# Acapelius

Entradas del coro: registro de ventas, envio de la entrada con QR por email,
check-in en la puerta escaneando (con busqueda manual como respaldo) y panel de
ventas, rendiciones y asistencia.

La especificacion funcional completa esta en [`docs/spec.md`](docs/spec.md).

**Estado: MVP completo (fases 0 a 6).** Ciclo entero funcionando: catalogo,
ventas con QR firmado y email, pagina publica, modo puerta offline-first,
panel de ventas/rendiciones/asistencia, y todo lo necesario para produccion:
Dockerfile, `fly.toml`, headers de seguridad, rate limiting, PWA instalable y
backups con restore probado. El deploy paso a paso esta en
[`docs/operations.md`](docs/operations.md).

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
| `make seed-demo` | Temporada de demo: ventas, ingresos y rendiciones para recorrer el panel |
| `make dev-api` / `make dev-web` | Cada uno por separado |
| `make test` | Tests unitarios de Go (no necesitan Postgres) |
| `make test-integration` | Tests de handlers contra un Postgres real |
| `make test-web` | Tests del frontend |
| `make check` | `fmt` + `vet` + `test` + `typecheck`, antes de commitear |
| `make build` | Binario unico con el frontend adentro, en `bin/acapelius` |
| `make migrate` / `make migrate-new name=...` | Migraciones |
| `make sqlc` | Regenera las queries tipadas |
| `make db-shell` / `make db-reset` | psql / base limpia desde cero |
| `make db-backup` / `make db-restore-check` | Dump local / probar el restore en una base descartable |

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

POST   /api/sales                   # seller/admin; is_comp solo admin
GET    /api/sales?mine=1            # seller ve lo suyo; admin todo
PATCH  /api/sales/{id}              # pago: status + metodo
POST   /api/sales/{id}/resend-email
POST   /api/sales/{id}/void         # admin; rechaza si hay check-in
POST   /api/tickets/{id}/void       # admin; anula una entrada suelta

GET    /api/public/sales/{code}     # sin auth: datos de la pagina publica
GET    /api/public/tickets/{code}.png  # sin auth: QR como imagen (email)

GET    /api/functions/{id}/door-snapshot  # door/seller: tickets + checkins
POST   /api/checkins                # door/seller: scan o manual
POST   /api/checkins/sync           # batch idempotente de la cola offline

GET    /api/reports/sales?function_id=&seller_id=   # admin
GET    /api/reports/settlements?season_id=  # admin todas; seller su fila
GET    /api/reports/attendance?function_id= # admin; la UI hace polling
POST   /api/settlements             # admin: registrar una rendicion
```

Las lecturas del catalogo estan abiertas a todos los roles porque la vendedora
elige funcion al vender y la puerta al abrir su modo; las escrituras son solo
del admin.

**Ventas.** El alta corre en una transaccion que lockea la fila de la funcion
(`SELECT ... FOR UPDATE`): dos ventas concurrentes no pueden pasar el chequeo
de cupo a la vez. El monto queda congelado al precio vigente
(`amount_cents`); cambiar el precio de la funcion no toca ventas ya hechas.
Anular libera cupo. El cupo de una funcion no puede editarse por debajo de lo
ya emitido.

**QR.** El payload es `{ticket_code}.{firma}`, con firma
HMAC-SHA256(SERVER_SECRET) truncada a 16 bytes, sin datos personales. La
pagina publica `/e/{code}` renderiza los QR en el browser; el email los lleva
como imagen hosteada + adjuntos PNG, y siempre incluye el link publico como
respaldo (y para reenviar por WhatsApp).

**Emails.** Cada envio queda registrado en `email_sends` (destinatario,
resultado, error) para responder "no me llego" con datos. Un fallo de envio no
anula la venta: se reintenta con "reenviar email".

**Check-in.** `POST /api/checkins` responde siempre 200 con un `result`
discriminado (`ok`, `already_checked_in`, `invalid`, `void`,
`wrong_function`): son estados esperados del flujo de puerta, no errores. El
`UNIQUE(ticket_id)` de `checkins` + `ON CONFLICT DO NOTHING` resuelve la
carrera de dos escaneos simultaneos del mismo ticket y es el ancla de
idempotencia del sync offline (fase 4). El snapshot de puerta no incluye
montos ni datos de contacto (el rol door no ve plata). Ademas del rol `door`,
una vendedora puede operar la puerta (spec §3). Una funcion con ingresos
registrados ya no se puede editar ni anular sus ventas ingresadas.

**La plata (fase 5).** Dos estados independientes (spec §4): el comprador le
pago a la vendedora (`sales.payment_status`) y la vendedora le rindio a Eli
(`settlements`). El **saldo a rendir** = ventas pagas de la temporada (sin
cortesias ni anuladas) − rendido. Las rendiciones son montos libres,
parciales, no atadas venta por venta; se puede rendir de mas y el saldo queda
a favor. Las ventas anuladas no cuentan ni en reportes ni en saldos.

**Offline en la puerta (fase 4).** El modo puerta es offline-first: al abrirse
con conexion guarda el snapshot en IndexedDB y **todos** los escaneos se
validan localmente (el codigo existe en el snapshot, no esta usado ni en la
cola local); la red nunca esta en el camino de un escaneo. Cada verde se
encola en IndexedDB y la cola se sincroniza con `POST /api/checkins/sync` al
volver la conexion (tambien cada 15 s y al encolar). El sync es idempotente:
cualquier resultado del server es terminal y reintentar un batch procesado
devuelve `already_checked_in`, que el cliente trata igual que `ok`. Si dos
dispositivos escanearon el mismo ticket offline, gana el primero que
sincroniza (spec §6.4). El service worker (`web/public/sw.js`) cachea la shell
para que la app abra sin red; la primera carga del snapshot si necesita
conexion. La firma HMAC se verifica en el server al sincronizar; localmente
alcanza con que el codigo exista en el snapshot (spec §6.2), por lo que sin
conexion un QR de otra funcion se reporta como "invalido" (rojo igual).

**Escaneo en el celular.** La camara requiere HTTPS (o localhost). Para probar
el modo puerta desde un celular en desarrollo hace falta un tunel HTTPS, por
ejemplo `cloudflared tunnel --url http://localhost:5173`.

**Produccion (fase 6).** `Dockerfile` en tres etapas (frontend → binario Go
con todo embebido, tzdata incluida → distroless no-root) y `fly.toml` listos;
el deploy completo esta en [`docs/operations.md`](docs/operations.md), junto
con el runbook de operacion: temporada nueva, backups/restore (el
procedimiento se prueba local con `make db-restore-check`), reset de
contrasenas y los problemas tipicos. El server manda headers de seguridad
(nosniff, frame deny, permissions-policy con camara solo propia, HSTS cuando
hay TLS) y rate-limita por IP el login (10/min) y las rutas publicas
(60/min). La app es una PWA instalable (manifest + icono) y el modo puerta
mantiene la pantalla prendida (wake lock).

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
- [x] **2 — Ventas, entradas con QR y email.** Cupo transaccional, tickets
      ULID firmados, email con QRs, pagina publica, pagos, cortesias y
      anulaciones.
- [x] **3 — Check-in online.** Escaneo, verde/rojo, doble escaneo, busqueda
      manual, contador; check-in concurrente resuelto por unicidad en DB.
- [x] **4 — Offline en la puerta.** Snapshot en IndexedDB, validacion local,
      cola con sync idempotente, conflicto entre dispositivos resuelto por el
      primero que sincroniza, service worker para la shell.
- [x] **5 — Panel de Eli.** Reportes de ventas agrupables, rendiciones con
      saldo e historial, asistencia con polling; seed de demo realista
      (`make seed-demo`).
- [x] **6 — Pulido y deploy.** Docker + Fly listos, hardening, rate limits,
      PWA, wake lock, backups con restore verificado y runbook de operacion.
      El unico paso pendiente es correr `fly deploy` con una cuenta real.
