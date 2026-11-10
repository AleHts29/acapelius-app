package httpapi_test

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

// TestCuposEstrictos cubre la aceptacion de C8: modo estricto de cupos.
func TestCuposEstrictos(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 80)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test") // user 2
	josefina := createSellerClient(t, env, admin, "Josefina", "jose@acapelius.test") // user 3
	createSellerClient(t, env, admin, "Virginia", "virg@acapelius.test")             // user 4
	createSellerClient(t, env, admin, "Marta", "marta@acapelius.test")               // user 5

	// 1. Sin cupo asignado, la corista no puede vender (ni por API directa).
	assertErrorCode(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Sin Cupo", "buyer_email": "comprador@prueba.test", "quantity": 1,
	}), http.StatusConflict, "no_allocation")

	// 2. Batch 20+15+10+15 sobre capacity 80 → quedan 20.
	path := fmt.Sprintf("/api/functions/%.0f/allocations", fnID)
	batch := admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{
			{"user_id": 2, "quantity": 20},
			{"user_id": 3, "quantity": 15},
			{"user_id": 4, "quantity": 10},
			{"user_id": 5, "quantity": 15},
		},
	})
	assertStatus(t, batch, http.StatusOK)
	if batch.Body["remaining"].(float64) != 20 {
		t.Fatalf("QUEDAN 20, hay %v", batch.Body["remaining"])
	}

	// Superar capacity con las asignaciones → allocation_exceeded (y rollback).
	assertErrorCode(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 41}}, // 41+15+10+15 = 81 > 80
	}), http.StatusConflict, "allocation_exceeded")
	board := admin.get(path)
	for _, raw := range board.Body["allocations"].([]any) {
		row := raw.(map[string]any)
		if row["user_id"].(float64) == 2 && row["assigned"].(float64) != 20 {
			t.Fatalf("el rollback tendria que conservar 20: %v", row)
		}
	}

	// 3. Josefina vende 15 (todo su cupo); bajarla a 14 → allocation_below_sold.
	assertStatus(t, josefina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Comprador J", "buyer_email": "comprador@prueba.test", "quantity": 15,
	}), http.StatusCreated)
	assertErrorCode(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 3, "quantity": 14}},
	}), http.StatusConflict, "allocation_below_sold")

	// Y vender por encima de su cupo → allocation_exceeded.
	assertErrorCode(t, josefina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "De Mas", "buyer_email": "comprador@prueba.test", "quantity": 1,
	}), http.StatusConflict, "allocation_exceeded")

	// 4. Una cortesia de Eli no descuenta cupo de nadie; el admin vende sin cupo.
	assertStatus(t, admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Invitado", "buyer_email": "comprador@prueba.test", "quantity": 2, "is_comp": true,
	}), http.StatusCreated)
	assertStatus(t, admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Venta de Eli", "buyer_email": "comprador@prueba.test", "quantity": 3,
	}), http.StatusCreated)
	mine := josefina.get("/api/me/allocations")
	row := mine.Body["allocations"].([]any)[0].(map[string]any)
	if row["assigned"].(float64) != 15 || row["sold"].(float64) != 15 || row["remaining"].(float64) != 0 {
		t.Fatalf("cupo de Josefina intacto tras cortesia/venta de Eli: %v", row)
	}

	// 5. Anular devuelve el cupo automaticamente.
	sales := admin.get("/api/sales?q=comprador+j")
	saleID := sales.Body["sales"].([]any)[0].(map[string]any)["id"].(float64)
	assertStatus(t, admin.post(fmt.Sprintf("/api/sales/%.0f/void", saleID), nil), http.StatusOK)
	assertStatus(t, josefina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "De Nuevo", "buyer_email": "comprador@prueba.test", "quantity": 15,
	}), http.StatusCreated)

	// 6. Carolina ve su cupo y restante.
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Con Cupo", "buyer_email": "comprador@prueba.test", "quantity": 4,
	}), http.StatusCreated)
	caro := carolina.get(fmt.Sprintf("/api/me/allocations?function_id=%.0f", fnID))
	caroRow := caro.Body["allocations"].([]any)[0].(map[string]any)
	if caroRow["assigned"].(float64) != 20 || caroRow["remaining"].(float64) != 16 {
		t.Fatalf("cupo de Carolina: %v", caroRow)
	}

	// 7. Una corista no toca las asignaciones ni ve el tablero.
	assertErrorCode(t, carolina.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 80}},
	}), http.StatusForbidden, "forbidden")
	assertErrorCode(t, carolina.get(path), http.StatusForbidden, "forbidden")
}

