package httpapi_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// TestCorregirDatosDeLaVenta: solo direccion corrige a nombre de quien esta
// una venta o la pasa a otra funcion. Las entradas (y sus QR) son las mismas,
// el mail sale de nuevo avisando el cambio, y la puerta de la funcion vieja
// deja de aceptarlas.
func TestCorregirDatosDeLaVenta(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 5)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 5)

	otra := admin.post("/api/functions", map[string]any{
		"season_id": activeSeasonID(t, admin), "venue": "Teatro Municipal",
		"starts_at": "2099-12-17T21:00:00-03:00", "capacity": 2, "price_cents": 800000,
	})
	assertStatus(t, otra, http.StatusCreated)
	otraID := otra.Body["function"].(map[string]any)["id"].(float64)

	created := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Pablo Picatto",
		"buyer_email": "p.picatto@gmail.com", "buyer_phone": "11 5555-1234", "quantity": 2,
	})
	assertStatus(t, created, http.StatusCreated)
	sale := created.Body["sale"].(map[string]any)
	saleID := sale["id"].(float64)
	ticketCode := created.Body["tickets"].([]any)[0].(map[string]any)["code"].(string)
	path := fmt.Sprintf("/api/sales/%.0f/details", saleID)

	// El mail ya trae el detalle de la compra, con el telefono.
	for _, want := range []string{"Detalle de tu compra", "11 5555-1234", "Carolina", "Falta pagar"} {
		if !strings.Contains(env.emailLog.String(), want) {
			t.Fatalf("el mail no trae %q", want)
		}
	}

	// La corista no puede corregir, ni su propia venta.
	assertStatus(t, seller.do(http.MethodPatch, path, map[string]any{
		"buyer_name": "Pablo Picatti", "buyer_email": "p.picatti@gmail.com",
	}), http.StatusForbidden)

	// Direccion corrige el nombre y el telefono: no hace falta mandar mail.
	fixed := admin.do(http.MethodPatch, path, map[string]any{
		"buyer_name": "Pablo Picatti", "buyer_email": "p.picatto@gmail.com", "buyer_phone": "11 4444-0000",
	})
	assertStatus(t, fixed, http.StatusOK)
	if fixed.Body["email_status"] != "" {
		t.Fatalf("sin cambio de mail ni de funcion no se manda nada: %v", fixed.Body["email_status"])
	}
	if s := fixed.Body["sale"].(map[string]any); s["buyer_name"] != "Pablo Picatti" || s["buyer_phone"] != "11 4444-0000" {
		t.Fatalf("no se guardo la correccion: %v", s)
	}

	// El listado trae el telefono para la ficha.
	list := admin.get("/api/sales")
	assertStatus(t, list, http.StatusOK)
	if row := list.Body["sales"].([]any)[0].(map[string]any); row["buyer_phone"] != "11 4444-0000" {
		t.Fatalf("el listado no trae el telefono: %v", row)
	}

	// Pasarla a otra funcion: mismo QR, mail con el aviso del cambio.
	before := len(env.emailLog.String())
	moved := admin.do(http.MethodPatch, path, map[string]any{
		"buyer_name": "Pablo Picatti", "buyer_email": "p.picatto@gmail.com", "function_id": otraID,
	})
	assertStatus(t, moved, http.StatusOK)
	if moved.Body["email_status"] != "sent" {
		t.Fatalf("con cambio de funcion sale el mail: %v", moved.Body["email_status"])
	}
	if mail := env.emailLog.String()[before:]; !strings.Contains(mail, "Cambiamos la fecha") {
		t.Fatalf("el mail no avisa el cambio:\n%s", mail)
	}

	payload := admin.get("/api/public/sales/" + sale["code"].(string)).Body["tickets"].([]any)[0].(map[string]any)["payload"]
	if code, _ := env.signer.Verify(payload.(string)); code != ticketCode {
		t.Fatalf("el QR tendria que ser el mismo")
	}

	// La puerta vieja ya no la acepta; la nueva si.
	vieja := admin.post("/api/checkins", map[string]any{"function_id": fnID, "payload": payload, "method": "scan"})
	if vieja.Body["result"] == "ok" {
		t.Fatalf("la funcion vieja no tendria que aceptar la entrada: %v", vieja.Body)
	}
	nueva := admin.post("/api/checkins", map[string]any{"function_id": otraID, "payload": payload, "method": "scan"})
	if nueva.Body["result"] != "ok" {
		t.Fatalf("la funcion nueva tendria que aceptarla: %v", nueva.Body)
	}

	// Con una entrada ya ingresada, no se puede volver a mover.
	assertErrorCode(t, admin.do(http.MethodPatch, path, map[string]any{
		"buyer_name": "Pablo Picatti", "buyer_email": "p.picatto@gmail.com", "function_id": fnID,
	}), http.StatusConflict, "conflict")
}

// TestPasarDeFuncionRespetaElCupo: si en la funcion nueva no hay lugar, no
// pasa, salvo que direccion lo pida sobre cupo.
func TestPasarDeFuncionRespetaElCupo(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 5)
	chica := admin.post("/api/functions", map[string]any{
		"season_id": activeSeasonID(t, admin), "venue": "Sala chica",
		"starts_at": "2099-12-17T21:00:00-03:00", "capacity": 1, "price_cents": 800000,
	})
	assertStatus(t, chica, http.StatusCreated)
	chicaID := chica.Body["function"].(map[string]any)["id"].(float64)

	created := admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Ana", "buyer_email": "ana@prueba.test", "quantity": 2,
	})
	assertStatus(t, created, http.StatusCreated)
	path := fmt.Sprintf("/api/sales/%.0f/details", created.Body["sale"].(map[string]any)["id"].(float64))

	body := map[string]any{"buyer_name": "Ana", "buyer_email": "ana@prueba.test", "function_id": chicaID}
	assertErrorCode(t, admin.do(http.MethodPatch, path, body), http.StatusConflict, "no_capacity")

	body["over_capacity"] = true
	ok := admin.do(http.MethodPatch, path, body)
	assertStatus(t, ok, http.StatusOK)
	if ok.Body["sale"].(map[string]any)["over_capacity"] != true {
		t.Fatalf("tendria que quedar marcada sobre cupo: %v", ok.Body["sale"])
	}
}
