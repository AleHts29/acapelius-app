package httpapi_test

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// createDoorClient crea un usuario de puerta y devuelve el cliente logueado.
func createDoorClient(t *testing.T, env *testEnv, admin *testClient) *testClient {
	t.Helper()

	created := admin.post("/api/users", map[string]string{
		"name": "Recepcion", "email": "puerta@acapelius.test", "role": "door",
	})
	assertStatus(t, created, http.StatusCreated)
	temp, _ := created.Body["temp_password"].(string)

	door := env.client(t)
	assertStatus(t, door.post("/api/auth/login", map[string]string{
		"email": "puerta@acapelius.test", "password": temp,
	}), http.StatusOK)
	assertStatus(t, door.post("/api/auth/change-password", map[string]string{
		"current_password": temp, "new_password": "abro-la-puerta",
	}), http.StatusOK)
	return door
}

// sellTickets registra una venta y devuelve los codigos de sus tickets.
func sellTickets(t *testing.T, seller *testClient, fnID float64, buyer string, qty int) []string {
	t.Helper()

	created := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": buyer, "quantity": qty,
	})
	assertStatus(t, created, http.StatusCreated)
	tickets := created.Body["tickets"].([]any)
	codes := make([]string, 0, qty)
	for _, raw := range tickets {
		codes = append(codes, raw.(map[string]any)["code"].(string))
	}
	return codes
}

// TestAceptacionFase3 sigue el criterio de la spec: escanear → verde;
// re-escanear → rojo con la hora del primer ingreso; buscar y marcar manual.
func TestAceptacionFase3(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)

	codes := sellTickets(t, seller, fnID, "Maria Dutra", 2)

	// 1. Escanear el QR firmado → verde, con nombre y vendedora.
	payload := env.signer.Payload(codes[0])
	first := door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "scan", "payload": payload,
	})
	assertStatus(t, first, http.StatusOK)
	if first.Body["result"] != "ok" {
		t.Fatalf("primer escaneo tendria que ser ok: %v", first.Body)
	}
	if first.Body["buyer_name"] != "Maria Dutra" || first.Body["seller_name"] != "Carolina" {
		t.Fatalf("faltan datos en el verde: %v", first.Body)
	}

	// 2. Re-escanear el mismo QR → rojo con hora y quien lo marco.
	second := door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "scan", "payload": payload,
	})
	assertStatus(t, second, http.StatusOK)
	if second.Body["result"] != "already_checked_in" {
		t.Fatalf("re-escaneo tendria que dar already_checked_in: %v", second.Body)
	}
	if second.Body["checked_in_at"] == nil || second.Body["by_name"] != "Recepcion" {
		t.Fatalf("el rojo tiene que decir cuando y quien: %v", second.Body)
	}

	// 3. Busqueda manual: la puerta encuentra el segundo ticket en el snapshot
	// y lo marca con un tap (method manual).
	snapshot := door.get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID))
	assertStatus(t, snapshot, http.StatusOK)
	tickets := snapshot.Body["tickets"].([]any)
	if len(tickets) != 2 {
		t.Fatalf("el snapshot tendria que traer 2 tickets: %v", snapshot.Body)
	}
	var pendingCode string
	for _, raw := range tickets {
		ticket := raw.(map[string]any)
		if ticket["buyer_name"] == "Maria Dutra" && ticket["status"] == "issued" {
			pendingCode = ticket["code"].(string)
		}
	}
	if pendingCode == "" {
		t.Fatalf("no se encontro el ticket pendiente de Maria: %v", tickets)
	}

	manual := door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "manual", "code": pendingCode,
	})
	assertStatus(t, manual, http.StatusOK)
	if manual.Body["result"] != "ok" {
		t.Fatalf("el manual tendria que ser ok: %v", manual.Body)
	}

	// 4. El snapshot refleja los dos ingresos (contador 2/2).
	after := door.get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID))
	checkins := after.Body["checkins"].([]any)
	if len(checkins) != 2 {
		t.Fatalf("tendria que haber 2 check-ins, hay %d", len(checkins))
	}
	methods := map[string]bool{}
	for _, raw := range checkins {
		methods[raw.(map[string]any)["method"].(string)] = true
	}
	if !methods["scan"] || !methods["manual"] {
		t.Fatalf("tendria que haber un scan y un manual: %v", checkins)
	}
}

func TestCheckinRechazaQRAjenos(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)

	codes := sellTickets(t, seller, fnID, "Maria", 1)

	// Firma adulterada → invalid.
	tampered := door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "scan", "payload": codes[0] + ".firma-trucha",
	})
	assertStatus(t, tampered, http.StatusOK)
	if tampered.Body["result"] != "invalid" {
		t.Fatalf("firma trucha tendria que dar invalid: %v", tampered.Body)
	}

	// QR de otro sistema (payload arbitrario) → invalid.
	foreign := door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "scan", "payload": "https://otra-cosa.example.com",
	})
	if foreign.Body["result"] != "invalid" {
		t.Fatalf("payload ajeno tendria que dar invalid: %v", foreign.Body)
	}

	// Codigo manual inexistente → invalid.
	ghost := door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "manual", "code": "NO-EXISTE",
	})
	if ghost.Body["result"] != "invalid" {
		t.Fatalf("codigo inexistente tendria que dar invalid: %v", ghost.Body)
	}
}

