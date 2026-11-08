package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
)

// Un rol propio es un nombre con los permisos de uno de base: quien lo tiene
// hace lo mismo que el de base, y borrarlo no le saca nada.
func TestRolesPropios(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	creado := admin.post("/api/roles", map[string]any{"name": "Acomodador", "base_role": "door"})
	assertStatus(t, creado, http.StatusCreated)
	rolID := creado.Body["role"].(map[string]any)["id"].(float64)

	assertErrorCode(t, admin.post("/api/roles", map[string]any{"name": "acomodador", "base_role": "seller"}), http.StatusConflict, "conflict")
	assertErrorCode(t, admin.post("/api/roles", map[string]any{"name": "Puerta", "base_role": "door"}), http.StatusConflict, "conflict")
	assertErrorCode(t, admin.post("/api/roles", map[string]any{"name": "  ", "base_role": "door"}), http.StatusBadRequest, "validation_error")
	assertErrorCode(t, admin.post("/api/roles", map[string]any{"name": "Otro", "base_role": "jefe"}), http.StatusBadRequest, "validation_error")

	lista := admin.get("/api/roles")
	assertStatus(t, lista, http.StatusOK)
	if n := len(lista.Body["roles"].([]any)); n != 1 {
		t.Fatalf("roles = %d, se esperaba 1", n)
	}

	// Alta con el rol propio: el rol que cuenta es el de base (door).
	alta := admin.post("/api/users", map[string]any{
		"name": "Rafa", "email": "rafa@acapelius.test", "role": "seller", "custom_role_id": rolID,
	})
	assertStatus(t, alta, http.StatusCreated)
	rafa := alta.Body["user"].(map[string]any)["id"].(float64)

	miembro := func() map[string]any {
		t.Helper()
		for _, raw := range admin.get("/api/users").Body["members"].([]any) {
			if m := raw.(map[string]any); m["id"].(float64) == rafa {
				return m
			}
		}
		t.Fatal("Rafa no esta en el equipo")
		return nil
	}
	if m := miembro(); m["role"] != "door" || m["role_name"] != "Acomodador" {
		t.Fatalf("Rafa tendria que ser Acomodador con permisos de puerta: %v", m)
	}

	// Una persona de puerta no administra roles.
	puerta := env.client(t)
	assertStatus(t, puerta.post("/api/auth/login", map[string]string{
		"email": "rafa@acapelius.test", "password": alta.Body["temp_password"].(string),
	}), http.StatusOK)
	assertStatus(t, puerta.post("/api/auth/change-password", map[string]string{
		"current_password": alta.Body["temp_password"].(string), "new_password": "abro-la-puerta",
	}), http.StatusOK)
	assertErrorCode(t, puerta.get("/api/roles"), http.StatusForbidden, "forbidden")

	// Editar sin rol propio vuelve al nombre de base.
	assertStatus(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/users/%.0f", rafa), map[string]any{
		"name": "Rafa", "email": "rafa@acapelius.test", "role": "door", "is_active": true,
	}), http.StatusOK)
	if m := miembro(); m["role_name"] != nil {
		t.Fatalf("sin rol propio no hay nombre: %v", m)
	}

	// Se lo vuelve a poner y se borra el rol: queda en puerta, sin el nombre.
	assertStatus(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/users/%.0f", rafa), map[string]any{
		"name": "Rafa", "email": "rafa@acapelius.test", "role": "door", "is_active": true, "custom_role_id": rolID,
	}), http.StatusOK)
	assertStatus(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/roles/%.0f", rolID), nil), http.StatusNoContent)
	if m := miembro(); m["role"] != "door" || m["role_name"] != nil {
		t.Fatalf("borrar el rol no le saca el acceso: %v", m)
	}
	assertErrorCode(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/roles/%.0f", rolID), nil), http.StatusNotFound, "not_found")
}

// Direccion elimina un perfil que nunca hizo nada; con historial, no.
func TestEliminarPerfil(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 10)

	alta := admin.post("/api/users", map[string]any{"name": "Sin Nada", "email": "nada@acapelius.test", "role": "seller"})
	assertStatus(t, alta, http.StatusCreated)
	sinNada := alta.Body["user"].(map[string]any)["id"].(float64)
	assignQuota(t, admin, fnID, int(sinNada), 2) // un cupo no es historial

	vendio := createSellerClient(t, env, admin, "Vendedora", "vende@acapelius.test")
	me := vendio.get("/api/me").Body["user"].(map[string]any)["id"].(float64)
	assignQuota(t, admin, fnID, int(me), 2)
	assertStatus(t, vendio.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Ana", "buyer_email": "ana@x.com", "quantity": 1,
	}), http.StatusCreated)

	// La corista no borra a nadie; direccion no se borra a si misma.
	assertErrorCode(t, vendio.do(http.MethodDelete, fmt.Sprintf("/api/users/%.0f", sinNada), nil), http.StatusForbidden, "forbidden")
	adminID := admin.get("/api/me").Body["user"].(map[string]any)["id"].(float64)
	assertErrorCode(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/users/%.0f", adminID), nil), http.StatusConflict, "conflict")

	// Con ventas no se borra; sin nada, si, y desaparece del equipo.
	assertErrorCode(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/users/%.0f", me), nil), http.StatusConflict, "conflict")
	assertStatus(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/users/%.0f", sinNada), nil), http.StatusNoContent)
	for _, raw := range admin.get("/api/users").Body["members"].([]any) {
		if raw.(map[string]any)["id"].(float64) == sinNada {
			t.Fatal("el perfil eliminado sigue en el equipo")
		}
	}
	assertErrorCode(t, admin.do(http.MethodDelete, fmt.Sprintf("/api/users/%.0f", sinNada), nil), http.StatusNotFound, "not_found")
}
