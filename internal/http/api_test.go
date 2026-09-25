package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/config"
	"github.com/ale-hts/acapelius/internal/db"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	httpapi "github.com/ale-hts/acapelius/internal/http"
	"github.com/ale-hts/acapelius/internal/mail"
	"github.com/ale-hts/acapelius/internal/qr"
)

// Estos tests corren contra un Postgres real. Se saltean si no hay
// TEST_DATABASE_URL; `make test-integration` la define apuntando a la base de
// test del docker-compose.
const testDatabaseURLEnv = "TEST_DATABASE_URL"

const (
	adminEmail       = "eli@acapelius.test"
	adminTempPass    = "provisoria-1"
	adminNewPassword = "temporada-2026"
)

type testEnv struct {
	server   *httptest.Server
	pool     *pgxpool.Pool
	emailLog *syncBuffer
	signer   *qr.Signer
	// orgID es la organizacion "del coro" de cada test: la crea el primer
	// seedUser, como hace `make seed`. Los tests de aislamiento crean otras
	// con seedOrg.
	orgID int64
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()

	databaseURL := os.Getenv(testDatabaseURLEnv)
	if databaseURL == "" {
		t.Skipf("se saltea: definir %s para correr los tests de integracion", testDatabaseURLEnv)
	}

	t.Setenv("DATABASE_URL", databaseURL)
	t.Setenv("SERVER_SECRET", "test-secret-con-mas-de-32-bytes-para-pasar")
	t.Setenv("BASE_URL", "http://localhost")
	t.Setenv("EMAIL_DRIVER", "log")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("conectar a la base de test: %v", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrar la base de test: %v", err)
	}

	// Cada test arranca con la base limpia; los tests no corren en paralelo
	// entre si porque comparten esta base.
	if _, err := pool.Exec(ctx, "TRUNCATE organizations, users, sessions, seasons, functions, sales, tickets, email_sends RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("limpiar la base de test: %v", err)
	}

	sessions := auth.NewSessionManager(pool, cfg)
	authService := auth.NewService(pool, sessions)

	// El driver log escribe en un buffer que los tests pueden inspeccionar.
	emailLog := &syncBuffer{}
	signer := qr.NewSigner(cfg.ServerSecret)
	mailer := mail.NewLogDriver(emailLog)

	server := httptest.NewServer(httpapi.New(cfg, pool, authService, signer, mailer).Handler())

	t.Cleanup(func() {
		server.Close()
		pool.Close()
	})

	return &testEnv{server: server, pool: pool, emailLog: emailLog, signer: signer}
}

// syncBuffer es un bytes.Buffer con lock: el server escribe emails desde las
// goroutines de los handlers mientras el test lee.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// seedOrg crea una organizacion (C17 §A). Cada una arranca sin temporada:
// la crea el primer seedUserIn, como hace `make seed`.
func (e *testEnv) seedOrg(t *testing.T, name, slug string) int64 {
	t.Helper()
	org, err := sqlcgen.New(e.pool).CreateOrganization(context.Background(), sqlcgen.CreateOrganizationParams{
		Name: name, Kind: "choir", Slug: slug,
	})
	if err != nil {
		t.Fatalf("crear organizacion de test: %v", err)
	}
	return org.ID
}

// seedUser inserta un usuario directamente en la base, como hace `make seed`,
// en la organizacion del test (la crea la primera vez).
func (e *testEnv) seedUser(t *testing.T, name, email, password string, role domain.Role) domain.User {
	t.Helper()
	if e.orgID == 0 {
		e.orgID = e.seedOrg(t, "Coro de prueba", "prueba")
	}
	return e.seedUserIn(t, e.orgID, name, email, password, role)
}

