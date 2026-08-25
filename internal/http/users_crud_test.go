package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestCRUDDeCoristas(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	created := admin.post("/api/users", map[string]string{
		"name": "Carolina", "email": "caro@acapelius.test", "role": "seller",
	})
	assertStatus(t, created, http.StatusCreated)
	userID := created.Body["user"].(map[string]any)["id"].(float64)
	path := fmt.Sprintf("/api/users/%.0f", userID)

	// Editar nombre, email y rol.
	updated := admin.do(http.MethodPatch, path, map[string]any{
		"name": "Carolina Perez", "email": "carop@acapelius.test", "role": "door", "is_active": true,
	})
	assertStatus(t, updated, http.StatusOK)
	user := updated.Body["user"].(map[string]any)
	if user["name"] != "Carolina Perez" || user["role"] != "door" || user["email"] != "carop@acapelius.test" {
		t.Fatalf("edicion incompleta: %v", user)
	}

	// Baja logica: desactivada no puede entrar (mismo error que credencial mala).
	tempPassword, _ := created.Body["temp_password"].(string)
	assertStatus(t, admin.do(http.MethodPatch, path, map[string]any{
		"name": "Carolina Perez", "email": "carop@acapelius.test", "role": "seller", "is_active": false,
	}), http.StatusOK)
	assertErrorCode(t, env.client(t).post("/api/auth/login", map[string]string{
		"email": "carop@acapelius.test", "password": tempPassword,
	}), http.StatusUnauthorized, "invalid_credentials")

	// Reactivada vuelve a entrar.
	assertStatus(t, admin.do(http.MethodPatch, path, map[string]any{
		"name": "Carolina Perez", "email": "carop@acapelius.test", "role": "seller", "is_active": true,
	}), http.StatusOK)
	assertStatus(t, env.client(t).post("/api/auth/login", map[string]string{
		"email": "carop@acapelius.test", "password": tempPassword,
	}), http.StatusOK)

	// El admin no puede auto-bloquearse: ni desactivarse ni dejar de ser admin.
	assertErrorCode(t, admin.do(http.MethodPatch, "/api/users/1", map[string]any{
		"name": "Eli", "email": adminEmail, "role": "admin", "is_active": false,
	}), http.StatusConflict, "conflict")
	assertErrorCode(t, admin.do(http.MethodPatch, "/api/users/1", map[string]any{
		"name": "Eli", "email": adminEmail, "role": "seller", "is_active": true,
	}), http.StatusConflict, "conflict")

	// Email duplicado y usuario inexistente.
	admin.post("/api/users", map[string]string{"name": "Otra", "email": "otra@acapelius.test", "role": "seller"})
	assertErrorCode(t, admin.do(http.MethodPatch, path, map[string]any{
		"name": "Carolina", "email": "otra@acapelius.test", "role": "seller", "is_active": true,
	}), http.StatusConflict, "conflict")
	assertErrorCode(t, admin.do(http.MethodPatch, "/api/users/999", map[string]any{
		"name": "Nadie", "email": "nadie@acapelius.test", "role": "seller", "is_active": true,
	}), http.StatusNotFound, "not_found")

	// Una corista no toca usuarios.
	seller := createSellerClient(t, env, admin, "Valeria", "vale@acapelius.test")
	assertErrorCode(t, seller.do(http.MethodPatch, path, map[string]any{
		"name": "Hackeada", "email": "carop@acapelius.test", "role": "admin", "is_active": true,
	}), http.StatusForbidden, "forbidden")
}

func TestAsignaciones(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")

	// Eli le asigna 10 entradas a Carolina para la funcion.
	set := admin.do(http.MethodPut, "/api/allocations", map[string]any{
		"user_id": 2, "function_id": fnID, "quantity": 10,
	})
	assertStatus(t, set, http.StatusOK)

	// Carolina vende 4 y ve su avance.
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria", "quantity": 4,
	}), http.StatusCreated)

	mine := carolina.get("/api/allocations?mine=1")
	assertStatus(t, mine, http.StatusOK)
	rows := mine.Body["allocations"].([]any)
	if len(rows) != 1 {
		t.Fatalf("Carolina tendria que ver 1 asignacion: %v", mine.Body)
	}
	row := rows[0].(map[string]any)
	if row["assigned"].(float64) != 10 || row["sold"].(float64) != 4 {
		t.Fatalf("avance mal calculado: %v", row)
	}

	// El admin ve el tablero por funcion.
	board := admin.get(fmt.Sprintf("/api/allocations?function_id=%.0f", fnID))
	assertStatus(t, board, http.StatusOK)
	boardRow := board.Body["allocations"].([]any)[0].(map[string]any)
	if boardRow["seller_name"] != "Carolina" || boardRow["sold"].(float64) != 4 {
		t.Fatalf("tablero incorrecto: %v", boardRow)
	}

	// Actualizar (upsert) y borrar con quantity 0.
	assertStatus(t, admin.do(http.MethodPut, "/api/allocations", map[string]any{
		"user_id": 2, "function_id": fnID, "quantity": 12,
	}), http.StatusOK)
	assertStatus(t, admin.do(http.MethodPut, "/api/allocations", map[string]any{
		"user_id": 2, "function_id": fnID, "quantity": 0,
	}), http.StatusNoContent)
	empty := carolina.get("/api/allocations?mine=1")
	if got := len(empty.Body["allocations"].([]any)); got != 0 {
		t.Fatalf("la asignacion tendria que haberse borrado: %d", got)
	}

	// Una corista no asigna; y no ve el tablero por funcion de otras.
	assertErrorCode(t, carolina.do(http.MethodPut, "/api/allocations", map[string]any{
		"user_id": 2, "function_id": fnID, "quantity": 99,
	}), http.StatusForbidden, "forbidden")
	assertErrorCode(t, carolina.get(fmt.Sprintf("/api/allocations?function_id=%.0f", fnID)),
		http.StatusForbidden, "forbidden")
}

func TestEntradaIndividualPublica(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")

	codes := sellTickets(t, seller, fnID, "Maria Dutra", 3)
	anonymous := env.client(t)

	// La pagina de UNA entrada: datos minimos + payload firmado + posicion.
	single := anonymous.get("/api/public/tickets/" + codes[1])
	assertStatus(t, single, http.StatusOK)
	if single.Body["buyer_name"] != "Maria Dutra" || single.Body["ticket_index"].(float64) != 2 {
		t.Fatalf("datos de la entrada individual: %v", single.Body)
	}
	payload, _ := single.Body["payload"].(string)
	if code, ok := env.signer.Verify(payload); !ok || code != codes[1] {
		t.Fatalf("payload invalido: %v", single.Body)
	}

	// El PNG sigue funcionando (la ruta con sufijo .png convive con la JSON).
	assertStatus(t, anonymous.get("/api/public/tickets/"+codes[1]+".png"), http.StatusOK)

	// Inexistente → 404; anulada → voided sin payload.
	assertErrorCode(t, anonymous.get("/api/public/tickets/NO-EXISTE"), http.StatusNotFound, "not_found")
}
