# Acapelius — Especificación funcional y plan de desarrollo

> Documento de trabajo para Claude Code. Contiene el contexto del problema, las decisiones ya tomadas, el modelo de datos, la arquitectura, los contratos de API y un plan de desarrollo por fases con criterios de aceptación. **Las decisiones marcadas como "cerradas" no se rediscuten: implementarlas tal cual.**

---

## 1. Contexto y problema

Un coro se presenta cada diciembre en ~4–6 fechas (funciones). Hoy toda la gestión de entradas es manual:

- Las vendedoras ("las chicas del coro") venden entradas en mano y el director (**Eli**) lleva el registro en papel/planilla: quién vendió, a quién, cuánta plata le deben rendir.
- El día de la función, en la puerta hay una persona con una lista impresa. El comprador dice "soy María Dutra, le compré a Carolina", se busca en la lista, se marca a mano y se le entrega la entrada.

**Objetivo:** digitalizar el ciclo completo: registro de ventas → envío de entrada con QR por email → check-in en puerta escaneando el QR (con búsqueda manual como fallback) → panel para Eli con ventas, deudas/rendiciones y asistencia.

## 2. Decisiones cerradas

| Tema | Decisión |
|---|---|
| Cobro | **Efectivo o transferencia bancaria, en mano.** La app solo registra el estado del pago. No hay pasarela de pago online en el MVP. |
| Ubicaciones | **Entrada general, sin asientos ni sectores.** Solo se controla cupo por función. |
| Canal de envío | **Email** como canal principal. La entrada además vive en una URL pública con token, así "reenviar la entrada" es compartir un link (esto habilita WhatsApp manualmente sin integración). |
| Cortesías | **Requisito de día uno.** Eli emite entradas sin venta/pago asociado. |
| Offline en puerta | **Requisito.** El check-in debe funcionar sin conectividad (ver §6). |
| Idioma de la UI | Español (Argentina). Código, identificadores y commits en inglés. |

## 3. Roles y permisos

| Rol | Puede |
|---|---|
| `admin` (Eli) | Todo: crear temporadas/funciones, crear usuarios, ver todas las ventas, registrar rendiciones, emitir cortesías, anular entradas, ver reportes de asistencia. |
| `seller` (vendedora) | Registrar ventas propias, ver sus propias ventas y su saldo a rendir, reenviar entradas de sus ventas, marcar que la compradora le pagó. |
| `door` (recepción) | Modo puerta de una función: escanear QRs, buscar por nombre/vendedora, marcar ingresos. No ve montos de dinero. |
| Comprador | Sin cuenta. Recibe email con QR y link a su entrada pública. |

Notas:
- Un usuario puede tener más de un rol (una vendedora puede estar en la puerta). Modelarlo como campo `role` simple en MVP está bien si `admin` puede hacer todo; alternativa: lista de roles. Elegir lo más simple que cumpla la tabla.
- Los usuarios los crea el admin (nombre, email, rol, password temporal que se cambia al primer login). Sin registro público.

## 4. Modelo de datos

**PostgreSQL 16.** Usar migraciones versionadas (golang-migrate o goose). Esquema de referencia (ajustar índices según convenga, mantener la semántica):

