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

## Email

**Railway bloquea el SMTP saliente** en todos los planes menos Pro: la app
corriendo ahi no puede hablar con smtp.gmail.com (la conexion muere con
`i/o timeout` antes de llegar). Por eso produccion manda por **Resend**, que
es una API HTTPS y sale sin problema. El driver de Gmail sigue existiendo y
sirve para desarrollo local, donde el 587 esta abierto.

### Produccion: Resend con dominio propio

Una vez, al configurar:

1. Crear la cuenta en <https://resend.com> (plan gratis: 3.000 emails por mes,
   100 por dia).
2. **Domains → Add Domain**: conviene un subdominio dedicado al correo
   (`envios.tudominio.com`), no la raiz. Aisla la reputacion de envio, y deja
   la raiz y los demas subdominios libres para el sitio.
3. Resend muestra los registros DNS a cargar en el proveedor del dominio: un
   MX y dos TXT (SPF y DKIM). Son los que le dan permiso a Resend para firmar
   correo en nombre del dominio; sin ellos Gmail lo manda a spam.
   En **Cloudflare**: escribir en el campo Name solo la parte izquierda (el
   panel agrega la zona solo), y dejar el proxy en **DNS only** (nube gris).
4. Esperar el estado **Verified** (minutos).
5. **API Keys → Create API Key** con permiso *Sending access*.
6. Cargar las variables en el servicio:

   ```
   EMAIL_DRIVER=resend
   RESEND_API_KEY=re_...
   EMAIL_FROM="Acapelius <entradas@envios.tudominio.com>"
   ```

   ```bash
   railway variables --service acapelius \
     --set "EMAIL_DRIVER=resend" \
     --set "RESEND_API_KEY=re_..." \
     --set "EMAIL_FROM=Acapelius <entradas@envios.tudominio.com>"
   ```

   Cambiar variables reinicia el servicio solo. En el arranque, el log tiene
   que decir `email_driver="resend"`.

`EMAIL_FROM` **tiene que usar el dominio verificado**: Resend rechaza el envio
si el remitente es de otro dominio.

### Desarrollo local: Gmail o el driver log

Por defecto `EMAIL_DRIVER=log` escribe el email en la consola y no manda nada:
alcanza para ver el contenido. Para probar un envio real desde la maquina
(donde el 587 si sale), con una cuenta de Gmail:

1. Activar la **verificacion en 2 pasos** en la cuenta
   (myaccount.google.com → Seguridad).
2. Crear una **contrasena de aplicacion** en
   <https://myaccount.google.com/apppasswords>. Son 16 caracteres que Google
   muestra una sola vez.
3. En `.env`:

   ```
   EMAIL_DRIVER=smtp
   SMTP_USER=acapelius@gmail.com
   SMTP_PASSWORD=<la contrasena de aplicacion>
   EMAIL_FROM="Acapelius <acapelius@gmail.com>"
   ```

   `SMTP_HOST`/`SMTP_PORT` ya vienen con los valores de Gmail.

Con Gmail, `EMAIL_FROM` debe ser la misma direccion de la cuenta: Gmail
reescribe cualquier otro remitente. El limite gratuito es de ~500 envios por
dia.

### Cuando un envio falla

Todo envio queda registrado en `email_sends` con su estado y el error. Un
fallo no anula nada: la venta se registra igual, la pantalla lo dice, y desde
el listado de ventas esta **Reenviar email**. El link publico de cada entrada
funciona siempre y se puede pasar por WhatsApp como respaldo.

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

## Datos de prueba: la organizacion demo

La demo (C17 §C) es una organizacion mas, con `is_demo = true` y slug
`demo`: 10 integrantes, una persona en la puerta, cuatro funciones (tres
hechas, una en venta), ~50 ventas con los cuatro estados de pago, cortesias,
ingresos con asistencia dispareja y rendiciones parciales. Nombres
inventados.

- El server la siembra al arrancar si no existe (`DEMO_ENABLED=true`, el
  default) y la reinicia todas las noches a las 4 (hora de `TZ`).
- `make demo-reset` (o `go run ./cmd/demoreset`) la borra y la vuelve a
  sembrar a mano; es idempotente.
- `POST /api/demo/session` abre una sesion de invitado de 6 horas como
  direccion de esa organizacion. En la demo no sale ningun mail
  (`email_status: preview`) y no se cambia la contraseña.
- Solo toca filas de la organizacion demo: el resto de la base ni se mira.

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