// seedUserIn es seedUser en una organizacion dada.
func (e *testEnv) seedUserIn(t *testing.T, orgID int64, name, email, password string, role domain.Role) domain.User {
	t.Helper()

	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hashear password de test: %v", err)
	}
	ctx := context.Background()
	q := sqlcgen.New(e.pool)
	row, err := q.CreateUser(ctx, sqlcgen.CreateUserParams{
		Name:               name,
		Email:              domain.NormalizeEmail(email),
		PasswordHash:       hash,
		MustChangePassword: true,
		OrganizationID:     orgID,
	})
	if err != nil {
		t.Fatalf("crear usuario de test: %v", err)
	}

	// El rol vive en season_members: sin temporada nadie tiene rol. Es el
	// mismo arranque que hace `make seed`, que crea la primera temporada
	// junto con el admin.
	season, err := q.GetActiveSeason(ctx, orgID)
	if err != nil {
		season, err = q.CreateSeason(ctx, sqlcgen.CreateSeasonParams{Name: "Temporada 2026", OrganizationID: orgID, IsActive: true})
		if err != nil {
			t.Fatalf("crear temporada de test: %v", err)
		}
	}
	if _, err := q.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
		SeasonID: season.ID, UserID: row.ID, Role: string(role), OrganizationID: orgID,
	}); err != nil {
		t.Fatalf("sumar a la temporada de test: %v", err)
	}

	return domain.User{
		ID:                 row.ID,
		Name:               row.Name,
		OrganizationID:     orgID,
		Email:              row.Email,
		Role:               role,
		MustChangePassword: row.MustChangePassword,
	}
}

// client devuelve un cliente HTTP con cookie jar propio, es decir, una sesion
// de navegador independiente.
func (e *testEnv) client(t *testing.T) *testClient {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar: %v", err)
	}
	return &testClient{
		t:       t,
		baseURL: e.server.URL,
		http:    &http.Client{Jar: jar, Timeout: 10 * time.Second},
	}
}

type testClient struct {
	t       *testing.T
	baseURL string
	http    *http.Client
}

type apiResponse struct {
	Status int
	Body   map[string]any
}

// errorCode extrae error.code del cuerpo, o "" si la respuesta no es un error.
func (r apiResponse) errorCode() string {
	errObj, ok := r.Body["error"].(map[string]any)
	if !ok {
		return ""
	}
	code, _ := errObj["code"].(string)
	return code
}

func (r apiResponse) user() map[string]any {
	user, _ := r.Body["user"].(map[string]any)
	return user
}