```sql
users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- bcrypt/argon2
  role          TEXT NOT NULL,          -- 'admin' | 'seller' | 'door'
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

seasons (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,             -- "Temporada 2026"
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

functions (
  id          BIGSERIAL PRIMARY KEY,
  season_id   BIGINT NOT NULL REFERENCES seasons(id),
  name        TEXT,                     -- opcional, ej. "Función de gala"
  venue       TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,     -- zona America/Argentina/Buenos_Aires en presentación
  capacity    INTEGER NOT NULL,
  price_cents BIGINT NOT NULL,          -- precio por entrada en centavos ARS
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)

sales (
  id             BIGSERIAL PRIMARY KEY,
  function_id    BIGINT NOT NULL REFERENCES functions(id),
  seller_id      BIGINT NOT NULL REFERENCES users(id),
  buyer_name     TEXT NOT NULL,
  buyer_email    TEXT,                  -- nullable: puede no tener email (ver §5.2)
  buyer_phone    TEXT,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  amount_cents   BIGINT NOT NULL,       -- quantity * price al momento de la venta
  payment_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'paid'
  payment_method TEXT,                  -- 'cash' | 'transfer' (cuando paid)
  is_comp        BOOLEAN NOT NULL DEFAULT FALSE,   -- cortesía: amount=0, payment n/a
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)

tickets (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     BIGINT NOT NULL REFERENCES sales(id),
  code        TEXT NOT NULL UNIQUE,     -- identificador público aleatorio (ULID/UUID)
  status      TEXT NOT NULL DEFAULT 'issued',  -- 'issued' | 'checked_in' | 'void'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)

checkins (
  id         BIGSERIAL PRIMARY KEY,
  ticket_id  BIGINT NOT NULL UNIQUE REFERENCES tickets(id),
  user_id    BIGINT NOT NULL REFERENCES users(id),  -- quién escaneó
  method     TEXT NOT NULL,            -- 'scan' | 'manual'
  device_id  TEXT,                     -- para dedupe de sync offline
  created_at TIMESTAMPTZ NOT NULL      -- momento real del ingreso (puede venir del cliente en sync offline)
)

settlements (
  id           BIGSERIAL PRIMARY KEY,
  seller_id    BIGINT NOT NULL REFERENCES users(id),
  season_id    BIGINT NOT NULL REFERENCES seasons(id),
  amount_cents BIGINT NOT NULL,        -- monto que la vendedora le rindió a Eli
  method       TEXT NOT NULL,          -- 'cash' | 'transfer'
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Nota: la validación de cupo debe hacerse en una transacción con lock (`SELECT ... FOR UPDATE` sobre la función, o constraint a nivel aplicación con `SERIALIZABLE`) para evitar sobreventa con ventas concurrentes.

**Semántica de la plata (importante):** hay dos estados independientes.
1. `sales.payment_status`: el comprador le pagó (o no) a la vendedora.
2. `settlements`: la vendedora le rindió (o no) plata a Eli. El **saldo a rendir** de una vendedora en una temporada = suma de `amount_cents` de sus ventas `paid` (excluyendo cortesías) − suma de sus `settlements`. Las rendiciones son montos libres (parciales), no se atan venta por venta.

**Cortesías:** son un `sale` con `is_comp=1`, `amount_cents=0`, `seller_id` = quien la emite (típicamente Eli). Generan tickets normales, aparecen en asistencia, no aparecen en deudas.

## 5. Flujos funcionales

### 5.1 Admin: temporada y funciones
- Crear temporada, crear funciones (lugar, fecha/hora, cupo, precio).
- Editar función mientras no tenga check-ins. El precio de ventas ya hechas no cambia (queda congelado en `amount_cents`).
- Validación de cupo: la suma de `quantity` de ventas no anuladas de una función no puede superar `capacity`. Anular tickets libera cupo.

### 5.2 Vendedora: registrar venta
1. Elige función → carga nombre del comprador, email (opcional), teléfono (opcional), cantidad.
2. El sistema valida cupo, crea `sale` + N `tickets`, y:
   - Si hay email: envía el email con los QRs (ver §7).
   - Siempre: muestra el **link público de la venta** (`/e/{sale_code}` o links por ticket) con botón "copiar", para que la vendedora lo comparta por WhatsApp manualmente.
3. Si el comprador no tiene email ni WhatsApp: la entrada existe igual y en puerta se lo encuentra por búsqueda manual (nombre + vendedora). Este es exactamente el flujo actual en papel, digitalizado.
- La vendedora puede marcar la venta como `paid` (con método) en cualquier momento.
- Reenviar email de una venta propia.

### 5.3 Eli: panel
- **Ventas:** por función y por vendedora; totales, pagas vs. pendientes.
- **Rendiciones:** por vendedora: vendido cobrado, rendido, **saldo a rendir**. Registrar una rendición (monto, método, nota).
- **Asistencia:** por función: emitidas vs. ingresadas, en tiempo real; lista de quiénes entraron y a qué hora.
- **Cortesías:** emitir (nombre, email opcional, cantidad, función).
- **Anular** tickets o ventas completas (status `void`; si tenía check-in, no se puede anular).

### 5.4 Recepción: modo puerta
1. Elige la función del día → la app entra en "modo puerta" y **precarga la lista completa de tickets válidos de esa función** (ver §6).
2. Escanea QR con la cámara → resultado inmediato:
   - **Verde:** válido, se marca `checked_in`, muestra nombre del comprador y vendedora.
   - **Rojo — ya usado:** muestra a qué hora y por quién fue escaneado antes.
   - **Rojo — inválido/anulado/otra función.**
3. Fallback manual: buscador por nombre de comprador o vendedora → lista de tickets de esa persona → marcar ingreso con un tap (method `manual`).
4. Contador visible: ingresados / emitidos.

## 6. Diseño de QR y modo offline (requisito no trivial)

En el venue el 4G puede fallar justo cuando entran 200 personas. El check-in **no puede depender del server en el momento del escaneo**.

**QR firmado con HMAC:**
- Payload del QR: `{ticket_code}.{firma}` donde `firma = base64url(HMAC-SHA256(ticket_code, SERVER_SECRET))` (truncada a 16 bytes está bien).
- El QR no contiene datos personales. El nombre se resuelve contra la lista precargada.

**Modo puerta offline-first:**
1. Al abrir el modo puerta con conexión, el cliente baja el snapshot de la función: todos los tickets (`code`, `buyer_name`, `seller_name`, `status`) + el listado de check-ins ya hechos. Se guarda en IndexedDB.
2. Cada escaneo se valida **localmente**: firma HMAC correcta (la validación de firma la hace el server al sincronizar; localmente alcanza con que el `code` exista en el snapshot) + no está en el set local de usados + status `issued`.
3. Cada check-in se marca localmente y se encola. Con conectividad, la cola se sincroniza (`POST /checkins/sync` idempotente por `ticket_id`).
4. Conflictos (dos dispositivos escanean el mismo ticket estando offline): gana el primero que sincroniza; el server responde `already_checked_in` y el cliente lo refleja. Aceptable para este contexto — el riesgo real de doble uso malicioso es bajísimo, el objetivo es control, no seguridad bancaria.
5. Refresco periódico del snapshot mientras haya conexión (polling simple cada ~30s alcanza; no hace falta WebSockets en MVP).

## 7. Email de la entrada

- Proveedor: **Resend** (fallback aceptable: SES). API key por variable de entorno. En desarrollo, driver "log" que escribe el email a stdout/archivo.
- Contenido: nombre del evento, función (fecha, hora, lugar), comprador, cantidad, un QR por entrada (PNG embebido), link a la página pública de la entrada, y aclaración "entrada general, sin numerar".
- Página pública `/e/{sale_code}`: muestra la(s) entrada(s) con QR renderizado en el browser, sin login. El `sale_code` es un token aleatorio no adivinable. Sirve como reenvío universal.
- Los envíos se registran (timestamp, destinatario, resultado) para poder ver "no me llegó" y reenviar.

## 8. Stack y arquitectura

**Backend — Go (monolito):**
- Go 1.22+, router **Chi**.
- **PostgreSQL 16** vía **pgx/v5** (pool con `pgxpool`) + **sqlc** con engine postgres para queries tipadas. En desarrollo, Postgres levantado con `docker-compose.yml` incluido en el repo.
- Backups: `pg_dump` diario programado, o directamente usar un Postgres managed (Fly Postgres, Neon, Railway, Supabase) que ya incluye backups automáticos — recomendado para no operar la DB a mano.
- Sesiones con cookie HTTP-only + SameSite=Lax (librería `scs` o similar). Passwords con bcrypt. Middleware de autorización por rol.
- QR: `github.com/skip2/go-qrcode` para generar los PNG de los emails.
- Config por env vars (`PORT`, `DATABASE_URL`, `SERVER_SECRET`, `RESEND_API_KEY`, `BASE_URL`, `EMAIL_DRIVER=log|resend`).
- Logging estructurado (`log/slog`).

**Frontend — React PWA:**
- Vite + React + TypeScript. Servida por el mismo binario Go (embed del build con `embed.FS`) para deploy de un solo artefacto.
- Escaneo: **`html5-qrcode`** (usa la cámara vía getUserMedia; requiere HTTPS).
- Offline: service worker (Workbox o manual) para cachear la shell + **IndexedDB** (lib `idb`) para snapshot y cola de check-ins.
- UI simple y grande: se usa de noche, apurado, en un celu. Botones grandes, alto contraste, feedback verde/rojo a pantalla completa al escanear, vibración si está disponible.
- Estado: nada pesado; fetch + React Query (TanStack Query) alcanza.

**API REST (JSON), rutas de referencia:**
```
POST   /api/auth/login | POST /api/auth/logout | POST /api/auth/change-password
GET    /api/me
# admin
POST   /api/users            GET /api/users
POST   /api/seasons          GET /api/seasons
POST   /api/functions        GET /api/functions?season_id=  PATCH /api/functions/{id}
GET    /api/reports/sales?function_id=&seller_id=
GET    /api/reports/settlements?season_id=
GET    /api/reports/attendance?function_id=
POST   /api/settlements
POST   /api/sales/{id}/void  POST /api/tickets/{id}/void
# seller (admin también)
POST   /api/sales            GET /api/sales?mine=1
PATCH  /api/sales/{id}       # payment_status, payment_method
POST   /api/sales/{id}/resend-email
# door
GET    /api/functions/{id}/door-snapshot     # tickets + checkins para offline
POST   /api/checkins                          # check-in online directo
POST   /api/checkins/sync                     # batch idempotente desde la cola offline
# público (sin auth)
GET    /e/{sale_code}                         # página de la entrada
```

**Estructura de proyecto sugerida:**
```
acapelius/
├── cmd/server/main.go
├── internal/
│   ├── auth/          # sesiones, middleware de roles
│   ├── db/            # migrations/, sqlc generado, queries .sql
│   ├── domain/        # tipos y reglas (cupo, saldos, estados)
│   ├── http/          # handlers por recurso, router
│   ├── mail/          # driver resend + log
│   └── qr/            # firma HMAC + generación PNG
├── web/               # Vite + React + TS (build embebido en el binario)
├── docker-compose.yml # Postgres 16 para desarrollo local
├── Makefile           # dev, test, build, migrate
└── fly.toml
```

## 9. Plan de desarrollo por fases

Cada fase termina con tests pasando y algo demostrable. No avanzar de fase con criterios de aceptación pendientes.

### Fase 0 — Fundaciones
- Scaffolding del repo, docker-compose con Postgres 16, Makefile, config por env, migraciones, sqlc (engine postgres, pgx/v5), servidor Chi con health check (incluye ping a la DB), build del frontend embebido.
- Auth completa: login/logout, cambio de password obligatorio al primer ingreso, middleware por rol, seed inicial con un admin.
- **Aceptación:** admin puede loguearse; rutas protegidas devuelven 401/403 correctamente; `make dev` levanta todo.

### Fase 1 — Temporadas, funciones y usuarios
- CRUD de temporadas y funciones (admin). Alta de usuarios seller/door.
- **Aceptación:** Eli crea "Temporada 2026" con 4 funciones con cupo y precio; crea 5 vendedoras.

### Fase 2 — Ventas + entradas + email
- Registro de venta con validación de cupo transaccional, generación de tickets con `code` ULID, firma HMAC, email con QRs (driver log en dev), página pública `/e/{sale_code}`, reenvío, marcar pagos, cortesías, anulaciones.
- **Aceptación:** una vendedora registra una venta de 3 entradas; llega email (visible en driver log) con 3 QRs; la página pública renderiza; una venta que excede cupo es rechazada; una cortesía no suma deuda.

### Fase 3 — Check-in online
- Modo puerta: escaneo con `html5-qrcode`, validación contra el server, pantallas verde/rojo, doble escaneo detectado, búsqueda manual por nombre/vendedora, contador de ingresados.
- **Aceptación:** flujo completo con conexión: escanear → verde; re-escanear → rojo con hora del primer ingreso; buscar "María" → marcar manual.

### Fase 4 — Offline en puerta
- Snapshot precargado en IndexedDB, validación local, cola de check-ins, `POST /api/checkins/sync` idempotente, resolución de conflictos, indicador de estado de conexión/pendientes de sync.
- **Aceptación:** con el server apagado (o red cortada en el navegador), escanear sigue funcionando; al reconectar, la cola sincroniza y los check-ins aparecen en el panel de Eli. Test del caso "dos dispositivos escanean el mismo ticket offline".

### Fase 5 — Panel de Eli
- Reportes de ventas (por función/vendedora), rendiciones con saldo a rendir y registro de rendiciones parciales, asistencia por función con actualización periódica.
- **Aceptación:** con datos de seed realistas, Eli responde en un vistazo: ¿cuánto vendió Carolina?, ¿cuánto me debe?, ¿cuánta gente entró anoche?

### Fase 6 — Pulido y deploy
- Seeds de demo, revisión de UX móvil (modo puerta con guantes/apuro), rate limiting básico en login y rutas públicas, deploy a Fly.io con Postgres managed (Fly Postgres o Neon) y HTTPS, backups verificados, README de operación (alta de temporada nueva, backup/restore).
- **Aceptación:** app corriendo en producción con dominio y HTTPS; restore de backup probado.

## 10. Testing

- Unit tests en `domain/`: cálculo de saldo a rendir, validación de cupo, estados de ticket, firma/verificación HMAC.
- Tests de handlers contra Postgres real usando **testcontainers-go** (o el Postgres de docker-compose con una DB de test que se recrea por corrida): flujo venta→email→check-in, idempotencia de `checkins/sync`, validación de cupo bajo concurrencia, autorización por rol (seller no ve ventas ajenas, door no ve montos).
- Frontend: tests de la lógica offline (cola, dedupe) con IndexedDB mockeado. No hace falta E2E completo en MVP.

## 11. Fuera de alcance (MVP)

- Pago online (MercadoPago) — posible temporada 2.
- Asientos numerados o sectores.
- Envío automático por WhatsApp (se cubre con link compartible).
- Multi-coro / multi-tenant. El modelo con `seasons` deja la puerta abierta, pero no diseñar tenancy ahora.
- Notificaciones push, WebSockets, estadísticas históricas comparativas.

## 12. Variables de entorno

```
PORT=8080
BASE_URL=https://acapelius.example.com
DATABASE_URL=postgres://user:pass@host:5432/acapelius?sslmode=require
SERVER_SECRET=<random 32+ bytes, firma HMAC y sesiones>
EMAIL_DRIVER=resend            # 'log' en desarrollo
RESEND_API_KEY=<key>
EMAIL_FROM="Acapelius <entradas@dominio.com>"
TZ=America/Argentina/Buenos_Aires
```
