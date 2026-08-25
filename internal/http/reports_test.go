package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
)

// markPaid marca una venta como paga.
func markPaid(t *testing.T, client *testClient, saleID float64, method string) {
	t.Helper()
	assertStatus(t, client.do(http.MethodPatch, fmt.Sprintf("/api/sales/%.0f", saleID),
		map[string]string{"payment_status": "paid", "payment_method": method}), http.StatusOK)
}

// TestAceptacionFase5 arma un escenario realista y responde las tres
// preguntas de la aceptacion: ¿cuanto vendio Carolina?, ¿cuanto me debe?,
// ¿cuanta gente entro anoche?
func TestAceptacionFase5(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100) // $8.000 la entrada
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	valeria := createSellerClient(t, env, admin, "Valeria", "vale@acapelius.test")
	door := createDoorClient(t, env, admin)

	// Carolina: 3 pagas + 2 pagas + 1 pendiente = 6 vendidas, $40.000 cobrado.
	sale1 := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria Dutra", "quantity": 3,
	})
	markPaid(t, carolina, sale1.Body["sale"].(map[string]any)["id"].(float64), "cash")
	sale2 := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Pedro Gomez", "quantity": 2,
	})
	markPaid(t, carolina, sale2.Body["sale"].(map[string]any)["id"].(float64), "transfer")
	carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Lucia Fernandez", "quantity": 1,
	})

	// Valeria: 2 pagas. Y una cortesia de Eli que no debe sumar deuda.
	sale4 := valeria.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Jorge Alvarez", "quantity": 2,
	})
	markPaid(t, valeria, sale4.Body["sale"].(map[string]any)["id"].(float64), "cash")
	admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Invitado", "quantity": 2, "is_comp": true,
	})

	// Anoche entraron: los 3 de Maria y 1 de Jorge.
	for _, raw := range sale1.Body["tickets"].([]any) {
		code := raw.(map[string]any)["code"].(string)
		door.post("/api/checkins", map[string]any{
			"function_id": fnID, "method": "scan", "payload": env.signer.Payload(code),
		})
	}
	jorgeCode := sale4.Body["tickets"].([]any)[0].(map[string]any)["code"].(string)
	door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "manual", "code": jorgeCode,
	})

	// ¿Cuanto vendio Carolina? — reporte de ventas filtrado.
	report := admin.get("/api/reports/sales?seller_id=2") // Carolina es el user 2
	assertStatus(t, report, http.StatusOK)
	rows := report.Body["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("se esperaba 1 fila para Carolina, hay %d", len(rows))
	}
	row := rows[0].(map[string]any)
	if row["tickets_sold"].(float64) != 6 {
		t.Fatalf("Carolina vendio 6 entradas: %v", row)
	}
	if row["paid_cents"].(float64) != 4000000 { // 5 pagas x $8.000
		t.Fatalf("cobrado de Carolina = %v, se esperaba 4000000", row["paid_cents"])
	}
	if row["pending_cents"].(float64) != 800000 { // 1 pendiente
		t.Fatalf("pendiente de Carolina = %v, se esperaba 800000", row["pending_cents"])
	}

	// ¿Cuanto me debe? — rendiciones: cobro $40.000, rinde $25.000, debe $15.000.
	created := admin.post("/api/settlements", map[string]any{
		"seller_id": 2, "season_id": 1, "amount_cents": 2500000, "method": "cash",
		"notes": "primera rendicion",
	})
	assertStatus(t, created, http.StatusCreated)

	settlements := admin.get("/api/reports/settlements?season_id=1")
	assertStatus(t, settlements, http.StatusOK)
	var carolinaRow map[string]any
	for _, raw := range settlements.Body["rows"].([]any) {
		if r := raw.(map[string]any); r["seller_name"] == "Carolina" {
			carolinaRow = r
		}
	}
	if carolinaRow == nil {
		t.Fatalf("falta la fila de Carolina: %v", settlements.Body)
	}
	if carolinaRow["collected_cents"].(float64) != 4000000 ||
		carolinaRow["settled_cents"].(float64) != 2500000 ||
		carolinaRow["balance_cents"].(float64) != 1500000 {
		t.Fatalf("saldo de Carolina mal calculado: %v", carolinaRow)
	}
	// El historial registra la rendicion con su nota.
	history := settlements.Body["settlements"].([]any)
	if len(history) != 1 || history[0].(map[string]any)["notes"] != "primera rendicion" {
		t.Fatalf("historial de rendiciones: %v", history)
	}

	// ¿Cuanta gente entro anoche? — asistencia: 4 de 10 emitidas.
	attendance := admin.get(fmt.Sprintf("/api/reports/attendance?function_id=%.0f", fnID))
	assertStatus(t, attendance, http.StatusOK)
	if attendance.Body["entered"].(float64) != 4 {
		t.Fatalf("entraron 4: %v", attendance.Body["entered"])
	}
	if attendance.Body["issued"].(float64) != 10 { // 6+2+2 (cortesias cuentan)
		t.Fatalf("emitidas 10: %v", attendance.Body["issued"])
	}
	entries := attendance.Body["entries"].([]any)
	if len(entries) != 4 {
		t.Fatalf("la lista tendria que tener 4 ingresos: %d", len(entries))
	}
	first := entries[0].(map[string]any)
	if first["by_name"] != "Recepcion" || first["created_at"] == nil {
		t.Fatalf("cada ingreso dice quien y cuando: %v", first)
	}
}

