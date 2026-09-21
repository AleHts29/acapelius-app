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

// TestMiRendicionEnLaHome cubre el bug que arregla C16: la corista no tenía
// forma de ver lo que tiene que rendir. El acceso de su home apuntaba a una
// ruta de admin y rebotaba, así que el número sólo existía si se lo preguntaba
// a Eli. Ahora viaja en su propia home, del mismo cálculo que usa Plata.
func TestMiRendicionEnLaHome(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100)
	seasonID := activeSeasonID(t, admin)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	caroID := sellerID(t, carolina)
	assignQuota(t, admin, fnID, int(caroID), 20)

	mio := func() map[string]any {
		t.Helper()
		resp := carolina.get("/api/home")
		assertStatus(t, resp, http.StatusOK)
		fila, ok := resp.Body["my_settlement"].(map[string]any)
		if !ok {
			t.Fatalf("la home de la corista tiene que traer my_settlement: %v", resp.Body)
		}
		return fila
	}

	// Sin vender: el bloque existe igual, en cero. "No debés nada" también es
	// una respuesta, y el silencio no lo es.
	if v := mio(); v["balance_cents"].(float64) != 0 || v["sales"].(float64) != 0 {
		t.Fatalf("sin ventas tendría que estar en cero: %v", v)
	}

	// Vende 4 entradas a $8.000 y cobra 3 de ellas.
	for i, cobrar := range []bool{true, true, true, false} {
		venta := carolina.post("/api/sales", map[string]any{
			"function_id": fnID, "buyer_name": fmt.Sprintf("Compradora %d", i), "quantity": 1,
		})
		assertStatus(t, venta, http.StatusCreated)
		if cobrar {
			markPaid(t, carolina, venta.Body["sale"].(map[string]any)["id"].(float64), "cash")
		}
	}

	v := mio()
	if v["collected_cents"].(float64) != 2400000 {
		t.Fatalf("cobrado = %v, se esperaban 2400000", v["collected_cents"])
	}
	if v["balance_cents"].(float64) != 2400000 || v["settled_cents"].(float64) != 0 {
		t.Fatalf("todavía no rindió nada: %v", v)
	}
	// La venta sin cobrar no cuenta: rendir es sobre lo que tiene en la mano.
	if v["sales"].(float64) != 3 {
		t.Fatalf("ventas cobradas = %v, se esperaban 3", v["sales"])
	}

	// Rinde $10.000: el saldo baja por la diferencia, no se borra.
	assertStatus(t, admin.post("/api/settlements", map[string]any{
		"seller_id": caroID, "season_id": seasonID, "amount_cents": 1000000, "method": "cash",
	}), http.StatusCreated)
	v = mio()
	if v["settled_cents"].(float64) != 1000000 || v["balance_cents"].(float64) != 1400000 {
		t.Fatalf("después de rendir $10.000: %v", v)
	}

	// Es el mismo número que muestra Plata: dos cuentas del mismo saldo
	// terminan discrepando, y esa discusión la pierde siempre la corista.
	reporte := admin.get(fmt.Sprintf("/api/reports/settlements?season_id=%.0f", seasonID))
	assertStatus(t, reporte, http.StatusOK)
	for _, raw := range reporte.Body["rows"].([]any) {
		if fila := raw.(map[string]any); fila["seller_name"] == "Carolina" {
			if fila["balance_cents"].(float64) != v["balance_cents"].(float64) {
				t.Fatalf("la home dice %v y Plata %v", v["balance_cents"], fila["balance_cents"])
			}
		}
	}

	// Dirección no recibe el bloque: ese número lo ve en Plata.
	resp := admin.get("/api/home")
	if _, hay := resp.Body["my_settlement"]; hay {
		t.Fatalf("la home de dirección no tendría que traer my_settlement")
	}
}
