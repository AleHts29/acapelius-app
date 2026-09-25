package httpapi_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ale-hts/acapelius/internal/demo"
	"github.com/ale-hts/acapelius/internal/domain"
)

// La demo (C17 §C): una organizacion mas, sembrada, con sesion de invitado,
// sin mails y reiniciable.
func TestDemoSembradaYReiniciable(t *testing.T) {
	env := newTestEnv(t)
	loc := time.Local
	orgID, err := demo.Reset(t.Context(), env.pool, loc)
	if err != nil {
		t.Fatalf("sembrar la demo: %v", err)
	}

	cuenta := func(sql string) int {
		var n int
		if err := env.pool.QueryRow(t.Context(), sql, orgID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	personas := cuenta("SELECT count(*) FROM users WHERE organization_id = $1")
	funciones := cuenta("SELECT count(*) FROM functions f JOIN seasons s ON s.id = f.season_id WHERE s.organization_id = $1")
	ventas := cuenta("SELECT count(*) FROM sales sa JOIN functions f ON f.id = sa.function_id JOIN seasons s ON s.id = f.season_id WHERE s.organization_id = $1")
	ingresos := cuenta("SELECT count(*) FROM checkins c JOIN tickets t ON t.id = c.ticket_id JOIN sales sa ON sa.id = t.sale_id JOIN functions f ON f.id = sa.function_id JOIN seasons s ON s.id = f.season_id WHERE s.organization_id = $1")
	rendiciones := cuenta("SELECT count(*) FROM settlements st JOIN seasons s ON s.id = st.season_id WHERE s.organization_id = $1")
	if personas != 12 || funciones != 4 || ventas < 45 || ingresos < 40 || rendiciones < 5 {
		t.Fatalf("la demo quedo rara: %d personas, %d funciones, %d ventas, %d ingresos, %d rendiciones", personas, funciones, ventas, ingresos, rendiciones)
	}
	// Los cuatro estados de pago, cortesias y una anulada.
	estados := cuenta(`SELECT count(DISTINCT CASE WHEN sa.is_comp THEN 'comp' WHEN sa.voided_at IS NOT NULL THEN 'void'
		WHEN sa.paid_cents = 0 THEN 'pending' WHEN sa.paid_cents < sa.amount_cents THEN 'partial' ELSE 'paid' END)
		FROM sales sa JOIN functions f ON f.id = sa.function_id JOIN seasons s ON s.id = f.season_id WHERE s.organization_id = $1`)
	if estados != 5 {
		t.Fatalf("faltan estados de pago en la demo: %d de 5", estados)
	}

	// EnsureSeeded no la pisa; Reset si, y deja lo mismo con el mismo id.
	if err := demo.EnsureSeeded(t.Context(), env.pool, loc); err != nil {
		t.Fatal(err)
	}
	if _, err := env.pool.Exec(t.Context(), "UPDATE organizations SET name = 'Tocada' WHERE id = $1", orgID); err != nil {
		t.Fatal(err)
	}
	otra, err := demo.Reset(t.Context(), env.pool, loc)
	if err != nil {
		t.Fatalf("reiniciar la demo: %v", err)
	}
	if otra != orgID {
		t.Fatalf("el reinicio cambio el id de la organizacion: %d → %d", orgID, otra)
	}
	if cuenta("SELECT count(*) FROM users WHERE organization_id = $1") != 12 || cuenta("SELECT count(*) FROM organizations WHERE id = $1") != 1 {
		t.Fatal("el reinicio no dejo la demo como estaba")
	}
	if cuenta("SELECT count(*) FROM organizations WHERE is_demo AND id = id + 0 * $1") != 1 {
		t.Fatal("tendria que haber exactamente una organizacion demo")
	}
}

func TestSesionDeInvitadoEnLaDemo(t *testing.T) {
	env := newTestEnv(t)
	// Un coro real al lado, para verificar que la demo no lo toca ni lo ve.
	env.seedUser(t, "Eli", adminEmail, adminTempPass, domain.RoleAdmin)
	if _, err := demo.Reset(t.Context(), env.pool, time.Local); err != nil {
		t.Fatal(err)
	}

	c := env.client(t)
	sesion := c.post("/api/demo/session", nil)
	assertStatus(t, sesion, http.StatusCreated)
	u := sesion.user()
	if u["role"] != "admin" || u["organization_is_demo"] != true || u["must_change_password"] != false {
		t.Fatalf("la sesion de invitado no es direccion de la demo: %v", u)
	}

	// Ve la demo entera y nada del coro real.
	home := c.get("/api/home")
	assertStatus(t, home, http.StatusOK)
	equipo := c.get("/api/users")
	assertStatus(t, equipo, http.StatusOK)
	if n := len(equipo.Body["members"].([]any)); n != 12 {
		t.Fatalf("la demo tendria que tener 12 personas, ve %d", n)
	}
	for _, raw := range equipo.Body["members"].([]any) {
		if raw.(map[string]any)["email"] == adminEmail {
			t.Fatal("la demo ve al admin del coro real")
		}
	}

	// Escritura habilitada: marca un pago y registra una rendicion.
	ventas := c.get("/api/sales?status=pending")
	assertStatus(t, ventas, http.StatusOK)
	lista := ventas.Body["sales"].([]any)
	if len(lista) == 0 {
		t.Fatal("la demo tendria que tener ventas pendientes")
	}
	venta := lista[0].(map[string]any)
	saleID := venta["id"].(float64)
	pago := c.post(fmt.Sprintf("/api/sales/%.0f/payments", saleID), map[string]any{
		"amount_cents": venta["amount_cents"], "method": "cash",
	})
	assertStatus(t, pago, http.StatusOK)
	if pago.Body["sale"].(map[string]any)["payment_status"] != "paid" {
		t.Fatalf("el pago no quedo: %v", pago.Body)
	}
	season := activeSeasonID(t, c)
	assertStatus(t, c.post("/api/settlements", map[string]any{
		"seller_id": venta["seller_id"], "season_id": season, "amount_cents": 100000, "method": "cash",
	}), http.StatusCreated)

	// Ningun mail sale: reenviar una entrada y recordar una rendicion quedan
	// como preview, y el driver de mail no registra nada.
	antes := env.emailLog.String()
	conEmail := c.get("/api/sales?status=paid")
	var ventaConMail map[string]any
	for _, raw := range conEmail.Body["sales"].([]any) {
		if s := raw.(map[string]any); s["buyer_email"] != nil {
			ventaConMail = s
			break
		}
	}
	if ventaConMail == nil {
		t.Fatal("la demo tendria que tener ventas con email")
	}
	reenvio := c.post(fmt.Sprintf("/api/sales/%.0f/resend-email", ventaConMail["id"].(float64)), nil)
	assertStatus(t, reenvio, http.StatusOK)
	if reenvio.Body["email_status"] != "preview" {
		t.Fatalf("en la demo el reenvio tendria que ser preview: %v", reenvio.Body)
	}
	recordar := c.post(fmt.Sprintf("/api/settlements/%.0f/remind?season_id=%.0f", venta["seller_id"].(float64), season), nil)
	assertStatus(t, recordar, http.StatusOK)
	if recordar.Body["email_status"] != "preview" {
		t.Fatalf("en la demo el recordatorio tendria que ser preview: %v", recordar.Body)
	}
	alta := c.post("/api/users", map[string]string{"name": "Nueva", "email": "nueva@demo.acapelius.local", "role": "seller"})
	assertStatus(t, alta, http.StatusCreated)
	if alta.Body["email_status"] != "preview" {
		t.Fatalf("en la demo la invitacion tendria que ser preview: %v", alta.Body)
	}
	nueva := c.post("/api/sales", map[string]any{
		"function_id": funcionEnVenta(t, c), "buyer_name": "Con Mail", "buyer_email": "con.mail@demo.acapelius.local", "quantity": 1, "is_comp": true,
	})
	assertStatus(t, nueva, http.StatusCreated)
	if nueva.Body["email_status"] != "preview" {
		t.Fatalf("en la demo la venta tendria que ser preview: %v", nueva.Body)
	}
	if despues := env.emailLog.String(); despues != antes {
		t.Fatalf("la demo mando un mail:\n%s", strings.TrimPrefix(despues, antes))
	}

	// Lo bloqueado en la demo.
	assertStatus(t, c.post("/api/auth/change-password", map[string]string{
		"current_password": "acapelius-demo", "new_password": "otra-clave-larga",
	}), http.StatusForbidden)

	// El coro real sigue como estaba: la demo no lo toco.
	var n int
	_ = env.pool.QueryRow(t.Context(), "SELECT count(*) FROM users WHERE email = $1", adminEmail).Scan(&n)
	if n != 1 {
		t.Fatal("el reinicio de la demo toco al coro real")
	}
	// Y el reinicio deshace lo que el invitado toco.
	if _, err := demo.Reset(t.Context(), env.pool, time.Local); err != nil {
		t.Fatal(err)
	}
	_ = env.pool.QueryRow(t.Context(), "SELECT count(*) FROM users WHERE email = 'nueva@demo.acapelius.local'").Scan(&n)
	if n != 0 {
		t.Fatal("el reinicio no borro lo que agrego el invitado")
	}
}

// funcionEnVenta: la funcion futura de la demo.
func funcionEnVenta(t *testing.T, c *testClient) float64 {
	t.Helper()
	resp := c.get("/api/functions")
	assertStatus(t, resp, http.StatusOK)
	fns := resp.Body["functions"].([]any)
	return fns[len(fns)-1].(map[string]any)["id"].(float64)
}
