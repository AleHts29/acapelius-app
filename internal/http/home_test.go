package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
)

// TestHomePorRol: la home devuelve lo que le toca a cada rol en una sola
// llamada, y la corista no recibe ni un dato global — no es que el frontend
// no lo muestre: el server no se lo manda.
func TestHomePorRol(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 40)
	corista := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test") // user 2
	otra := createSellerClient(t, env, admin, "Virginia", "virg@acapelius.test")    // user 3

	path := fmt.Sprintf("/api/functions/%.0f/allocations", fnID)
	assertStatus(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 5}, {"user_id": 3, "quantity": 5}},
	}), http.StatusOK)

	// Cada una vende lo suyo.
	assertStatus(t, corista.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Compra de Carolina", "quantity": 2,
	}), http.StatusCreated)
	assertStatus(t, otra.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Compra de Virginia", "quantity": 3,
	}), http.StatusCreated)

	// --- Dirección ve la función entera y las últimas ventas de todas ---
	casa := admin.get("/api/home")
	assertStatus(t, casa, http.StatusOK)
	if casa.Body["role"] != "admin" {
		t.Fatalf("rol %v", casa.Body["role"])
	}
	next := casa.Body["next_function"].(map[string]any)
	if next["sold"].(float64) != 5 {
		t.Fatalf("direccion tendria que ver las 5 vendidas de la funcion, vio %v", next["sold"])
	}
	if next["assigned"].(float64) != 10 {
		t.Fatalf("asignadas %v, esperaba 10", next["assigned"])
	}
	compradores := map[string]bool{}
	for _, raw := range casa.Body["last_sales"].([]any) {
		compradores[raw.(map[string]any)["buyer_name"].(string)] = true
	}
	if !compradores["Compra de Carolina"] || !compradores["Compra de Virginia"] {
		t.Fatalf("direccion tendria que ver las ventas de las dos: %v", compradores)
	}

	// --- La corista ve lo suyo y nada global ---
	suya := corista.get("/api/home")
	assertStatus(t, suya, http.StatusOK)
	if suya.Body["role"] != "seller" {
		t.Fatalf("rol %v", suya.Body["role"])
	}
	miNext := suya.Body["next_function"].(map[string]any)
	if miNext["my_sold"].(float64) != 2 || miNext["my_assigned"].(float64) != 5 {
		t.Fatalf("su cupo: vendio %v de %v, esperaba 2 de 5", miNext["my_sold"], miNext["my_assigned"])
	}
	if miNext["collected_cents"].(float64) != 0 {
		t.Fatalf("la corista no tendria que recibir lo recaudado de la funcion: %v", miNext["collected_cents"])
	}
	for _, raw := range suya.Body["last_sales"].([]any) {
		if nombre := raw.(map[string]any)["buyer_name"].(string); nombre == "Compra de Virginia" {
			t.Fatal("la corista esta viendo ventas de otra")
		}
	}
	if len(suya.Body["alerts"].([]any)) != 0 {
		t.Fatalf("las alertas son de direccion: %v", suya.Body["alerts"])
	}

	// Su pendiente de cobro: la venta que acaba de hacer, sin cobrar.
	todo := suya.Body["todo"].([]any)
	if len(todo) != 1 || todo[0].(map[string]any)["buyer_name"] != "Compra de Carolina" {
		t.Fatalf("te falta cobrar: %v", todo)
	}

	// --- Una corista sin cupo: el hero lo dice y no puede vender ---
	sinCupo := createSellerClient(t, env, admin, "Marta", "marta@acapelius.test")
	vacia := sinCupo.get("/api/home")
	assertStatus(t, vacia, http.StatusOK)
	heroVacio := vacia.Body["next_function"].(map[string]any)
	if heroVacio["no_allocation"] != true {
		t.Fatalf("sin cupo asignado, el hero tiene que decirlo: %v", heroVacio)
	}
	if heroVacio["my_assigned"].(float64) != 0 {
		t.Fatalf("cupo %v, esperaba 0", heroVacio["my_assigned"])
	}
}
