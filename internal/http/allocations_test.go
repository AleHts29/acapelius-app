package httpapi_test

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
)

// TestCuposEstrictos cubre la aceptacion de C8: modo estricto de cupos.
func TestCuposEstrictos(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 80)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")  // user 2
	josefina := createSellerClient(t, env, admin, "Josefina", "jose@acapelius.test")  // user 3
	createSellerClient(t, env, admin, "Virginia", "virg@acapelius.test")              // user 4
	createSellerClient(t, env, admin, "Marta", "marta@acapelius.test")                // user 5

	// 1. Sin cupo asignado, la corista no puede vender (ni por API directa).
	assertErrorCode(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Sin Cupo", "quantity": 1,
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
		"function_id": fnID, "buyer_name": "Comprador J", "quantity": 15,
	}), http.StatusCreated)
	assertErrorCode(t, admin.do(http.MethodPut, path, map[string]any{
		"allocations": []map[string]any{{"user_id": 3, "quantity": 14}},
	}), http.StatusConflict, "allocation_below_sold")

	// Y vender por encima de su cupo → allocation_exceeded.
	assertErrorCode(t, josefina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "De Mas", "quantity": 1,
	}), http.StatusConflict, "allocation_exceeded")

	// 4. Una cortesia de Eli no descuenta cupo de nadie; el admin vende sin cupo.
	assertStatus(t, admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Invitado", "quantity": 2, "is_comp": true,
	}), http.StatusCreated)
	assertStatus(t, admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Venta de Eli", "quantity": 3,
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
		"function_id": fnID, "buyer_name": "De Nuevo", "quantity": 15,
	}), http.StatusCreated)

	// 6. Carolina ve su cupo y restante.
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Con Cupo", "quantity": 4,
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
				"function_id": fnID, "buyer_name": fmt.Sprintf("C%d", i), "quantity": 3,
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
