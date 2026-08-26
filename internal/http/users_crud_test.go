package httpapi_test

import (
	"fmt"
	"net/http"
	"strings"
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

// TestInvitacionesDelEquipo cubre la aceptacion de C7: Josefina recien creada
// queda con la invitacion pendiente, deja de estarlo cuando entra por primera
// vez, y el reenvio / reseteo le dan una clave nueva que funciona.
func TestInvitacionesDelEquipo(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	created := admin.post("/api/users", map[string]string{
		"name": "Josefina", "email": "jose@acapelius.test", "role": "seller",
	})
	assertStatus(t, created, http.StatusCreated)
	userID := created.Body["user"].(map[string]any)["id"].(float64)

	// Recien creada: nunca entro, la invitacion esta pendiente.
	if created.Body["user"].(map[string]any)["last_login_at"] != nil {
		t.Fatalf("una usuaria nueva no puede tener ultimo ingreso: %v", created.Body["user"])
	}
	// El alta manda la invitacion con la clave provisoria (driver log en test).
	if created.Body["email_status"] != "sent" {
		t.Fatalf("el alta tendria que mandar la invitacion: %v", created.Body["email_status"])
	}
	tempPassword := created.Body["temp_password"].(string)
	if !strings.Contains(env.emailLog.String(), tempPassword) {
		t.Fatalf("el email de invitacion tendria que llevar la clave provisoria")
	}

	// Reenviar la invitacion: clave nueva, la vieja deja de servir.
	resent := admin.post(fmt.Sprintf("/api/users/%.0f/resend-invite", userID), nil)
	assertStatus(t, resent, http.StatusOK)
	newPassword := resent.Body["temp_password"].(string)
	if newPassword == tempPassword {
		t.Fatalf("el reenvio tendria que generar una clave nueva")
	}
	assertErrorCode(t, env.client(t).post("/api/auth/login", map[string]string{
		"email": "jose@acapelius.test", "password": tempPassword,
	}), http.StatusUnauthorized, "invalid_credentials")

	// Primer ingreso: la invitacion deja de estar pendiente.
	josefina := env.client(t)
	login := josefina.post("/api/auth/login", map[string]string{
		"email": "jose@acapelius.test", "password": newPassword,
	})
	assertStatus(t, login, http.StatusOK)
	if login.Body["user"].(map[string]any)["last_login_at"] == nil {
		t.Fatalf("despues del login tiene que quedar registrado el ingreso")
	}

	var josefinaRow map[string]any
	for _, raw := range admin.get("/api/users").Body["users"].([]any) {
		if u := raw.(map[string]any); u["email"] == "jose@acapelius.test" {
			josefinaRow = u
		}
	}
	if josefinaRow == nil || josefinaRow["last_login_at"] == nil {
		t.Fatalf("el listado tendria que mostrarla como ya ingresada: %v", josefinaRow)
	}

	// Ya entro: reenviar la invitacion no corresponde, se resetea la clave.
	assertErrorCode(t, admin.post(fmt.Sprintf("/api/users/%.0f/resend-invite", userID), nil),
		http.StatusConflict, "conflict")

	reset := admin.post(fmt.Sprintf("/api/users/%.0f/reset-password", userID), nil)
	assertStatus(t, reset, http.StatusOK)
	resetPassword := reset.Body["temp_password"].(string)
	// El reseteo no borra el historial de ingresos: sigue sin estar pendiente.
	if reset.Body["user"].(map[string]any)["last_login_at"] == nil {
		t.Fatalf("resetear la clave no tendria que borrar el ultimo ingreso")
	}
	// Y la clave nueva sirve, pidiendo elegir una propia.
	fresh := env.client(t)
	relogin := fresh.post("/api/auth/login", map[string]string{
		"email": "jose@acapelius.test", "password": resetPassword,
	})
	assertStatus(t, relogin, http.StatusOK)
	if relogin.Body["user"].(map[string]any)["must_change_password"] != true {
		t.Fatalf("tras el reseteo tiene que elegir contrasena nueva: %v", relogin.Body["user"])
	}

	// Nadie que no sea direccion toca invitaciones.
	seller := createSellerClient(t, env, admin, "Valeria", "vale@acapelius.test")
	assertErrorCode(t, seller.post(fmt.Sprintf("/api/users/%.0f/reset-password", userID), nil),
		http.StatusForbidden, "forbidden")
	assertErrorCode(t, admin.post("/api/users/999/reset-password", nil), http.StatusNotFound, "not_found")
}
