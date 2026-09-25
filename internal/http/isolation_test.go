package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/ale-hts/acapelius/internal/domain"
)

// Aislamiento entre organizaciones (C17 §A.2). Dos grupos con datos
// parecidos; desde el A se pega a cada endpoint autenticado y se verifica que
// no ve, no modifica y no cuenta nada del B.
//
// Todo lo que es del B lleva la marca ORGB en el nombre (temporada, funcion,
// personas, comprador): cualquier respuesta del A que la contenga es una
// fuga, sin importar la forma del JSON. Los recursos pedidos por id
// responden 404 —no 403— para no confirmar que el id existe en otro lado.

const marcaB = "ORGB"

// orgFixture es lo que cada organizacion tiene cargado para el test.
type orgFixture struct {
	orgID    int64
	admin    *testClient
	seller   *testClient
	door     *testClient
	sellerID float64
	doorID   float64
	season   float64
	fn       float64
	sale     float64
	ticket   float64 // id del primer ticket
	code     string  // codigo del primer ticket
	code2    string  // codigo del segundo (sin ingresar)
	payment  float64 // id del cobro parcial
}

// loginAs abre sesion con la clave provisoria y la cambia, como el primer
// ingreso real.
func loginAs(t *testing.T, env *testEnv, email string) *testClient {
	t.Helper()
	c := env.client(t)
	assertStatus(t, c.post("/api/auth/login", map[string]string{"email": email, "password": adminTempPass}), http.StatusOK)
	assertStatus(t, c.post("/api/auth/change-password", map[string]string{
		"current_password": adminTempPass, "new_password": adminNewPassword,
	}), http.StatusOK)
	return c
}

// seedOrgFixture arma una organizacion completa: direccion, corista y puerta;
// una funcion con cupo; una venta de 2 con un cobro parcial; una rendicion; y
// un ingreso en la puerta.
func seedOrgFixture(t *testing.T, env *testEnv, orgID int64, prefix string) orgFixture {
	t.Helper()
	dominio := strings.ToLower(prefix) + ".test"
	env.seedUserIn(t, orgID, prefix+" Direccion", "admin@"+dominio, adminTempPass, domain.RoleAdmin)
	seller := env.seedUserIn(t, orgID, prefix+" Corista", "corista@"+dominio, adminTempPass, domain.RoleSeller)
	door := env.seedUserIn(t, orgID, prefix+" Puerta", "puerta@"+dominio, adminTempPass, domain.RoleDoor)

	f := orgFixture{
		orgID:    orgID,
		admin:    loginAs(t, env, "admin@"+dominio),
		seller:   loginAs(t, env, "corista@"+dominio),
		door:     loginAs(t, env, "puerta@"+dominio),
		sellerID: float64(seller.ID),
		doorID:   float64(door.ID),
	}
	f.season = activeSeasonID(t, f.admin)

	fn := f.admin.post("/api/functions", map[string]any{
		"season_id": f.season, "name": prefix + " Gala", "venue": prefix + " Sala",
		"starts_at": "2026-12-10T21:00:00-03:00", "capacity": 50, "price_cents": 100000,
	})
	assertStatus(t, fn, http.StatusCreated)
	f.fn = fn.Body["function"].(map[string]any)["id"].(float64)
	assignQuota(t, f.admin, f.fn, int(seller.ID), 10)

	venta := f.seller.post("/api/sales", map[string]any{
		"function_id": f.fn, "buyer_name": prefix + " Comprador", "buyer_email": "comprador@" + dominio, "quantity": 2,
	})
	assertStatus(t, venta, http.StatusCreated)
	f.sale = venta.Body["sale"].(map[string]any)["id"].(float64)
	tickets := venta.Body["tickets"].([]any)
	f.ticket = tickets[0].(map[string]any)["id"].(float64)
	f.code = tickets[0].(map[string]any)["code"].(string)
	f.code2 = tickets[1].(map[string]any)["code"].(string)

	cobro := f.seller.post(fmt.Sprintf("/api/sales/%.0f/payments", f.sale), map[string]any{"amount_cents": 50000, "method": "cash"})
	assertStatus(t, cobro, http.StatusOK)
	for _, raw := range cobro.Body["payments"].([]any) {
		f.payment = raw.(map[string]any)["id"].(float64)
	}

	assertStatus(t, f.admin.post("/api/settlements", map[string]any{
		"seller_id": seller.ID, "season_id": f.season, "amount_cents": 20000, "method": "cash",
	}), http.StatusCreated)

	ingreso := f.door.post("/api/checkins", map[string]any{
		"function_id": f.fn, "method": "scan", "payload": env.signer.Payload(f.code),
	})
	assertStatus(t, ingreso, http.StatusOK)
	if ingreso.Body["result"] != "ok" {
		t.Fatalf("el ingreso de armado tendria que ser ok: %v", ingreso.Body)
	}
	return f
}