func TestCheckinOtraFuncionYAnulados(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)

	// Segunda funcion en la misma temporada.
	fn2 := admin.post("/api/functions", map[string]any{
		"season_id": 1, "venue": "Teatro Municipal",
		"starts_at": "2026-12-11T21:00:00-03:00", "capacity": 50, "price_cents": 800000,
	})
	fn2ID := fn2.Body["function"].(map[string]any)["id"].(float64)

	codes := sellTickets(t, seller, fnID, "Maria", 1)
	payload := env.signer.Payload(codes[0])

	// Entrada valida pero de otra funcion → rojo wrong_function.
	wrong := door.post("/api/checkins", map[string]any{
		"function_id": fn2ID, "method": "scan", "payload": payload,
	})
	if wrong.Body["result"] != "wrong_function" || wrong.Body["buyer_name"] != "Maria" {
		t.Fatalf("otra funcion tendria que dar wrong_function con nombre: %v", wrong.Body)
	}

	// Venta anulada → rojo void.
	voidedSale := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Anulada", "quantity": 1,
	})
	voidedSaleID := voidedSale.Body["sale"].(map[string]any)["id"].(float64)
	voidedCode := voidedSale.Body["tickets"].([]any)[0].(map[string]any)["code"].(string)
	assertStatus(t, admin.post(fmt.Sprintf("/api/sales/%.0f/void", voidedSaleID), nil), http.StatusOK)

	dead := door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "scan", "payload": env.signer.Payload(voidedCode),
	})
	if dead.Body["result"] != "void" {
		t.Fatalf("ticket anulado tendria que dar void: %v", dead.Body)
	}
}

func TestCheckinConcurrenteDelMismoTicket(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)

	codes := sellTickets(t, seller, fnID, "Maria", 1)
	payload := env.signer.Payload(codes[0])

	// Dos dispositivos escanean el mismo ticket a la vez: exactamente uno ok.
	var wg sync.WaitGroup
	results := make([]string, 2)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := door.post("/api/checkins", map[string]any{
				"function_id": fnID, "method": "scan", "payload": payload,
			})
			results[i], _ = resp.Body["result"].(string)
		}()
	}
	wg.Wait()

	joined := strings.Join(results, ",")
	if !(strings.Contains(joined, "ok") && strings.Contains(joined, "already_checked_in")) {
		t.Fatalf("se esperaba un ok y un already_checked_in, hubo %v", results)
	}
}

func TestCheckinBloqueaAnulacionYEdicion(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)

	created := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria", "quantity": 1,
	})
	saleID := created.Body["sale"].(map[string]any)["id"].(float64)
	code := created.Body["tickets"].([]any)[0].(map[string]any)["code"].(string)

	assertStatus(t, door.post("/api/checkins", map[string]any{
		"function_id": fnID, "method": "scan", "payload": env.signer.Payload(code),
	}), http.StatusOK)

	// Con un ingreso registrado: la venta no se anula...
	assertErrorCode(t, admin.post(fmt.Sprintf("/api/sales/%.0f/void", saleID), nil),
		http.StatusConflict, "conflict")

	// ...y la funcion no se edita mas (spec §5.1).
	assertErrorCode(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"venue": "Otro teatro"}), http.StatusConflict, "conflict")
}

func TestSnapshotSinMontosYAutorizacion(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 50)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	door := createDoorClient(t, env, admin)
	sellTickets(t, seller, fnID, "Maria", 1)

	// El snapshot no expone plata ni contacto.
	snapshot := door.get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID))
	assertStatus(t, snapshot, http.StatusOK)
	raw := fmt.Sprintf("%v", snapshot.Body)
	for _, banned := range []string{"amount", "price", "payment", "email", "phone"} {
		if strings.Contains(raw, banned) {
			t.Fatalf("el snapshot no debe incluir %q: %v", banned, snapshot.Body)
		}
	}

	// La vendedora tambien puede operar la puerta (nota de roles, spec §3)...
	assertStatus(t, seller.get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID)), http.StatusOK)

	// ...pero sin sesion no entra nadie.
	assertErrorCode(t, env.client(t).get(fmt.Sprintf("/api/functions/%.0f/door-snapshot", fnID)),
		http.StatusUnauthorized, "unauthenticated")

	// Y la puerta sigue sin poder tocar ventas.
	assertErrorCode(t, door.get("/api/sales"), http.StatusForbidden, "forbidden")
}