func TestRendicionesValidacionYPermisos(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	setupCatalog(t, admin, 50)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	createSellerClient(t, env, admin, "Valeria", "vale@acapelius.test")

	// Validaciones del alta.
	assertErrorCode(t, admin.post("/api/settlements", map[string]any{
		"seller_id": 2, "season_id": 1, "amount_cents": 0, "method": "cash",
	}), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, admin.post("/api/settlements", map[string]any{
		"seller_id": 2, "season_id": 1, "amount_cents": 100, "method": "bitcoin",
	}), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, admin.post("/api/settlements", map[string]any{
		"seller_id": 999, "season_id": 1, "amount_cents": 100, "method": "cash",
	}), http.StatusNotFound, "not_found")
	assertErrorCode(t, admin.post("/api/settlements", map[string]any{
		"seller_id": 2, "season_id": 999, "amount_cents": 100, "method": "cash",
	}), http.StatusNotFound, "not_found")

	// Una vendedora no registra rendiciones ni ve reportes de admin.
	assertErrorCode(t, carolina.post("/api/settlements", map[string]any{
		"seller_id": 2, "season_id": 1, "amount_cents": 100, "method": "cash",
	}), http.StatusForbidden, "forbidden")
	assertErrorCode(t, carolina.get("/api/reports/sales"), http.StatusForbidden, "forbidden")
	assertErrorCode(t, carolina.get("/api/reports/attendance?function_id=1"), http.StatusForbidden, "forbidden")

	// Pero si ve su propio saldo, y solo el suyo.
	admin.post("/api/settlements", map[string]any{
		"seller_id": 2, "season_id": 1, "amount_cents": 100000, "method": "cash",
	})
	admin.post("/api/settlements", map[string]any{
		"seller_id": 3, "season_id": 1, "amount_cents": 200000, "method": "cash",
	})
	own := carolina.get("/api/reports/settlements?season_id=1")
	assertStatus(t, own, http.StatusOK)
	rows := own.Body["rows"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["seller_name"] != "Carolina" {
		t.Fatalf("Carolina tendria que ver solo su fila: %v", rows)
	}
	history := own.Body["settlements"].([]any)
	if len(history) != 1 || history[0].(map[string]any)["amount_cents"].(float64) != 100000 {
		t.Fatalf("Carolina tendria que ver solo sus rendiciones: %v", history)
	}
}

func TestReporteDeVentasExcluyeAnuladas(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")

	keep := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Queda", "quantity": 2,
	})
	markPaid(t, carolina, keep.Body["sale"].(map[string]any)["id"].(float64), "cash")

	drop := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Anulada", "quantity": 3,
	})
	dropID := drop.Body["sale"].(map[string]any)["id"].(float64)
	markPaid(t, carolina, dropID, "cash")
	assertStatus(t, admin.post(fmt.Sprintf("/api/sales/%.0f/void", dropID), nil), http.StatusOK)

	// El reporte de ventas no cuenta la anulada...
	report := admin.get("/api/reports/sales")
	row := report.Body["rows"].([]any)[0].(map[string]any)
	if row["tickets_sold"].(float64) != 2 || row["paid_cents"].(float64) != 1600000 {
		t.Fatalf("la venta anulada no puede contar: %v", row)
	}

	// ...ni el saldo a rendir.
	settlements := admin.get("/api/reports/settlements?season_id=1")
	var carolinaRow map[string]any
	for _, raw := range settlements.Body["rows"].([]any) {
		if r := raw.(map[string]any); r["seller_name"] == "Carolina" {
			carolinaRow = r
		}
	}
	if carolinaRow["collected_cents"].(float64) != 1600000 {
		t.Fatalf("el cobrado no puede incluir anuladas: %v", carolinaRow)
	}
}
