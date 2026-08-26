# Operacion de Acapelius

Runbook para quien administra la app: deploy, temporada nueva, backups y los
problemas tipicos. Todo lo de desarrollo esta en el [README](../README.md).

## Deploy en Railway

Railway corre la app desde el `Dockerfile` del repo (la config de build y el
health check estan en `railway.json`). Requisitos: cuenta en
[railway.com](https://railway.com) (plan Hobby, ~USD 5/mes con uso incluido)
y el email de Gmail configurado (ver [Email por Gmail](#email-por-gmail)).

### Primera vez

```bash
# 1. CLI de Railway y login (abre el browser):
brew install railway
railway login

# 2. Crear el proyecto y subir el codigo:
railway init          # nombre: acapelius
railway up            # sube el repo, compila el Dockerfile y deploya

# 3. Agregar Postgres al proyecto (backups automaticos en el plan pago):
railway add --database postgres

# 4. Variables del servicio de la app. En el dashboard, servicio de la app →
#    Variables, o por CLI:
railway variables \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set "SERVER_SECRET=$(openssl rand -hex 32)" \
  --set 'APP_ENV=production' \
  --set 'AUTO_MIGRATE=true' \
  --set 'TZ=America/Argentina/Buenos_Aires' \
  --set 'EMAIL_DRIVER=smtp' \
  --set 'SMTP_HOST=smtp.gmail.com' \
  --set 'SMTP_PORT=587' \
  --set 'SMTP_USER=acapelius@gmail.com' \
  --set 'SMTP_PASSWORD=<la app password de 16 letras>' \
  --set 'EMAIL_FROM=Acapelius <acapelius@gmail.com>'

# 5. Dominio publico: dashboard → servicio de la app → Settings → Networking
#    → Generate Domain. Con la URL que da (https://xxx.up.railway.app):
railway variables --set 'BASE_URL=https://xxx.up.railway.app'

# 6. Redeploy para tomar las variables:
railway up

# 7. Crear el admin (una sola vez). La base de Railway no expone URL publica
#    por defecto; se entra por el tunel SSH del CLI (pide una clave SSH
#    registrada: `railway ssh keys add`):
HASH=$(go run ./cmd/hashpw 'una-contrasena-provisoria')
echo "INSERT INTO users (name, email, password_hash, role, must_change_password)
      SELECT 'Eli', 'eli@...', '$HASH', 'admin', TRUE
      WHERE NOT EXISTS (SELECT 1 FROM users);" | railway connect Postgres
```

Verificacion: `curl https://<tu-dominio>/api/health` →
`{"status":"ok","database":"ok"}`.

Notas:

- Railway inyecta `PORT` solo; la app lo lee. No hay que configurarlo.
- `DATABASE_URL=${{Postgres.DATABASE_URL}}` es una *referencia*: si Railway
  rota la credencial de Postgres, la app la sigue sola.
- `BASE_URL` con https habilita la cookie `Secure` y arma los links de los
  emails: sin el paso 5 los mails salen con links rotos.
- Deploys siguientes: `railway up` (o conectar el repo de GitHub en el
  dashboard para que deploye solo con cada push).
- Logs: `railway logs`, o el dashboard.

### Dominio propio (opcional)

Dashboard → Settings → Networking → Custom Domain, crear el CNAME que indica,
y actualizar `BASE_URL` al dominio nuevo.

## Alternativa: Fly.io

El repo tambien trae `fly.toml` por si algun dia conviene mudarse (tiene
servidores en Buenos Aires; Railway corre en us-west/us-east). Requisitos:
cuenta en [fly.io](https://fly.io), `flyctl` instalado
(`brew install flyctl`), y el email configurado.

```bash
fly auth login

# 1. Crear la app (el nombre de fly.toml tiene que estar libre; si no,
#    cambialo ahi y en los comandos que siguen).
fly apps create acapelius

# 2. Base de datos. Dos opciones:

# 2a. Managed Postgres de Fly (backups automaticos incluidos):
fly mpg create --name acapelius-db --region eze
fly mpg attach acapelius-db --app acapelius   # setea DATABASE_URL sola

# 2b. O Neon (neon.tech, tier gratis con backups): crear el proyecto en su
#     consola y setear la URL a mano:
# fly secrets set DATABASE_URL='postgres://...neon.tech/acapelius?sslmode=require'

# 3. Secrets (los que no vienen del attach). Con Gmail:
fly secrets set \
  SERVER_SECRET="$(openssl rand -hex 32)" \
  SMTP_USER='acapelius@gmail.com' \
  SMTP_PASSWORD='xxxx xxxx xxxx xxxx' \
  EMAIL_FROM='Acapelius <acapelius@gmail.com>' \
  BASE_URL='https://acapelius.fly.dev'
# (con Resend: RESEND_API_KEY en vez de SMTP_*, y EMAIL_DRIVER=resend en fly.toml)

# 4. Deploy (compila el Dockerfile: frontend + binario Go):
fly deploy

# 5. Crear el admin (una sola vez; el seed es idempotente). Se corre desde tu
#    maquina apuntando a la base de produccion:
#    - Neon: usa su URL publica directa.
#    - Fly MPG: `fly mpg proxy` abre un tunel local y te da la URL.
DATABASE_URL='postgres://...' \
  SERVER_SECRET='cualquier-cosa-de-32-bytes-el-seed-no-lo-usa' \
  SEED_ADMIN_EMAIL='eli@tudominio.com' \
  go run ./cmd/seed
```

Verificacion: `curl https://acapelius.fly.dev/api/health` tiene que responder
`{"status":"ok","database":"ok"}`.

### Dominio propio

```bash
fly certs add entradas.tudominio.com
# crear el CNAME que indica el comando, esperar el certificado, y actualizar:
fly secrets set BASE_URL='https://entradas.tudominio.com'
```

`BASE_URL` importa: arma los links de los emails y habilita la cookie Secure.

### Deploys siguientes

```bash
fly deploy          # migraciones incluidas (AUTO_MIGRATE=true)
fly logs            # ver que paso
fly status          # estado de las maquinas
```

### Noches de funcion (solo Fly)

En Fly la app duerme sin trafico y despierta con el primer request (~1s);
`fly scale count 1` la deja fija. En Railway el servicio queda corriendo
siempre (es lo que cobra el plan); no hay que hacer nada.

## Email por Gmail

La app manda los emails de las entradas desde `acapelius@gmail.com` por SMTP.
Configuracion, una sola vez:

1. Entrar a la cuenta y activar la **verificacion en 2 pasos**
   (myaccount.google.com → Seguridad). Sin esto Google no deja crear
   contrasenas de aplicacion.
2. Crear una **contrasena de aplicacion** en
   <https://myaccount.google.com/apppasswords> (nombre: "Acapelius"). Google
   muestra 16 caracteres una sola vez: esa es `SMTP_PASSWORD`.
3. Configurar (en `.env` local o `fly secrets set` en produccion):

   ```
   EMAIL_DRIVER=smtp
   SMTP_USER=acapelius@gmail.com
   SMTP_PASSWORD=<la contrasena de aplicacion>
   EMAIL_FROM="Acapelius <acapelius@gmail.com>"
   ```

   `SMTP_HOST`/`SMTP_PORT` ya tienen los valores de Gmail por defecto.

A tener en cuenta:

- **`EMAIL_FROM` debe usar la misma direccion de la cuenta**: Gmail reescribe
  cualquier otro remitente.
- **Limite de ~500 destinatarios por dia** en cuentas gratuitas. Para un coro
  (cientos de entradas por temporada, no por dia) alcanza de sobra; si un dia
  se pasa, Gmail bloquea el envio 24 hs — el link publico de cada entrada
  sigue funcionando y se puede compartir por WhatsApp.
- Si se cambia la contrasena de la cuenta o se revoca la app password, los
  envios empiezan a fallar con "autenticacion SMTP": generar una nueva y
  actualizar el secret.
- Los envios fallidos quedan en `email_sends` y se reintentan con "Reenviar
  email" desde la pantalla de ventas.

## Alta de una temporada nueva

Todo desde la UI, como admin:

1. **Temporadas y funciones** → crear "Temporada 2027".
2. Dentro de la temporada, **Agregar funcion** por cada fecha: lugar,
   fecha/hora, cupo y precio.
3. **Equipo** → "＋ Nuevo usuario" por cada corista nueva (rol Corista) y por
   la gente de puerta (rol Puerta). A cada una le llega un email con su acceso;
   la contrasena provisoria tambien queda en pantalla para pasarla por
   WhatsApp — se ve una sola vez.
4. En cada funcion, **Asignar entradas a coristas**: sin cupo asignado nadie
   puede registrar ventas de esa funcion (modo estricto).
5. Las coristas entran, eligen su contrasena y ya pueden vender.

Notas:
- El precio se congela en cada venta: se puede cambiar el precio de la
  funcion a mitad de temporada sin tocar lo ya vendido.
- Una funcion con ingresos registrados ya no se puede editar.
- El saldo a rendir es por temporada: la temporada nueva arranca en cero.

## Datos de prueba

`cmd/seeddemo` imprime el SQL de una temporada completa para recorrer la app:
10 coristas, una persona en la puerta, cuatro funciones (dos pasadas con
ingresos, una hoy y una futura), cupos asignados, ventas repartidas en las
ultimas dos semanas, cortesias y rendiciones parciales.

```bash
# Local (borra y recarga la base de desarrollo):
make seed-demo

# Produccion, por el tunel de Railway:
go run ./cmd/seeddemo | railway connect Postgres

# O revisar el SQL antes de correrlo:
go run ./cmd/seeddemo > /tmp/demo.sql
```

Que borra y que no: se lleva la temporada entera (funciones, ventas, entradas,
ingresos, cupos, rendiciones) y **solo** los usuarios del dominio de prueba
`@demo.acapelius.local`. La direccion y cualquier cuenta real quedan intactas,
con su contrasena; a las coristas reales que sobreviven se les da un cupo en la
ultima funcion para que puedan probar una venta.

Las cuentas de prueba entran con `acapelius-demo`
(`<nombre.apellido>@demo.acapelius.local`, `puerta@demo.acapelius.local`). Dos
coristas quedan sin entrar nunca, para ver el chip de invitacion pendiente.

## Backups y restore

**La regla:** el backup que no se probo restaurar no existe.

### Con Postgres managed (Railway / Fly MPG / Neon)

Todos hacen backups automaticos desde su consola (en Railway: servicio
Postgres → Backups, diarios en el plan pago). Igual conviene un dump logico periodico propio (es lo que te llevas
si cambias de proveedor):

```bash
# dump (necesita pg_dump >= version del server; en macOS: brew install libpq)
pg_dump "$DATABASE_URL" -Fc -f acapelius-$(date +%Y%m%d).dump
```

### Probar un restore (local, con docker compose corriendo)

```bash
make db-backup          # dump de la base local a backups/
make db-restore-check   # lo restaura en una base descartable y cuenta filas
```

Para probar un dump de produccion: copiarlo a `backups/` y correr
`make db-restore-check` — restaura el `.dump` mas nuevo del directorio.

### Restore real (desastre)

```bash
# crear una base vacia nueva en el proveedor, y:
pg_restore -d "$NUEVA_DATABASE_URL" --no-owner acapelius-YYYYMMDD.dump
fly secrets set DATABASE_URL="$NUEVA_DATABASE_URL"   # redeploya solo
```

## Problemas tipicos

**"No me llego el email".** Cada envio queda registrado (tabla
`email_sends`). Antes de investigar: reenviar desde "Mis ventas" → "Reenviar
email". Si el email esta mal escrito, la entrada vive igual en el link
publico — compartilo por WhatsApp ("Copiar link"). Si Gmail rechaza el
envio, `railway logs` muestra el error exacto (los tipicos: app password
revocada, o limite diario superado).

**Una vendedora se olvido la contrasena.** No hay reset por email en el MVP.
Se le pone una provisoria por SQL (y el sistema la obliga a cambiarla):

```bash
HASH=$(go run ./cmd/hashpw 'cambiame-ya')
echo "UPDATE users SET password_hash='$HASH', must_change_password=TRUE
      WHERE email='vendedora@...';" | railway connect Postgres
```

**El QR no escanea en la puerta.** 1) ¿La camara tiene permiso y HTTPS?
2) El modo manual siempre funciona: buscar por nombre y marcar con un tap.
3) Sin conexion la app sigue escaneando; el contador de "sin sincronizar"
baja solo cuando vuelve la red.

**¿Quien escaneo/anulo/vendio?** Todo queda con autor: `checkins.user_id`,
`sales.seller_id`, `settlements`. `railway logs` tiene el resto.

## Env vars de produccion

| Variable | Valor |
|---|---|
| `DATABASE_URL` | en Railway: la referencia `${{Postgres.DATABASE_URL}}` |
| `SERVER_SECRET` | secret, 32+ bytes. **Cambiarlo invalida todos los QR ya emitidos y las sesiones**: no rotarlo en temporada |
| `SMTP_USER` / `SMTP_PASSWORD` | secret; la cuenta de Gmail y su app password |
| `EMAIL_FROM` | `Acapelius <acapelius@gmail.com>` (misma cuenta que SMTP_USER) |
| `RESEND_API_KEY` | secret; solo si `EMAIL_DRIVER=resend` |
| `BASE_URL` | la URL publica con https |
| resto | en `fly.toml` (`PORT`, `APP_ENV`, `EMAIL_DRIVER`, `TZ`, `AUTO_MIGRATE`) |
