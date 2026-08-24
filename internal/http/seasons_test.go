package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
)

// createSellerClient da de alta una vendedora via API (como admin) y devuelve
// un cliente ya logueado con la password definitiva.
func createSellerClient(t *testing.T, env *testEnv, admin *testClient, name, email string) *testClient {
	t.Helper()

	created := admin.post("/api/users", map[string]string{
		"name": name, "email": email, "role": "seller",
	})
	assertStatus(t, created, http.StatusCreated)
	tempPassword, _ := created.Body["temp_password"].(string)

	seller := env.client(t)
	assertStatus(t, seller.post("/api/auth/login", map[string]string{
		"email": email, "password": tempPassword,
	}), http.StatusOK)
	assertStatus(t, seller.post("/api/auth/change-password", map[string]string{
		"current_password": tempPassword, "new_password": "vendo-entradas",
	}), http.StatusOK)
	return seller
}

// TestAceptacionFase1 sigue el criterio de aceptacion de la spec: Eli crea
// "Temporada 2026" con 4 funciones con cupo y precio, y crea 5 vendedoras.
func TestAceptacionFase1(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	created := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	assertStatus(t, created, http.StatusCreated)
	season := created.Body["season"].(map[string]any)
	seasonID := season["id"].(float64)
	if season["is_active"] != true {
		t.Fatalf("la temporada nueva tendria que arrancar activa: %v", season)
	}

	for i := range 4 {
		resp := admin.post("/api/functions", map[string]any{
			"season_id":   seasonID,
			"venue":       "Teatro Municipal",
			"starts_at":   fmt.Sprintf("2026-12-%02dT21:00:00-03:00", 10+i),
			"capacity":    250,
			"price_cents": 800000,
		})
		assertStatus(t, resp, http.StatusCreated)
	}

	for i := range 5 {
		resp := admin.post("/api/users", map[string]string{
			"name":  fmt.Sprintf("Vendedora %d", i+1),
			"email": fmt.Sprintf("vendedora%d@acapelius.test", i+1),
			"role":  "seller",
		})
		assertStatus(t, resp, http.StatusCreated)
	}

	functions := admin.get(fmt.Sprintf("/api/functions?season_id=%.0f", seasonID))
	assertStatus(t, functions, http.StatusOK)
	if got := len(functions.Body["functions"].([]any)); got != 4 {
		t.Fatalf("se esperaban 4 funciones, hay %d", got)
	}

	users := admin.get("/api/users")
	assertStatus(t, users, http.StatusOK)
	if got := len(users.Body["users"].([]any)); got != 6 { // admin + 5 vendedoras
		t.Fatalf("se esperaban 6 usuarios, hay %d", got)
	}
}

func TestValidacionDeFunciones(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	created := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	assertStatus(t, created, http.StatusCreated)
	seasonID := created.Body["season"].(map[string]any)["id"].(float64)

	base := func() map[string]any {
		return map[string]any{
			"season_id":   seasonID,
			"venue":       "Teatro",
			"starts_at":   "2026-12-10T21:00:00-03:00",
			"capacity":    100,
			"price_cents": 500000,
		}
	}

	cases := []struct {
		name       string
		mutate     func(map[string]any)
		wantStatus int
		wantCode   string
	}{
		{"lugar vacio", func(m map[string]any) { m["venue"] = "  " }, http.StatusBadRequest, "validation_error"},
		{"cupo cero", func(m map[string]any) { m["capacity"] = 0 }, http.StatusBadRequest, "validation_error"},
		{"precio negativo", func(m map[string]any) { m["price_cents"] = -100 }, http.StatusBadRequest, "validation_error"},
		{"temporada inexistente", func(m map[string]any) { m["season_id"] = 9999 }, http.StatusNotFound, "not_found"},
		{"fecha invalida", func(m map[string]any) { m["starts_at"] = "el sabado a la noche" }, http.StatusBadRequest, "bad_request"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := base()
			tc.mutate(body)
			assertErrorCode(t, admin.post("/api/functions", body), tc.wantStatus, tc.wantCode)
		})
	}

	// El nombre de temporada vacio tambien se rechaza.
	assertErrorCode(t, admin.post("/api/seasons", map[string]string{"name": "  "}),
		http.StatusBadRequest, "validation_error")
}

func TestEditarFuncion(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	season := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	seasonID := season.Body["season"].(map[string]any)["id"].(float64)

	created := admin.post("/api/functions", map[string]any{
		"season_id":   seasonID,
		"name":        "Funcion de gala",
		"venue":       "Teatro Municipal",
		"starts_at":   "2026-12-10T21:00:00-03:00",
		"capacity":    250,
		"price_cents": 800000,
	})
	assertStatus(t, created, http.StatusCreated)
	fn := created.Body["function"].(map[string]any)
	fnID := fn["id"].(float64)
	if fn["name"] != "Funcion de gala" {
		t.Fatalf("nombre no guardado: %v", fn)
	}

	// PATCH parcial: cambia el cupo, el resto queda igual.
	patched := admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"capacity": 300})
	assertStatus(t, patched, http.StatusOK)
	updated := patched.Body["function"].(map[string]any)
	if updated["capacity"].(float64) != 300 {
		t.Fatalf("el cupo no cambio: %v", updated)
	}
	if updated["venue"] != "Teatro Municipal" || updated["name"] != "Funcion de gala" {
		t.Fatalf("el PATCH piso campos que no vinieron: %v", updated)
	}

	// Vaciar el nombre opcional lo deja en null.
	cleared := admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"name": "  "})
	assertStatus(t, cleared, http.StatusOK)
	if cleared.Body["function"].(map[string]any)["name"] != nil {
		t.Fatalf("el nombre vacio tendria que quedar null: %v", cleared.Body)
	}

	// Un PATCH invalido no toca nada.
	assertErrorCode(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"capacity": 0}), http.StatusBadRequest, "validation_error")

	// Funcion inexistente.
	assertErrorCode(t, admin.do(http.MethodPatch, "/api/functions/9999",
		map[string]any{"capacity": 10}), http.StatusNotFound, "not_found")
}

func TestCatalogoLecturaParaTodosEscrituraSoloAdmin(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	season := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	seasonID := season.Body["season"].(map[string]any)["id"].(float64)
	admin.post("/api/functions", map[string]any{
		"season_id":   seasonID,
		"venue":       "Teatro",
		"starts_at":   "2026-12-10T21:00:00-03:00",
		"capacity":    100,
		"price_cents": 500000,
	})

	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")

	// La vendedora lee el catalogo (lo necesita para vender)...
	assertStatus(t, seller.get("/api/seasons"), http.StatusOK)
	functions := seller.get("/api/functions")
	assertStatus(t, functions, http.StatusOK)
	if got := len(functions.Body["functions"].([]any)); got != 1 {
		t.Fatalf("la vendedora tendria que ver 1 funcion, ve %d", got)
	}

	// ...pero no lo modifica.
	assertErrorCode(t, seller.post("/api/seasons", map[string]string{"name": "Otra"}),
		http.StatusForbidden, "forbidden")
	assertErrorCode(t, seller.post("/api/functions", map[string]any{
		"season_id": seasonID, "venue": "X", "starts_at": "2026-12-11T21:00:00-03:00",
		"capacity": 10, "price_cents": 100,
	}), http.StatusForbidden, "forbidden")
	assertErrorCode(t, seller.do(http.MethodPatch, "/api/functions/1",
		map[string]any{"capacity": 5}), http.StatusForbidden, "forbidden")
}