// TestCupoPersonalBajoConcurrencia: dos ventas simultaneas de la misma
// corista no pueden superar su cupo (mismo lock que capacity).
func TestCupoPersonalBajoConcurrencia(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100) // capacity holgada: el limite es el cupo
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 5)

	var wg sync.WaitGroup
	results := make([]apiResponse, 2)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = carolina.post("/api/sales", map[string]any{
				"function_id": fnID, "buyer_name": fmt.Sprintf("C%d", i), "buyer_email": "comprador@prueba.test", "quantity": 3,
			})
		}()
	}
	wg.Wait()

	ok, exceeded := 0, 0
	for _, resp := range results {
		switch {
		case resp.Status == http.StatusCreated:
			ok++
		case resp.Status == http.StatusConflict && resp.errorCode() == "allocation_exceeded":
			exceeded++
		}
	}
	if ok != 1 || exceeded != 1 {
		t.Fatalf("se esperaba 1 creada y 1 allocation_exceeded, hubo %+v", results)
	}
}

// TestCapacityNoBajaDeAsignado: invariante 1 tambien al editar la funcion.
func TestCapacityNoBajaDeAsignado(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 80)
	createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 60)

	assertErrorCode(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"capacity": 50}), http.StatusConflict, "allocation_exceeded")
	assertStatus(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"capacity": 60}), http.StatusOK)
}

// TestCuposDeQuienYaNoEsCorista: los cupos no pueden quedar reservados por
// alguien que salio del rol. Antes, cambiarle el rol a una corista dejaba su
// fila en la base: el tablero mostraba un total y la validacion contaba otro,
// asi que asignar el ultimo cupo fallaba con numeros que no estaban en
// ninguna pantalla.
func TestCuposDeQuienYaNoEsCorista(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 10)
	createSellerClient(t, env, admin, "Corista Uno", "corista.uno@acapelius.test") // user 2
	createSellerClient(t, env, admin, "Corista Dos", "corista.dos@acapelius.test") // user 3

	path := fmt.Sprintf("/api/functions/%.0f/allocations", fnID)
	assertStatus(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 4}},
	}), http.StatusOK)

	board := func() (total float64, filas int) {
		t.Helper()
		resp := admin.get(path)
		assertStatus(t, resp, http.StatusOK)
		return resp.Body["total_assigned"].(float64), len(resp.Body["allocations"].([]any))
	}

	if total, _ := board(); total != 4 {
		t.Fatalf("el tablero tendria que mostrar 4 asignadas, mostro %v", total)
	}

	// Pasa a puerta: sus cupos se sueltan.
	assertStatus(t, admin.do(http.MethodPatch, "/api/users/2", map[string]any{
		"name": "Corista Uno", "email": "corista.uno@acapelius.test",
		"role": "door", "is_active": true,
	}), http.StatusOK)

	total, filas := board()
	if total != 4-4 {
		t.Fatalf("al salir del rol los cupos tendrian que soltarse; el tablero muestra %v", total)
	}
	if filas != 1 {
		t.Fatalf("tendria que quedar solo la otra corista en el tablero, quedaron %d", filas)
	}

	// Y el cupo completo vuelve a estar disponible: 10 de 10 para la que queda.
	assertStatus(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 3, "quantity": 10}},
	}), http.StatusOK)

	// A alguien que no es corista activa no se le asigna cupo.
	assertStatus(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 1}},
	}), http.StatusConflict)
}

// Una funcion que ya paso conserva su reparto: se puede leer, no cambiar.
func TestCuposDeFuncionPasadaNoSeCambian(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	createSellerClient(t, env, admin, "Corista", "corista@acapelius.test") // user 2

	pasada := admin.post("/api/functions", map[string]any{
		"season_id":   activeSeasonID(t, admin),
		"venue":       "Teatro Municipal",
		"starts_at":   time.Now().Add(-4 * time.Hour).Format(time.RFC3339),
		"capacity":    10,
		"price_cents": 800000,
	})
	assertStatus(t, pasada, http.StatusCreated)
	path := fmt.Sprintf("/api/functions/%.0f/allocations", pasada.Body["function"].(map[string]any)["id"].(float64))

	assertErrorCode(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 1}},
	}), http.StatusConflict, "conflict")
	assertStatus(t, admin.get(path), http.StatusOK)

	// Dentro del margen de tres horas todavia se puede ajustar.
	reciente := admin.post("/api/functions", map[string]any{
		"season_id":   activeSeasonID(t, admin),
		"venue":       "Teatro Municipal",
		"starts_at":   time.Now().Add(-2 * time.Hour).Format(time.RFC3339),
		"capacity":    10,
		"price_cents": 800000,
	})
	assertStatus(t, reciente, http.StatusCreated)
	assertStatus(t, admin.do(http.MethodPut,
		fmt.Sprintf("/api/functions/%.0f/allocations", reciente.Body["function"].(map[string]any)["id"].(float64)),
		map[string]any{"allocations": []map[string]any{{"user_id": 2, "quantity": 1}}},
	), http.StatusOK)
}

