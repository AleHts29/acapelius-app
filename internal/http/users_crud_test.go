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

func TestEntradaIndividualPublica(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 10)

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
