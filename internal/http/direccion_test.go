package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// alertsByKind indexa la respuesta de /api/reports/attention por tipo.
func alertsByKind(t *testing.T, body map[string]any) map[string]map[string]any {
	t.Helper()
	out := map[string]map[string]any{}
	for _, raw := range body["alerts"].([]any) {
		alert := raw.(map[string]any)
		out[alert["kind"].(string)] = alert
	}
	return out
}

// TestPanelDeDireccion cubre la aceptacion de C9: las tres alertas del mockup
// con sus datos, la desaparicion de la rendicion al saldarla, el resumen por
// funcion y el ritmo de ventas con los dias vacios completados.
func TestPanelDeDireccion(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 80)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 20)

	// Carolina vende 5 entradas y las cobra: queda con saldo a rendir.
	sale := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria Dutra", "quantity": 5,
	})
	assertStatus(t, sale, http.StatusCreated)
	markPaid(t, carolina, sale.Body["sale"].(map[string]any)["id"].(float64), "cash")

	// Josefina entra al equipo y nunca abre la app.
	josefina := admin.post("/api/users", map[string]string{
		"name": "Josefina", "email": "jose@acapelius.test", "role": "seller",
	})
	assertStatus(t, josefina, http.StatusCreated)

	// --- Necesita tu atencion: las tres alertas ------------------------------
	attention := admin.get("/api/reports/attention?season_id=1")
	assertStatus(t, attention, http.StatusOK)
	alerts := attention.Body["alerts"].([]any)
	if len(alerts) != 3 {
		t.Fatalf("se esperaban 3 alertas: %v", attention.Body)
	}
	// La plata primero, despues los cupos, por ultimo las invitaciones.
	kinds := []string{"settlement", "allocation", "invite"}
	for i, want := range kinds {
		if got := alerts[i].(map[string]any)["kind"]; got != want {
			t.Fatalf("alerta %d: se esperaba %q y vino %q", i, want, got)
		}
	}

	byKind := alertsByKind(t, attention.Body)
	if byKind["settlement"]["name"] != "Carolina" ||
		byKind["settlement"]["amount_cents"].(float64) != 4000000 {
		t.Fatalf("la deuda de Carolina son $40.000: %v", byKind["settlement"])
	}
	if byKind["settlement"]["since"] == nil {
		t.Fatalf("la alerta de rendicion trae la referencia temporal del cobro")
	}
	// 80 de cupo, 20 asignadas: faltan repartir 60.
	if byKind["allocation"]["missing"].(float64) != 60 ||
		byKind["allocation"]["capacity"].(float64) != 80 {
		t.Fatalf("faltan asignar 60 de 80: %v", byKind["allocation"])
	}
	if byKind["invite"]["name"] != "Josefina" {
		t.Fatalf("la invitacion pendiente es la de Josefina: %v", byKind["invite"])
	}

	// --- Al saldar la rendicion, esa alerta se va ----------------------------
	assertStatus(t, admin.post("/api/settlements", map[string]any{
		"seller_id": 2, "season_id": 1, "amount_cents": 4000000, "method": "cash",
	}), http.StatusCreated)

	after := admin.get("/api/reports/attention?season_id=1")
	assertStatus(t, after, http.StatusOK)
	if len(after.Body["alerts"].([]any)) != 2 {
		t.Fatalf("saldada la deuda quedan 2 alertas: %v", after.Body)
	}
	if _, still := alertsByKind(t, after.Body)["settlement"]; still {
		t.Fatalf("la alerta de rendicion tendria que haber desaparecido")
	}

	// --- La temporada, funcion por funcion -----------------------------------
	summary := admin.get("/api/reports/functions-summary?season_id=1")
	assertStatus(t, summary, http.StatusOK)
	functions := summary.Body["functions"].([]any)
	if len(functions) != 1 {
		t.Fatalf("la temporada tiene 1 funcion: %d", len(functions))
	}
	fn := functions[0].(map[string]any)
	if fn["sold"].(float64) != 5 || fn["capacity"].(float64) != 80 ||
		fn["collected_cents"].(float64) != 4000000 || fn["assigned"].(float64) != 20 ||
		fn["entered"].(float64) != 0 {
		t.Fatalf("resumen de la funcion mal calculado: %v", fn)
	}

	// --- Ritmo de ventas ------------------------------------------------------
	timeline := admin.get("/api/reports/sales-timeline?season_id=1&days=14")
	assertStatus(t, timeline, http.StatusOK)
	days := timeline.Body["days"].([]any)
	if len(days) != 14 {
		t.Fatalf("la ventana son 14 dias, con los vacios en cero: %d", len(days))
	}
	if timeline.Body["total"].(float64) != 5 {
		t.Fatalf("se vendieron 5 entradas en la ventana: %v", timeline.Body["total"])
	}
	// Las ventas son de hoy: el ultimo dia de la serie las tiene todas.
	last := days[13].(map[string]any)
	if last["tickets"].(float64) != 5 {
		t.Fatalf("las 5 entradas caen en el ultimo dia: %v", last)
	}
	if last["day"] != time.Now().Format("2006-01-02") {
		t.Fatalf("el ultimo dia de la serie es hoy: %v", last["day"])
	}
	// Vendio esta semana y nada la anterior: el delta es positivo.
	if timeline.Body["delta"].(float64) != 5 {
		t.Fatalf("delta semanal: %v", timeline.Body["delta"])
	}

	// Validaciones y permisos.
	assertErrorCode(t, admin.get("/api/reports/attention"), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, admin.get("/api/reports/sales-timeline?season_id=1&days=999"),
		http.StatusBadRequest, "bad_request")
	assertErrorCode(t, carolina.get("/api/reports/attention?season_id=1"), http.StatusForbidden, "forbidden")
	assertErrorCode(t, carolina.get(fmt.Sprintf("/api/reports/functions-summary?season_id=%d", 1)),
		http.StatusForbidden, "forbidden")
}