// TestRepartoPorRoles (C22): cada funcion elige a que roles se les reparten
// entradas. Por defecto, coristas; se puede sumar direccion o un rol propio,
// o dejar a alguno afuera.
func TestRepartoPorRoles(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env) // user 1
	fnID := setupCatalog(t, admin, 20)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test") // user 2
	path := fmt.Sprintf("/api/functions/%.0f/allocations", fnID)
	rolesPath := fmt.Sprintf("/api/functions/%.0f/allocation-roles", fnID)

	soprano := admin.post("/api/roles", map[string]any{"name": "Sopranos", "base_role": "seller"})
	assertStatus(t, soprano, http.StatusCreated)
	sopranoKey := fmt.Sprintf("custom:%.0f", soprano.Body["role"].(map[string]any)["id"].(float64))
	assertStatus(t, admin.post("/api/users", map[string]any{
		"name": "Sofia", "email": "sofi@acapelius.test", "role": "seller",
		"custom_role_id": soprano.Body["role"].(map[string]any)["id"],
	}), http.StatusCreated) // user 3

	nombres := func() map[string]bool {
		t.Helper()
		resp := admin.get(path)
		assertStatus(t, resp, http.StatusOK)
		out := map[string]bool{}
		for _, raw := range resp.Body["allocations"].([]any) {
			out[raw.(map[string]any)["seller_name"].(string)] = true
		}
		return out
	}

	// Por defecto: coristas, con sus roles propios; direccion afuera.
	board := admin.get(path)
	if roles := board.Body["roles"].([]any); len(roles) != 2 || roles[0] != "seller" || roles[1] != sopranoKey {
		t.Fatalf("por defecto el reparto es de coristas: %v", roles)
	}
	if n := nombres(); !n["Carolina"] || !n["Sofia"] || n["Eli"] {
		t.Fatalf("tablero por defecto: %v", n)
	}
	if len(board.Body["role_options"].([]any)) != 3 {
		t.Fatalf("opciones: coristas, direccion y Sopranos: %v", board.Body["role_options"])
	}

	// Sumar direccion: Eli aparece y se le puede asignar.
	assertStatus(t, admin.do(http.MethodPut, rolesPath, map[string]any{"roles": []string{"seller", "admin", sopranoKey}}), http.StatusOK)
	if n := nombres(); !n["Eli"] {
		t.Fatalf("con direccion en el reparto, Eli tendria que estar: %v", n)
	}
	assertStatus(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 1, "quantity": 5}, {"user_id": 2, "quantity": 5}, {"user_id": 3, "quantity": 5}},
	}), http.StatusOK)

	// Solo direccion: las coristas salen y sus cupos se sueltan.
	assertStatus(t, admin.do(http.MethodPut, rolesPath, map[string]any{"roles": []string{"admin"}}), http.StatusOK)
	if n := nombres(); len(n) != 1 || !n["Eli"] {
		t.Fatalf("solo direccion: %v", n)
	}
	assertErrorCode(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Fuera", "buyer_email": "comprador@prueba.test", "quantity": 1,
	}), http.StatusConflict, "no_allocation")
	assertErrorCode(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 2, "quantity": 1}},
	}), http.StatusConflict, "conflict")

	// Al volver a sumarlas, no reaparece el cupo viejo: el total queda en 5.
	assertStatus(t, admin.do(http.MethodPut, rolesPath, map[string]any{"roles": []string{"seller", "admin"}}), http.StatusOK)
	if total := admin.get(path).Body["total_assigned"].(float64); total != 5 {
		t.Fatalf("total repartido = %v, se esperaba 5 (solo el de Eli)", total)
	}
	if n := nombres(); n["Sofia"] {
		t.Fatalf("Sopranos no se eligio: Sofia no tendria que estar: %v", n)
	}

	// Quien ya vendio con su cupo no puede quedar afuera.
	assignQuota(t, admin, fnID, 2, 3)
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Con Cupo", "buyer_email": "comprador@prueba.test", "quantity": 1,
	}), http.StatusCreated)
	assertErrorCode(t, admin.do(http.MethodPut, rolesPath, map[string]any{"roles": []string{"admin"}}),
		http.StatusConflict, "allocation_below_sold")

	// Validaciones: al menos un rol, y solo roles que venden.
	assertErrorCode(t, admin.do(http.MethodPut, rolesPath, map[string]any{"roles": []string{}}), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, admin.do(http.MethodPut, rolesPath, map[string]any{"roles": []string{"door"}}), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, carolina.do(http.MethodPut, rolesPath, map[string]any{"roles": []string{"seller"}}), http.StatusForbidden, "forbidden")
}
