package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// sellerID saca el id de la corista de su propia sesion: los tests no pueden
// asumir que es el 2, porque depende de cuantos usuarios se crearon antes.
func sellerID(t *testing.T, c *testClient) float64 {
	t.Helper()
	resp := c.get("/api/me")
	assertStatus(t, resp, http.StatusOK)
	return resp.Body["user"].(map[string]any)["id"].(float64)
}

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

	// El equipo de la temporada nueva: quien la creo entra como direccion y
	// las cinco vendedoras se dieron de alta despues, ya con esta activa.
	equipo := admin.get(fmt.Sprintf("/api/users?season_id=%.0f", seasonID))
	assertStatus(t, equipo, http.StatusOK)
	if got := len(equipo.Body["members"].([]any)); got != 6 { // admin + 5 vendedoras
		t.Fatalf("se esperaban 6 personas en la temporada, hay %d: %v", got, equipo.Body)
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

// TestUnaSolaTemporadaEnCurso: crear una temporada apaga la anterior, y
// "Usar esta temporada" la vuelve a prender. Antes quedaban las dos activas y
// Inicio y Rendiciones —que toman la temporada en curso sin preguntar— se
// iban a la vacia, mostrando $0 con plata sin rendir en la base.
func TestUnaSolaTemporadaEnCurso(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	primera := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	assertStatus(t, primera, http.StatusCreated)
	idPrimera := primera.Body["season"].(map[string]any)["id"].(float64)

	segunda := admin.post("/api/seasons", map[string]string{"name": "Temporada 2027"})
	assertStatus(t, segunda, http.StatusCreated)
	idSegunda := segunda.Body["season"].(map[string]any)["id"].(float64)

	activas := func() []float64 {
		t.Helper()
		resp := admin.get("/api/seasons")
		assertStatus(t, resp, http.StatusOK)
		var ids []float64
		for _, raw := range resp.Body["seasons"].([]any) {
			s := raw.(map[string]any)
			if s["is_active"] == true {
				ids = append(ids, s["id"].(float64))
			}
		}
		return ids
	}

	if got := activas(); len(got) != 1 || got[0] != idSegunda {
		t.Fatalf("tendria que quedar activa solo la nueva (%v); activas: %v", idSegunda, got)
	}

	// La activa va primera en la lista: de ahi la saca el frontend.
	lista := admin.get("/api/seasons")
	primeraDeLaLista := lista.Body["seasons"].([]any)[0].(map[string]any)
	if primeraDeLaLista["id"].(float64) != idSegunda {
		t.Fatalf("la activa tendria que venir primera; vino %v", primeraDeLaLista["id"])
	}

	// Volver a la anterior.
	assertStatus(t, admin.post(fmt.Sprintf("/api/seasons/%d/activate", int(idPrimera)), nil), http.StatusOK)
	if got := activas(); len(got) != 1 || got[0] != idPrimera {
		t.Fatalf("tendria que quedar activa solo la primera (%v); activas: %v", idPrimera, got)
	}

	// Una temporada que no existe: 404, no 500.
	assertStatus(t, admin.post("/api/seasons/99999/activate", nil), http.StatusNotFound)

	// Solo dirección puede cambiarla.
	corista := createSellerClient(t, env, admin, "Corista", "corista@acapelius.test")
	assertStatus(t, corista.post(fmt.Sprintf("/api/seasons/%d/activate", int(idSegunda)), nil), http.StatusForbidden)
}

// TestTemporadaNuevaCopiaLaAnterior cubre los dos atajos del alta: copiar la
// grilla del año pasado y crear sin mover la temporada en curso.
func TestTemporadaNuevaCopiaLaAnterior(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	base := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	assertStatus(t, base, http.StatusCreated)
	baseID := base.Body["season"].(map[string]any)["id"].(float64)

	for i, fecha := range []string{"2026-08-22T21:00:00-03:00", "2026-09-05T20:00:00-03:00"} {
		resp := admin.post("/api/functions", map[string]any{
			"season_id":   baseID,
			"name":        fmt.Sprintf("Funcion %d", i+1),
			"venue":       "Teatro Municipal",
			"starts_at":   fecha,
			"capacity":    80,
			"price_cents": 900000,
		})
		assertStatus(t, resp, http.StatusCreated)
	}

	nueva := admin.post("/api/seasons", map[string]any{
		"name":                "Temporada 2027",
		"activate":            false,
		"copy_from_season_id": baseID,
	})
	assertStatus(t, nueva, http.StatusCreated)
	season := nueva.Body["season"].(map[string]any)
	nuevaID := season["id"].(float64)

	if nueva.Body["copied"].(float64) != 2 {
		t.Fatalf("tendria que haber copiado 2 funciones; copio %v", nueva.Body["copied"])
	}
	// activate:false: la respuesta no puede decir que quedo activa, y la que
	// mira el resto de la app tiene que seguir siendo la de 2026.
	if season["is_active"] != false {
		t.Fatalf("con activate:false la temporada no tendria que quedar activa: %v", season)
	}
	lista := admin.get("/api/seasons")
	for _, raw := range lista.Body["seasons"].([]any) {
		s := raw.(map[string]any)
		if s["is_active"] == true && s["id"].(float64) != baseID {
			t.Fatalf("la temporada en curso tendria que seguir siendo la de 2026; es %v", s)
		}
	}

	copiadas := admin.get(fmt.Sprintf("/api/functions?season_id=%.0f", nuevaID))
	assertStatus(t, copiadas, http.StatusOK)
	filas := copiadas.Body["functions"].([]any)
	if len(filas) != 2 {
		t.Fatalf("la temporada copiada tendria que tener 2 funciones; tiene %d", len(filas))
	}
	primera := filas[0].(map[string]any)
	if primera["capacity"].(float64) != 80 || primera["price_cents"].(float64) != 900000 {
		t.Fatalf("la copia tendria que conservar cupo y precio: %v", primera)
	}
	// 364 dias = 52 semanas: la funcion cae el mismo dia de la semana.
	inicio, err := time.Parse(time.RFC3339, primera["starts_at"].(string))
	if err != nil {
		t.Fatalf("starts_at ilegible: %v", err)
	}
	original, _ := time.Parse(time.RFC3339, "2026-08-22T21:00:00-03:00")
	if !inicio.Equal(original.AddDate(0, 0, 364)) {
		t.Fatalf("la fecha copiada tendria que correrse 364 dias: %v vs %v", inicio, original)
	}
	if inicio.Weekday() != original.Weekday() {
		t.Fatalf("la copia tendria que caer el mismo dia de la semana: %v vs %v", inicio.Weekday(), original.Weekday())
	}

	// Copiar de una temporada que no existe es 404, no 500.
	assertStatus(t, admin.post("/api/seasons", map[string]any{
		"name": "Temporada fantasma", "copy_from_season_id": 999999,
	}), http.StatusNotFound)
}

// TestCancelarFuncion: se puede sacar una funcion cargada por error, pero no
// una que ya vendio.
func TestCancelarFuncion(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	temporada := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	seasonID := temporada.Body["season"].(map[string]any)["id"].(float64)

	crear := func(nombre string) float64 {
		t.Helper()
		resp := admin.post("/api/functions", map[string]any{
			"season_id": seasonID, "name": nombre, "venue": "Teatro Municipal",
			"starts_at": "2026-12-20T21:00:00-03:00", "capacity": 50, "price_cents": 800000,
		})
		assertStatus(t, resp, http.StatusCreated)
		return resp.Body["function"].(map[string]any)["id"].(float64)
	}

	sinVentas := crear("Cargada por error")
	// Con cupo repartido igual se puede: sin funcion no hay cupo que repartir.
	corista := createSellerClient(t, env, admin, "Corista", "corista@acapelius.test")
	assertStatus(t, admin.do(http.MethodPut, fmt.Sprintf("/api/functions/%.0f/allocations", sinVentas),
		map[string]any{"allocations": []map[string]any{{"user_id": sellerID(t, corista), "quantity": 5}}}), http.StatusOK)

	assertStatus(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/functions/%.0f", sinVentas), nil), http.StatusNoContent)
	assertStatus(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/functions/%.0f", sinVentas), nil), http.StatusNotFound)

	conVentas := crear("Ya vendio")
	assertStatus(t, admin.do(http.MethodPut, fmt.Sprintf("/api/functions/%.0f/allocations", conVentas),
		map[string]any{"allocations": []map[string]any{{"user_id": sellerID(t, corista), "quantity": 5}}}), http.StatusOK)
	venta := corista.post("/api/sales", map[string]any{
		"function_id": conVentas, "buyer_name": "Comprador", "quantity": 1,
	})
	assertStatus(t, venta, http.StatusCreated)

	borrado := admin.do(http.MethodDelete, fmt.Sprintf("/api/functions/%.0f", conVentas), nil)
	assertStatus(t, borrado, http.StatusConflict)

	// Y no la puede borrar una corista.
	assertStatus(t, corista.do(http.MethodDelete, fmt.Sprintf("/api/functions/%.0f", conVentas), nil), http.StatusForbidden)
}

// TestIndiceDeTemporadas: el resumen por temporada que muestra el indice.
func TestIndiceDeTemporadas(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	temporada := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	seasonID := temporada.Body["season"].(map[string]any)["id"].(float64)
	fn := admin.post("/api/functions", map[string]any{
		"season_id": seasonID, "venue": "Teatro Municipal",
		"starts_at": "2026-12-20T21:00:00-03:00", "capacity": 50, "price_cents": 800000,
	})
	assertStatus(t, fn, http.StatusCreated)
	fnID := fn.Body["function"].(map[string]any)["id"].(float64)

	corista := createSellerClient(t, env, admin, "Corista", "corista@acapelius.test")
	assertStatus(t, admin.do(http.MethodPut, fmt.Sprintf("/api/functions/%.0f/allocations", fnID),
		map[string]any{"allocations": []map[string]any{{"user_id": sellerID(t, corista), "quantity": 20}}}), http.StatusOK)
	venta := corista.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Comprador", "quantity": 3,
	})
	assertStatus(t, venta, http.StatusCreated)
	saleID := venta.Body["sale"].(map[string]any)["id"].(float64)
	assertStatus(t, corista.do(http.MethodPatch, fmt.Sprintf("/api/sales/%.0f", saleID),
		map[string]any{"payment_status": "paid", "payment_method": "cash"}), http.StatusOK)

	resp := admin.get("/api/reports/seasons")
	assertStatus(t, resp, http.StatusOK)
	fila := resp.Body["seasons"].([]any)[0].(map[string]any)

	if fila["functions"].(float64) != 1 || fila["capacity"].(float64) != 50 {
		t.Fatalf("funciones y cupo mal: %v", fila)
	}
	if fila["sold"].(float64) != 3 {
		t.Fatalf("vendidas = %v, se esperaban 3", fila["sold"])
	}
	if fila["collected_cents"].(float64) != 2400000 {
		t.Fatalf("recaudado = %v, se esperaban 2400000", fila["collected_cents"])
	}
	if fila["assigned"].(float64) != 20 {
		t.Fatalf("asignadas = %v, se esperaban 20", fila["assigned"])
	}
	if fila["sellers"].(float64) != 1 {
		t.Fatalf("coristas = %v, se esperaba 1", fila["sellers"])
	}
	if fila["first_at"] == nil || fila["last_at"] == nil {
		t.Fatalf("con una funcion cargada tiene que haber primera y ultima fecha: %v", fila)
	}

	// Una temporada vacia no inventa fechas.
	vacia := admin.post("/api/seasons", map[string]any{"name": "Temporada vacia", "activate": false})
	assertStatus(t, vacia, http.StatusCreated)
	resp = admin.get("/api/reports/seasons")
	for _, raw := range resp.Body["seasons"].([]any) {
		s := raw.(map[string]any)
		if s["name"] == "Temporada vacia" {
			if s["first_at"] != nil || s["next_at"] != nil {
				t.Fatalf("una temporada sin funciones no tiene fechas: %v", s)
			}
		}
	}

	// Lleva plata: no la puede leer una corista.
	assertStatus(t, corista.get("/api/reports/seasons"), http.StatusForbidden)
}