// TestPanelSinPendientes: sin deudas, sin cupos sin repartir y sin
// invitaciones sin usar, la lista viene vacia ("todo en orden" en la UI).
func TestPanelSinPendientes(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 20)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	// Todo el cupo repartido y Carolina ya entro (createSellerClient loguea).
	assignQuota(t, admin, fnID, 2, 20)

	// Una venta sin cobrar no genera deuda de rendicion: todavia no hay plata.
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria Dutra", "quantity": 2,
	}), http.StatusCreated)

	attention := admin.get("/api/reports/attention?season_id=1")
	assertStatus(t, attention, http.StatusOK)
	if len(attention.Body["alerts"].([]any)) != 0 {
		t.Fatalf("no tendria que haber nada pendiente: %v", attention.Body)
	}
}

// TestDireccionMinimalista: la vista muestra conclusiones, no tablas. Lo que
// se chequea acá es que las conclusiones sean ciertas: que la plata cierre en
// tres pedazos y que un hallazgo aparezca sólo cuando hay algo que decir.
func TestDireccionMinimalista(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 20)
	corista := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test") // user 2

	path := fmt.Sprintf("/api/functions/%.0f/allocations", fnID)
	assertStatus(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 8}},
	}), http.StatusOK)

	// Dos ventas: una cobrada entera y otra sin cobrar.
	cobrada := corista.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Pagó todo", "quantity": 2,
	})
	assertStatus(t, cobrada, http.StatusCreated)
	saleID := cobrada.Body["sale"].(map[string]any)["id"].(float64)
	assertStatus(t, corista.do(http.MethodPatch, fmt.Sprintf("/api/sales/%.0f", saleID),
		map[string]any{"payment_status": "paid", "payment_method": "cash"}), http.StatusOK)
	assertStatus(t, corista.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Debe", "quantity": 1,
	}), http.StatusCreated)

	resp := admin.get("/api/reports/direccion?season_id=1")
	assertStatus(t, resp, http.StatusOK)
	money := resp.Body["money"].(map[string]any)

	// Lo vendido se parte en tres y no sobra ni falta un peso.
	suma := money["in_hand_cents"].(float64) + money["unsettled_cents"].(float64) + money["uncollected_cents"].(float64)
	if suma != money["sold_cents"].(float64) {
		t.Fatalf("los tres pedazos suman %v y lo vendido es %v", suma, money["sold_cents"])
	}
	// Todavia no rindio nada: lo cobrado esta entero en manos de la corista.
	if money["in_hand_cents"].(float64) != 0 {
		t.Fatalf("nadie rindio todavia; en tu poder deberia ser 0, es %v", money["in_hand_cents"])
	}
	if money["sales_uncollected"].(float64) != 1 {
		t.Fatalf("hay una sola venta sin cobrar, dice %v", money["sales_uncollected"])
	}

	// El cupo sin repartir es un hallazgo; la asistencia todavia no, porque
	// ninguna funcion paso.
	tipos := map[string]bool{}
	for _, raw := range resp.Body["findings"].([]any) {
		tipos[raw.(map[string]any)["kind"].(string)] = true
	}
	if !tipos["unassigned"] {
		t.Fatalf("faltan 12 entradas por repartir y no aparece el hallazgo: %v", tipos)
	}
	if tipos["attendance"] {
		t.Fatal("no paso ninguna funcion: no puede haber un hallazgo de asistencia")
	}

	// La funcion en venta es la que muestra la card de asignaciones.
	inSale := resp.Body["in_sale"].(map[string]any)
	if inSale["assigned"].(float64) != 8 || inSale["capacity"].(float64) != 20 {
		t.Fatalf("en venta: asignadas %v de %v", inSale["assigned"], inSale["capacity"])
	}
	if inSale["attendance_pct"].(float64) != -1 {
		t.Fatalf("una funcion que no paso no tiene asistencia: %v", inSale["attendance_pct"])
	}
}
