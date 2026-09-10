package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
)

// TestParticiparPorTemporada cubre el modelo nuevo: quien es una persona y
// quien participa de una temporada son dos cosas distintas.
func TestParticiparPorTemporada(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100)
	season2026 := activeSeasonID(t, admin)

	norma := createSellerClient(t, env, admin, "Norma", "norma@acapelius.test")
	normaID := sellerID(t, norma)
	assignQuota(t, admin, fnID, int(normaID), 20)
	venta := norma.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Compradora", "quantity": 3,
	})
	assertStatus(t, venta, http.StatusCreated)
	saleID := venta.Body["sale"].(map[string]any)["id"].(float64)
	assertStatus(t, norma.do(http.MethodPatch, fmt.Sprintf("/api/sales/%.0f", saleID),
		map[string]any{"payment_status": "paid", "payment_method": "cash"}), http.StatusOK)

	// 1. Temporada nueva sin Norma: el equipo se elige al crearla.
	nueva := admin.post("/api/seasons", map[string]any{
		"name": "Temporada 2027",
		"members": []map[string]any{
			{"user_id": 1, "role": "admin"},
		},
	})
	assertStatus(t, nueva, http.StatusCreated)
	season2027 := nueva.Body["season"].(map[string]any)["id"].(float64)

	// 2. Norma sigue existiendo, pero este año no participa: entra igual y se
	//    queda sin rol.
	me := norma.get("/api/me")
	assertStatus(t, me, http.StatusOK)
	if rol := me.Body["user"].(map[string]any)["role"]; rol != "" {
		t.Fatalf("fuera de la temporada no tendria que tener rol; tiene %v", rol)
	}
	// No vende...
	assertStatus(t, norma.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Otra", "quantity": 1,
	}), http.StatusForbidden)
	// ...pero mira lo suyo.
	assertStatus(t, norma.get("/api/sales"), http.StatusOK)

	// 3. Su venta de 2026 sigue siendo de 2026: el historico no se toca.
	viejo := admin.get(fmt.Sprintf("/api/reports/settlements?season_id=%.0f", season2026))
	assertStatus(t, viejo, http.StatusOK)
	var fila map[string]any
	for _, raw := range viejo.Body["rows"].([]any) {
		if r := raw.(map[string]any); r["seller_name"] == "Norma" {
			fila = r
		}
	}
	if fila == nil || fila["collected_cents"].(float64) != 2400000 {
		t.Fatalf("Norma tendria que seguir contando en 2026: %v", fila)
	}

	// 4. Equipo por temporada: en 2027 no esta, y aparece como "ya no".
	equipo := admin.get(fmt.Sprintf("/api/users?season_id=%.0f", season2027))
	assertStatus(t, equipo, http.StatusOK)
	for _, raw := range equipo.Body["members"].([]any) {
		if m := raw.(map[string]any); m["name"] == "Norma" {
			t.Fatalf("Norma no tendria que estar en el equipo de 2027")
		}
	}
	var exMiembro map[string]any
	for _, raw := range equipo.Body["former"].([]any) {
		if m := raw.(map[string]any); m["name"] == "Norma" {
			exMiembro = m
		}
	}
	if exMiembro == nil {
		t.Fatalf("Norma tendria que estar entre las que no participan: %v", equipo.Body["former"])
	}
	if exMiembro["last_season_name"] != "Temporada 2026" || exMiembro["last_tickets_sold"].(float64) != 3 {
		t.Fatalf("el historial de Norma esta mal: %v", exMiembro)
	}

	// 5. Reincorporarla: vuelve a tener rol sin tocar nada del pasado.
	assertStatus(t, admin.post(fmt.Sprintf("/api/seasons/%.0f/members", season2027),
		map[string]any{"user_id": normaID, "role": "seller"}), http.StatusOK)
	me = norma.get("/api/me")
	if rol := me.Body["user"].(map[string]any)["role"]; rol != "seller" {
		t.Fatalf("reincorporada tendria que volver a ser corista; es %v", rol)
	}

	// 6. Nunca una temporada sin direccion.
	sacar := admin.do(http.MethodDelete, fmt.Sprintf("/api/seasons/%.0f/members/1", season2027), nil)
	assertStatus(t, sacar, http.StatusConflict)
}

// TestEquipoDeLaTemporada: los datos con los que se decide quien sigue.
func TestEquipoDeLaTemporada(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100)

	caro := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	caroID := sellerID(t, caro)
	assignQuota(t, admin, fnID, int(caroID), 20)
	venta := caro.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Compradora", "quantity": 4,
	})
	assertStatus(t, venta, http.StatusCreated)
	saleID := venta.Body["sale"].(map[string]any)["id"].(float64)
	assertStatus(t, caro.do(http.MethodPatch, fmt.Sprintf("/api/sales/%.0f", saleID),
		map[string]any{"payment_status": "paid", "payment_method": "cash"}), http.StatusOK)

	// Una invitada que nunca entro.
	assertStatus(t, admin.post("/api/users", map[string]string{
		"name": "Josefina", "email": "jose@acapelius.test", "role": "seller",
	}), http.StatusCreated)

	equipo := admin.get("/api/users")
	assertStatus(t, equipo, http.StatusOK)
	porNombre := map[string]map[string]any{}
	for _, raw := range equipo.Body["members"].([]any) {
		m := raw.(map[string]any)
		porNombre[m["name"].(string)] = m
	}

	carolina := porNombre["Carolina"]
	if carolina["tickets_sold"].(float64) != 4 {
		t.Fatalf("vendidas de Carolina = %v, se esperaban 4", carolina["tickets_sold"])
	}
	if carolina["assigned"].(float64) != 20 {
		t.Fatalf("cupo de Carolina = %v, se esperaban 20", carolina["assigned"])
	}
	// Cobro $32.000 y no rindio nada.
	if carolina["balance_cents"].(float64) != 3200000 {
		t.Fatalf("sin rendir de Carolina = %v, se esperaban 3200000", carolina["balance_cents"])
	}

	josefina := porNombre["Josefina"]
	if josefina["last_login_at"] != nil {
		t.Fatalf("Josefina nunca entro: %v", josefina)
	}

	resumen := equipo.Body["summary"].(map[string]any)
	if resumen["active"].(float64) != 2 || resumen["pending"].(float64) != 1 {
		t.Fatalf("resumen del equipo mal: %v", resumen)
	}
	if resumen["tickets_sold"].(float64) != 4 || resumen["balance_cents"].(float64) != 3200000 {
		t.Fatalf("agregados del equipo mal: %v", resumen)
	}
}