// sinFuga: la respuesta llega entera (200) y no menciona nada del B.
func sinFuga(t *testing.T, ruta string, resp apiResponse) {
	t.Helper()
	assertStatus(t, resp, http.StatusOK)
	raw, _ := json.Marshal(resp.Body)
	if strings.Contains(string(raw), marcaB) {
		t.Fatalf("%s filtra datos de la otra organizacion: %s", ruta, raw)
	}
}

// noExiste: un recurso de la otra organizacion no existe (404, nunca 403).
func noExiste(t *testing.T, ruta string, resp apiResponse) {
	t.Helper()
	if resp.Status != http.StatusNotFound {
		t.Fatalf("%s: status = %d, se esperaba 404 (cuerpo: %v)", ruta, resp.Status, resp.Body)
	}
}

func TestAislamientoEntreOrganizaciones(t *testing.T) {
	env := newTestEnv(t)
	orgA := env.seedOrg(t, "Coro A", "coro-a")
	orgB := env.seedOrg(t, marcaB+" Elenco", "orgb")
	a := seedOrgFixture(t, env, orgA, "ORGA")
	b := seedOrgFixture(t, env, orgB, marcaB)
	// Una segunda temporada en B, con nombre marcado, para el indice.
	assertStatus(t, b.admin.post("/api/seasons", map[string]any{"name": marcaB + " 2027", "activate": false}), http.StatusCreated)

	id := func(f float64) string { return fmt.Sprintf("%.0f", f) }
	sB, fnB, saleB := id(b.season), id(b.fn), id(b.sale)

	t.Run("listados", func(t *testing.T) {
		for _, ruta := range []string{
			"/api/seasons",
			"/api/functions",
			"/api/sales",
			fmt.Sprintf("/api/sales?season_id=%.0f&q=%s", a.season, marcaB),
			"/api/users",
			fmt.Sprintf("/api/settlements?season_id=%.0f", a.season),
			fmt.Sprintf("/api/settlements?season_id=%.0f&seller_id=%s", a.season, id(b.sellerID)),
			fmt.Sprintf("/api/reports/settlements?season_id=%.0f", a.season),
			"/api/reports/sellers",
			"/api/reports/seasons",
			fmt.Sprintf("/api/reports/functions-summary?season_id=%.0f", a.season),
			fmt.Sprintf("/api/reports/attention?season_id=%.0f", a.season),
			fmt.Sprintf("/api/reports/sales-timeline?season_id=%.0f", a.season),
			fmt.Sprintf("/api/reports/direccion?season_id=%.0f", a.season),
			"/api/me",
		} {
			sinFuga(t, ruta, a.admin.get(ruta))
		}
		// Filtrar por una temporada o funcion del B es pedir un recurso ajeno:
		// no existe.
		for _, ruta := range []string{
			"/api/functions?season_id=" + sB,
			"/api/sales?season_id=" + sB,
			fmt.Sprintf("/api/sales?season_id=%.0f&function_id=%s", a.season, fnB),
			"/api/settlements?season_id=" + sB,
			"/api/reports/settlements?season_id=" + sB,
			"/api/reports/sellers?season_id=" + sB,
			"/api/reports/sellers?function_id=" + fnB,
			"/api/reports/functions-summary?season_id=" + sB,
			"/api/reports/attention?season_id=" + sB,
			"/api/reports/sales-timeline?season_id=" + sB,
			"/api/reports/direccion?season_id=" + sB,
		} {
			noExiste(t, ruta, a.admin.get(ruta))
		}
		sinFuga(t, "/api/me/allocations", a.seller.get("/api/me/allocations"))
		sinFuga(t, "/api/me/allocations?function_id="+fnB, a.seller.get("/api/me/allocations?function_id="+fnB))

		// Sin filtro, el listado del A tiene exactamente lo suyo.
		ventas := a.admin.get("/api/sales")
		if n := len(ventas.Body["sales"].([]any)); n != 1 {
			t.Fatalf("A tendria que ver 1 venta, ve %d", n)
		}
		temporadas := a.admin.get("/api/seasons")
		if n := len(temporadas.Body["seasons"].([]any)); n != 1 {
			t.Fatalf("A tendria que ver 1 temporada, ve %d", n)
		}
		equipo := a.admin.get("/api/users")
		if n := len(equipo.Body["members"].([]any)); n != 3 {
			t.Fatalf("A tendria que ver 3 personas, ve %d", n)
		}

		csv := a.admin.getRaw("/api/sales/export")
		if csv.Status != http.StatusOK || strings.Contains(csv.Text, marcaB) {
			t.Fatalf("el export filtra: status %d, %q", csv.Status, csv.Text)
		}
	})

	t.Run("agregados", func(t *testing.T) {
		for _, c := range []*testClient{a.admin, a.seller, a.door} {
			sinFuga(t, "/api/home", c.get("/api/home"))
		}
		// La home de direccion cuenta una sola venta con saldo: la del A.
		home := a.admin.get("/api/home")
		badges, _ := home.Body["badges"].(map[string]any)
		if p, _ := badges["sales_pending"].(float64); p != 1 {
			t.Fatalf("home.badges.sales_pending = %v, se esperaba 1 (cuerpo: %v)", badges["sales_pending"], home.Body)
		}
		noExiste(t, "/api/home?season_id=B", a.admin.get("/api/home?season_id="+sB))
		noExiste(t, "/api/users?season_id=B", a.admin.get("/api/users?season_id="+sB))
		noExiste(t, "/api/reports/direccion?season_id=B", a.admin.get("/api/reports/direccion?season_id="+sB))
		noExiste(t, "/api/reports/attendance?function_id=B", a.admin.get("/api/reports/attendance?function_id="+fnB))
		noExiste(t, "/api/settlements/{B}/detail", a.admin.get(fmt.Sprintf("/api/settlements/%s/detail?season_id=%.0f", id(b.sellerID), a.season)))
		noExiste(t, "/api/settlements/{B}/detail?season_id=B", a.admin.get("/api/settlements/"+id(a.sellerID)+"/detail?season_id="+sB))
		noExiste(t, "/api/functions/{B}/door-snapshot", a.door.get("/api/functions/"+fnB+"/door-snapshot"))
		noExiste(t, "/api/functions/{B}/allocations", a.admin.get("/api/functions/"+fnB+"/allocations"))
	})

	t.Run("acciones por id dan 404", func(t *testing.T) {
		del := func(c *testClient, ruta string) apiResponse { return c.do(http.MethodDelete, ruta, nil) }
		patch := func(c *testClient, ruta string, body any) apiResponse { return c.do(http.MethodPatch, ruta, body) }
		put := func(c *testClient, ruta string, body any) apiResponse { return c.do(http.MethodPut, ruta, body) }

		// Ventas y entradas.
		noExiste(t, "PATCH /sales/{B}", patch(a.admin, "/api/sales/"+saleB, map[string]any{"payment_status": "paid", "payment_method": "cash"}))
		noExiste(t, "POST /sales/{B}/resend-email", a.admin.post("/api/sales/"+saleB+"/resend-email", nil))
		noExiste(t, "GET /sales/{B}/payments", a.admin.get("/api/sales/"+saleB+"/payments"))
		noExiste(t, "POST /sales/{B}/payments", a.admin.post("/api/sales/"+saleB+"/payments", map[string]any{"amount_cents": 1000, "method": "cash"}))
		noExiste(t, "DELETE /sales/{B}/payments/{B}", del(a.admin, fmt.Sprintf("/api/sales/%s/payments/%.0f", saleB, b.payment)))
		noExiste(t, "DELETE /sales/{A}/payments/{B}", del(a.admin, fmt.Sprintf("/api/sales/%.0f/payments/%.0f", a.sale, b.payment)))
		noExiste(t, "POST /sales/{B}/void", a.admin.post("/api/sales/"+saleB+"/void", nil))
		noExiste(t, "POST /tickets/{B}/void", a.admin.post(fmt.Sprintf("/api/tickets/%.0f/void", b.ticket), nil))
		noExiste(t, "POST /sales con funcion B", a.seller.post("/api/sales", map[string]any{
			"function_id": b.fn, "buyer_name": "Colado", "quantity": 1,
		}))

		// Personas y participacion.
		noExiste(t, "PATCH /users/{B}", patch(a.admin, "/api/users/"+id(b.sellerID), map[string]any{
			"name": "Cambiada", "email": "corista@orgb.test", "role": "seller", "is_active": true,
		}))
		noExiste(t, "POST /users/{B}/resend-invite", a.admin.post("/api/users/"+id(b.doorID)+"/resend-invite", nil))
		noExiste(t, "POST /users/{B}/reset-password", a.admin.post("/api/users/"+id(b.sellerID)+"/reset-password", nil))
		noExiste(t, "POST /seasons/{B}/members", a.admin.post("/api/seasons/"+sB+"/members", map[string]any{"user_id": a.sellerID, "role": "seller"}))
		noExiste(t, "POST /seasons/{A}/members con persona B", a.admin.post(fmt.Sprintf("/api/seasons/%.0f/members", a.season), map[string]any{"user_id": b.sellerID, "role": "seller"}))
		noExiste(t, "DELETE /seasons/{B}/members/{B}", del(a.admin, "/api/seasons/"+sB+"/members/"+id(b.sellerID)))
		noExiste(t, "DELETE /seasons/{A}/members/{B}", del(a.admin, fmt.Sprintf("/api/seasons/%.0f/members/%s", a.season, id(b.sellerID))))

		// Temporadas y funciones.
		noExiste(t, "POST /seasons/{B}/activate", a.admin.post("/api/seasons/"+sB+"/activate", nil))
		noExiste(t, "POST /seasons copiando la B", a.admin.post("/api/seasons", map[string]any{"name": "Copia", "copy_from_season_id": b.season}))
		noExiste(t, "POST /functions en temporada B", a.admin.post("/api/functions", map[string]any{
			"season_id": b.season, "venue": "Colada", "starts_at": "2026-12-11T21:00:00-03:00", "capacity": 10, "price_cents": 100,
		}))
		noExiste(t, "PATCH /functions/{B}", patch(a.admin, "/api/functions/"+fnB, map[string]any{"venue": "Cambiada"}))
		noExiste(t, "DELETE /functions/{B}", del(a.admin, "/api/functions/"+fnB))
		noExiste(t, "PUT /functions/{B}/allocations", put(a.admin, "/api/functions/"+fnB+"/allocations",
			map[string]any{"allocations": []map[string]any{{"user_id": a.sellerID, "quantity": 1}}}))
		noExiste(t, "PUT /functions/{A}/allocations con corista B", put(a.admin, fmt.Sprintf("/api/functions/%.0f/allocations", a.fn),
			map[string]any{"allocations": []map[string]any{{"user_id": b.sellerID, "quantity": 1}}}))

		// Rendiciones.
		noExiste(t, "POST /settlements en temporada B", a.admin.post("/api/settlements", map[string]any{
			"seller_id": a.sellerID, "season_id": b.season, "amount_cents": 100, "method": "cash",
		}))
		noExiste(t, "POST /settlements a corista B", a.admin.post("/api/settlements", map[string]any{
			"seller_id": b.sellerID, "season_id": a.season, "amount_cents": 100, "method": "cash",
		}))
		noExiste(t, "POST /settlements/{B}/remind", a.admin.post(fmt.Sprintf("/api/settlements/%s/remind?season_id=%.0f", id(b.sellerID), a.season), nil))
		noExiste(t, "POST /settlements/{A}/remind?season_id=B", a.admin.post(fmt.Sprintf("/api/settlements/%s/remind?season_id=%s", id(a.sellerID), sB), nil))
		noExiste(t, "POST /settlements/remind-all?season_id=B", a.admin.post("/api/settlements/remind-all?season_id="+sB, nil))
	})

	t.Run("puerta", func(t *testing.T) {
		// Una entrada del B escaneada en la puerta del A no existe, aunque el
		// QR sea valido.
		scan := a.door.post("/api/checkins", map[string]any{"function_id": a.fn, "method": "scan", "payload": env.signer.Payload(b.code2)})
		assertStatus(t, scan, http.StatusOK)
		if scan.Body["result"] != "invalid" {
			t.Fatalf("una entrada ajena tendria que ser invalid, fue %v", scan.Body)
		}
		manual := a.door.post("/api/checkins", map[string]any{"function_id": a.fn, "method": "manual", "code": b.code2})
		assertStatus(t, manual, http.StatusOK)
		if manual.Body["result"] != "invalid" {
			t.Fatalf("un codigo ajeno tendria que ser invalid, fue %v", manual.Body)
		}
		noExiste(t, "POST /checkins en funcion B", a.door.post("/api/checkins", map[string]any{"function_id": b.fn, "method": "manual", "code": b.code2}))
		noExiste(t, "POST /checkins/sync en funcion B", a.door.post("/api/checkins/sync", map[string]any{
			"function_id": b.fn, "device_id": "celu-A",
			"checkins": []map[string]any{{"method": "manual", "code": b.code2, "at": "2026-12-10T21:30:00-03:00"}},
		}))
		sync := a.door.post("/api/checkins/sync", map[string]any{
			"function_id": a.fn, "device_id": "celu-A",
			"checkins": []map[string]any{{"method": "manual", "code": b.code2, "at": "2026-12-10T21:30:00-03:00"}},
		})
		assertStatus(t, sync, http.StatusOK)
		if r := sync.Body["results"].([]any)[0].(map[string]any); r["result"] != "invalid" {
			t.Fatalf("sync con codigo ajeno tendria que ser invalid: %v", r)
		}
	})

	t.Run("acciones masivas con ids ajenos", func(t *testing.T) {
		mezcla := []float64{a.sale, b.sale}
		noExiste(t, "POST /sales/bulk-payment", a.admin.post("/api/sales/bulk-payment", map[string]any{"sale_ids": mezcla, "method": "cash"}))
		noExiste(t, "POST /sales/bulk-resend", a.admin.post("/api/sales/bulk-resend", map[string]any{"sale_ids": mezcla}))
		noExiste(t, "POST /sales/bulk-payment solo B", a.admin.post("/api/sales/bulk-payment", map[string]any{"sale_ids": []float64{b.sale}, "method": "cash"}))

		// Y la mezcla no toco la venta propia: sigue con el cobro parcial.
		propia := a.admin.get("/api/sales/" + id(a.sale) + "/payments")
		assertStatus(t, propia, http.StatusOK)
		if st := propia.Body["sale"].(map[string]any)["payment_status"]; st != "pending" {
			t.Fatalf("la venta del A tendria que seguir pendiente, esta %v", st)
		}
	})

	t.Run("la organizacion B quedo intacta", func(t *testing.T) {
		pagos := b.admin.get("/api/sales/" + saleB + "/payments")
		assertStatus(t, pagos, http.StatusOK)
		venta := pagos.Body["sale"].(map[string]any)
		if venta["payment_status"] != "pending" || venta["voided_at"] != nil {
			t.Fatalf("la venta del B cambio: %v", venta)
		}
		if n := len(pagos.Body["payments"].([]any)); n != 1 {
			t.Fatalf("el B tendria que tener 1 cobro, tiene %d", n)
		}
		funciones := b.admin.get("/api/functions")
		assertStatus(t, funciones, http.StatusOK)
		fns := funciones.Body["functions"].([]any)
		if len(fns) != 1 {
			t.Fatalf("el B tendria que tener 1 funcion, tiene %d", len(fns))
		}
		fn := fns[0].(map[string]any)
		if fn["venue"] != marcaB+" Sala" || fn["entered"].(float64) != 1 || fn["assigned"].(float64) != 10 {
			t.Fatalf("la funcion del B cambio: %v", fn)
		}
		temporadas := b.admin.get("/api/seasons")
		for _, raw := range temporadas.Body["seasons"].([]any) {
			s := raw.(map[string]any)
			if s["id"].(float64) == b.season && s["is_active"] != true {
				t.Fatalf("la temporada en curso del B se apago: %v", s)
			}
		}
		equipo := b.admin.get("/api/users")
		assertStatus(t, equipo, http.StatusOK)
		if n := len(equipo.Body["members"].([]any)); n != 3 {
			t.Fatalf("el equipo del B cambio: %d personas", n)
		}
		// Y el B tampoco ve nada del A.
		raw, _ := json.Marshal(b.admin.get("/api/sales").Body)
		if strings.Contains(string(raw), "ORGA") {
			t.Fatalf("el B ve ventas del A: %s", raw)
		}
	})

	t.Run("crear una temporada en A no apaga la del B", func(t *testing.T) {
		assertStatus(t, a.admin.post("/api/seasons", map[string]any{"name": "A 2027"}), http.StatusCreated)
		enCurso := activeSeasonID(t, b.admin)
		if enCurso != b.season {
			t.Fatalf("la temporada en curso del B cambio a %.0f", enCurso)
		}
	})
}