func (c *testClient) do(method, path string, body any) apiResponse {
	c.t.Helper()

	var reader *bytes.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			c.t.Fatalf("serializar cuerpo: %v", err)
		}
		reader = bytes.NewReader(encoded)
	} else {
		reader = bytes.NewReader(nil)
	}

	req, err := http.NewRequest(method, c.baseURL+path, reader)
	if err != nil {
		c.t.Fatalf("armar request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()

	out := apiResponse{Status: resp.StatusCode}
	if resp.StatusCode != http.StatusNoContent {
		// Un cuerpo vacio o no-JSON deja Body en nil, que es lo que quieren
		// los asserts de status a secas.
		_ = json.NewDecoder(resp.Body).Decode(&out.Body)
	}
	return out
}

func (c *testClient) get(path string) apiResponse         { return c.do(http.MethodGet, path, nil) }
func (c *testClient) post(path string, b any) apiResponse { return c.do(http.MethodPost, path, b) }

// rawResponse: para los endpoints que no devuelven JSON (el CSV del export).
type rawResponse struct {
	Status int
	Text   string
}

func (c *testClient) getRaw(path string) rawResponse {
	c.t.Helper()
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		c.t.Fatalf("armar request: %v", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	cuerpo, err := io.ReadAll(resp.Body)
	if err != nil {
		c.t.Fatalf("leer cuerpo: %v", err)
	}
	return rawResponse{Status: resp.StatusCode, Text: string(cuerpo)}
}

func assertStatus(t *testing.T, got apiResponse, want int) {
	t.Helper()
	if got.Status != want {
		t.Fatalf("status = %d, se esperaba %d (cuerpo: %v)", got.Status, want, got.Body)
	}
}

func assertErrorCode(t *testing.T, got apiResponse, wantStatus int, wantCode string) {
	t.Helper()
	assertStatus(t, got, wantStatus)
	if code := got.errorCode(); code != wantCode {
		t.Fatalf("error.code = %q, se esperaba %q (cuerpo: %v)", code, wantCode, got.Body)
	}
}

func TestHealthIncluyeLaBase(t *testing.T) {
	env := newTestEnv(t)
	resp := env.client(t).get("/api/health")
	assertStatus(t, resp, http.StatusOK)
	if resp.Body["database"] != "ok" {
		t.Fatalf("health no reporta la base: %v", resp.Body)
	}
}

func TestRutasProtegidasSinSesionDan401(t *testing.T) {
	env := newTestEnv(t)
	client := env.client(t)

	for _, path := range []string{"/api/me", "/api/users"} {
		assertErrorCode(t, client.get(path), http.StatusUnauthorized, "unauthenticated")
	}
	assertErrorCode(t, client.post("/api/auth/logout", nil), http.StatusUnauthorized, "unauthenticated")
}

func TestLoginConCredencialesIncorrectas(t *testing.T) {
	env := newTestEnv(t)
	env.seedUser(t, "Eli", adminEmail, adminTempPass, domain.RoleAdmin)
	client := env.client(t)

	// Password equivocada y email inexistente dan exactamente el mismo error,
	// para no revelar que emails estan dados de alta.
	wrongPassword := client.post("/api/auth/login", map[string]string{"email": adminEmail, "password": "otra"})
	assertErrorCode(t, wrongPassword, http.StatusUnauthorized, "invalid_credentials")

	unknownEmail := client.post("/api/auth/login", map[string]string{"email": "nadie@acapelius.test", "password": adminTempPass})
	assertErrorCode(t, unknownEmail, http.StatusUnauthorized, "invalid_credentials")

	if wrongPassword.Body["error"].(map[string]any)["message"] != unknownEmail.Body["error"].(map[string]any)["message"] {
		t.Fatal("los mensajes de error tienen que ser identicos para no filtrar emails validos")
	}
}

func TestLoginEsCaseInsensitiveEnElEmail(t *testing.T) {
	env := newTestEnv(t)
	env.seedUser(t, "Eli", adminEmail, adminTempPass, domain.RoleAdmin)

	resp := env.client(t).post("/api/auth/login", map[string]string{
		"email":    "  ELI@Acapelius.TEST ",
		"password": adminTempPass,
	})
	assertStatus(t, resp, http.StatusOK)
}

func TestPrimerIngresoObligaACambiarPassword(t *testing.T) {
	env := newTestEnv(t)
	env.seedUser(t, "Eli", adminEmail, adminTempPass, domain.RoleAdmin)
	client := env.client(t)

	login := client.post("/api/auth/login", map[string]string{"email": adminEmail, "password": adminTempPass})
	assertStatus(t, login, http.StatusOK)
	if login.user()["must_change_password"] != true {
		t.Fatalf("el primer login tendria que pedir cambio de password: %v", login.Body)
	}

	// Con password provisoria, la API de negocio esta cerrada...
	assertErrorCode(t, client.get("/api/users"), http.StatusForbidden, "password_change_required")

	// ...pero /api/me sigue abierto, que es lo que necesita la pantalla de cambio.
	assertStatus(t, client.get("/api/me"), http.StatusOK)

	// La password nueva tiene que ser distinta y cumplir el minimo.
	assertErrorCode(t, client.post("/api/auth/change-password", map[string]string{
		"current_password": adminTempPass, "new_password": adminTempPass,
	}), http.StatusBadRequest, "validation_error")

	assertErrorCode(t, client.post("/api/auth/change-password", map[string]string{
		"current_password": adminTempPass, "new_password": "corta",
	}), http.StatusBadRequest, "validation_error")

	assertErrorCode(t, client.post("/api/auth/change-password", map[string]string{
		"current_password": "no-es-la-actual", "new_password": adminNewPassword,
	}), http.StatusUnauthorized, "invalid_credentials")

	changed := client.post("/api/auth/change-password", map[string]string{
		"current_password": adminTempPass, "new_password": adminNewPassword,
	})
	assertStatus(t, changed, http.StatusOK)
	if changed.user()["must_change_password"] != false {
		t.Fatalf("despues del cambio el flag tendria que estar en false: %v", changed.Body)
	}

	// Con la password cambiada, la API se abre y la sesion sigue viva.
	assertStatus(t, client.get("/api/users"), http.StatusOK)

	// La provisoria ya no sirve para entrar de nuevo.
	fresh := env.client(t)
	assertErrorCode(t, fresh.post("/api/auth/login", map[string]string{
		"email": adminEmail, "password": adminTempPass,
	}), http.StatusUnauthorized, "invalid_credentials")
	assertStatus(t, fresh.post("/api/auth/login", map[string]string{
		"email": adminEmail, "password": adminNewPassword,
	}), http.StatusOK)
}

func TestLogoutCierraLaSesion(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	assertStatus(t, admin.post("/api/auth/logout", nil), http.StatusNoContent)
	assertErrorCode(t, admin.get("/api/me"), http.StatusUnauthorized, "unauthenticated")
}

func TestSoloElAdminAdministraUsuarios(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	created := admin.post("/api/users", map[string]string{
		"name": "Carolina", "email": "caro@acapelius.test", "role": "seller",
	})
	assertStatus(t, created, http.StatusCreated)

	tempPassword, _ := created.Body["temp_password"].(string)
	if tempPassword == "" {
		t.Fatalf("el alta sin password tendria que devolver una provisoria: %v", created.Body)
	}
	if created.user()["must_change_password"] != true {
		t.Fatal("la vendedora nueva tendria que arrancar con cambio de password pendiente")
	}

	// El mismo email, aunque cambie el case, no se puede repetir.
	assertErrorCode(t, admin.post("/api/users", map[string]string{
		"name": "Otra", "email": "CARO@acapelius.test", "role": "seller",
	}), http.StatusConflict, "conflict")

	assertErrorCode(t, admin.post("/api/users", map[string]string{
		"name": "Sin rol", "email": "x@acapelius.test", "role": "cantante",
	}), http.StatusBadRequest, "validation_error")

	// La vendedora entra, cambia su password y no llega a /api/users.
	seller := env.client(t)
	assertStatus(t, seller.post("/api/auth/login", map[string]string{
		"email": "caro@acapelius.test", "password": tempPassword,
	}), http.StatusOK)
	assertStatus(t, seller.post("/api/auth/change-password", map[string]string{
		"current_password": tempPassword, "new_password": "vendo-entradas",
	}), http.StatusOK)

	assertErrorCode(t, seller.get("/api/users"), http.StatusForbidden, "forbidden")
	assertErrorCode(t, seller.post("/api/users", map[string]string{
		"name": "Yo Misma", "email": "otra@acapelius.test", "role": "admin",
	}), http.StatusForbidden, "forbidden")

	// El admin si las ve a las dos.
	list := admin.get("/api/users")
	assertStatus(t, list, http.StatusOK)
	users, _ := list.Body["members"].([]any)
	if len(users) != 2 {
		t.Fatalf("se esperaban 2 usuarios, hay %d: %v", len(users), list.Body)
	}
}

func TestApiDesconocidaDevuelveJSON(t *testing.T) {
	env := newTestEnv(t)
	assertErrorCode(t, env.client(t).get("/api/no-existe"), http.StatusNotFound, "not_found")
}

func TestCuerpoInvalidoEnLogin(t *testing.T) {
	env := newTestEnv(t)
	client := env.client(t)

	assertErrorCode(t, client.post("/api/auth/login", map[string]string{"email": "", "password": ""}),
		http.StatusBadRequest, "validation_error")

	// Campos desconocidos se rechazan: casi siempre son un typo del cliente.
	assertErrorCode(t, client.post("/api/auth/login", map[string]string{"mail": "x@y.com", "password": "z"}),
		http.StatusBadRequest, "bad_request")
}

// loginAdmin crea el admin, lo loguea y le deja la password ya cambiada, que es
// el estado normal desde el que arrancan casi todos los tests.
func loginAdmin(t *testing.T, env *testEnv) *testClient {
	t.Helper()

	env.seedUser(t, "Eli", adminEmail, adminTempPass, domain.RoleAdmin)
	client := env.client(t)

	assertStatus(t, client.post("/api/auth/login", map[string]string{
		"email": adminEmail, "password": adminTempPass,
	}), http.StatusOK)
	assertStatus(t, client.post("/api/auth/change-password", map[string]string{
		"current_password": adminTempPass, "new_password": adminNewPassword,
	}), http.StatusOK)

	return client
}
