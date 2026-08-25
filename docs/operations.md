# Operacion de Acapelius

Runbook para quien administra la app: deploy, temporada nueva, backups y los
problemas tipicos. Todo lo de desarrollo esta en el [README](../README.md).

## Deploy inicial en Fly.io

Requisitos: cuenta en [fly.io](https://fly.io), `flyctl` instalado
(`brew install flyctl`), y el email configurado — Gmail con app password (ver
[Email por Gmail](#email-por-gmail)) o una API key de
[Resend](https://resend.com) con dominio verificado.

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

### Noches de funcion

La app duerme cuando no hay trafico (`min_machines_running = 0`) y despierta
con el primer request (~1 segundo). Para la puerta eso es aceptable, pero si
queres cero fricciones las noches de diciembre:

```bash
fly scale count 1   # y despues de la temporada, si queres ahorrar:
# (volver a auto-stop no requiere nada; min_machines_running sigue en 0)
```

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
3. **Usuarios** → dar de alta a las vendedoras nuevas (rol Vendedora) y a la
   gente de puerta (rol Puerta). A cada una pasale por WhatsApp la contrasena
   provisoria que muestra la pantalla — se ve una sola vez.
4. Las vendedoras entran, eligen su contrasena y ya pueden vender.

Notas:
- El precio se congela en cada venta: se puede cambiar el precio de la
  funcion a mitad de temporada sin tocar lo ya vendido.
- Una funcion con ingresos registrados ya no se puede editar.
- El saldo a rendir es por temporada: la temporada nueva arranca en cero.

## Backups y restore

**La regla:** el backup que no se probo restaurar no existe.

### Con Postgres managed (Fly MPG / Neon)

Los dos hacen backups automaticos diarios con restore point-in-time desde su
consola. Igual conviene un dump logico periodico propio (es lo que te llevas
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
publico — compartilo por WhatsApp ("Copiar link"). Si Resend rebota,
`fly logs` muestra el error del envio.

**Una vendedora se olvido la contrasena.** No hay reset por email en el MVP.
Opcion rapida por SQL (genera una provisoria y obliga a cambiarla):

```bash
# hash de una contrasena provisoria, p. ej. "cambiame-ya":
# (correr en el repo)
go run - <<'EOF'
package main
import ("fmt"; "golang.org/x/crypto/bcrypt")
func main() { h,_ := bcrypt.GenerateFromPassword([]byte("cambiame-ya"), 11); fmt.Println(string(h)) }
EOF
# y en psql contra produccion:
# UPDATE users SET password_hash='<hash>', must_change_password=TRUE
#   WHERE email='vendedora@...';
```

**El QR no escanea en la puerta.** 1) ¿La camara tiene permiso y HTTPS?
2) El modo manual siempre funciona: buscar por nombre y marcar con un tap.
3) Sin conexion la app sigue escaneando; el contador de "sin sincronizar"
baja solo cuando vuelve la red.

**¿Quien escaneo/anulo/vendio?** Todo queda con autor: `checkins.user_id`,
`sales.seller_id`, `settlements`. `fly logs` tiene el resto.

## Env vars de produccion

| Variable | Valor |
|---|---|
| `DATABASE_URL` | secret (attach de Fly o URL de Neon con `sslmode=require`) |
| `SERVER_SECRET` | secret, 32+ bytes. **Cambiarlo invalida todos los QR ya emitidos y las sesiones**: no rotarlo en temporada |
| `SMTP_USER` / `SMTP_PASSWORD` | secret; la cuenta de Gmail y su app password |
| `EMAIL_FROM` | `Acapelius <acapelius@gmail.com>` (misma cuenta que SMTP_USER) |
| `RESEND_API_KEY` | secret; solo si `EMAIL_DRIVER=resend` |
| `BASE_URL` | la URL publica con https |
| resto | en `fly.toml` (`PORT`, `APP_ENV`, `EMAIL_DRIVER`, `TZ`, `AUTO_MIGRATE`) |