// TestMismoEmailEnDosOrganizaciones: el email es unico por organizacion, no
// global (C17 §A.1). La misma persona entra a cada grupo con su contraseña.
func TestMismoEmailEnDosOrganizaciones(t *testing.T) {
	env := newTestEnv(t)
	orgA := env.seedOrg(t, "Coro A", "coro-a")
	orgB := env.seedOrg(t, "Elenco B", "elenco-b")
	env.seedUserIn(t, orgA, "Ana en A", "ana@dos.test", "clave-del-coro-1", domain.RoleAdmin)
	env.seedUserIn(t, orgB, "Ana en B", "ana@dos.test", "clave-del-elenco-2", domain.RoleSeller)

	enA := env.client(t)
	assertStatus(t, enA.post("/api/auth/login", map[string]string{"email": "ana@dos.test", "password": "clave-del-coro-1"}), http.StatusOK)
	me := enA.get("/api/me")
	if u := me.user(); u["name"] != "Ana en A" || u["organization_id"].(float64) != float64(orgA) || u["role"] != "admin" {
		t.Fatalf("con la clave del coro tendria que entrar al coro: %v", u)
	}

	enB := env.client(t)
	assertStatus(t, enB.post("/api/auth/login", map[string]string{"email": "ana@dos.test", "password": "clave-del-elenco-2"}), http.StatusOK)
	me = enB.get("/api/me")
	if u := me.user(); u["name"] != "Ana en B" || u["organization_id"].(float64) != float64(orgB) || u["role"] != "seller" {
		t.Fatalf("con la clave del elenco tendria que entrar al elenco: %v", u)
	}

	otra := env.client(t)
	assertStatus(t, otra.post("/api/auth/login", map[string]string{"email": "ana@dos.test", "password": "ninguna-de-las-dos"}), http.StatusUnauthorized)

	// Dar de alta el mismo email en la misma organizacion sigue chocando.
	assertStatus(t, enA.post("/api/auth/change-password", map[string]string{"current_password": "clave-del-coro-1", "new_password": adminNewPassword}), http.StatusOK)
	assertStatus(t, enA.post("/api/users", map[string]string{"name": "Ana otra vez", "email": "ANA@dos.test", "role": "door"}), http.StatusConflict)
}
