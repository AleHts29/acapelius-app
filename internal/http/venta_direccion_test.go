package httpapi_test

import (
	"net/http"
	"testing"
)

// TestVentaDeDireccionNoSeRinde (C22): lo que vende y cobra un admin ya esta
// en la caja del coro. No aparece debiendose a si mismo, ni en la home ni en
// Rendiciones ni en las cifras de direccion; la corista sigue rindiendo igual.
func TestVentaDeDireccionNoSeRinde(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100) // $8.000 la entrada
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 50)

	// Eli (admin) vende 2 y cobra: $16.000 directo a caja.
	eli := admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Amiga de Eli", "buyer_email": "comprador@prueba.test", "quantity": 2,
	})
	assertStatus(t, eli, http.StatusCreated)
	markPaid(t, admin, eli.Body["sale"].(map[string]any)["id"].(float64), "cash")

	// Carolina vende 1 y cobra: $8.000 que tiene que rendir.
	caro := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Primo de Caro", "buyer_email": "comprador@prueba.test", "quantity": 1,
	})
	assertStatus(t, caro, http.StatusCreated)
	markPaid(t, carolina, caro.Body["sale"].(map[string]any)["id"].(float64), "cash")

	// Home de direccion: solo Carolina debe.
	home := admin.get("/api/home")
	assertStatus(t, home, http.StatusOK)
	deudas := 0
	for _, raw := range home.Body["alerts"].([]any) {
		a := raw.(map[string]any)
		if a["kind"] != "settlement" {
			continue
		}
		deudas++
		if a["seller_id"].(float64) != 2 || a["amount_cents"].(float64) != 800000 {
			t.Fatalf("la unica deuda es la de Carolina por $8.000: %v", a)
		}
	}
	if deudas != 1 {
		t.Fatalf("se esperaba una sola deuda (Carolina): %v", home.Body["alerts"])
	}
	if b := home.Body["badges"].(map[string]any)["settlements_pending"].(float64); b != 1 {
		t.Fatalf("el numerito de Rendiciones cuenta solo a Carolina: %v", b)
	}

	// Rendiciones: la fila de Eli no debe nada y muestra lo que cobro directo.
	rep := admin.get("/api/reports/settlements?season_id=1")
	assertStatus(t, rep, http.StatusOK)
	var filaEli, filaCaro map[string]any
	for _, raw := range rep.Body["rows"].([]any) {
		r := raw.(map[string]any)
		switch r["seller_id"].(float64) {
		case 1:
			filaEli = r
		case 2:
			filaCaro = r
		}
	}
	if filaEli == nil || filaEli["balance_cents"].(float64) != 0 ||
		filaEli["collected_cents"].(float64) != 0 || filaEli["direct_cents"].(float64) != 1600000 {
		t.Fatalf("Eli no debe nada y cobro $16.000 directo a caja: %v", filaEli)
	}
	if filaCaro == nil || filaCaro["balance_cents"].(float64) != 800000 || filaCaro["direct_cents"].(float64) != 0 {
		t.Fatalf("Carolina debe $8.000: %v", filaCaro)
	}

	// Cifras de direccion: lo de Eli esta en mano, lo de Carolina sin rendir.
	dir := admin.get("/api/reports/direccion?season_id=1")
	assertStatus(t, dir, http.StatusOK)
	money := dir.Body["money"].(map[string]any)
	if money["in_hand_cents"].(float64) != 1600000 || money["unsettled_cents"].(float64) != 800000 {
		t.Fatalf("en mano $16.000 (Eli), sin rendir $8.000 (Carolina): %v", money)
	}
	if money["sellers_owing"].(float64) != 1 {
		t.Fatalf("una sola corista debe: %v", money)
	}
}
