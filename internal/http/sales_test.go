package httpapi_test

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// assignQuota le asigna cupo a una corista para una funcion (C8: sin cupo,
// una corista no puede vender).
func assignQuota(t *testing.T, admin *testClient, fnID float64, userID, qty int) {
	t.Helper()
	resp := admin.do(http.MethodPut, fmt.Sprintf("/api/functions/%.0f/allocations", fnID),
		map[string]any{"allocations": []map[string]any{{"user_id": userID, "quantity": qty}}})
	assertStatus(t, resp, http.StatusOK)
}

// setupCatalog crea una temporada con una funcion y devuelve el id de la
// funcion. Requiere un admin logueado.
func setupCatalog(t *testing.T, admin *testClient, capacity int) float64 {
	t.Helper()

	season := admin.post("/api/seasons", map[string]string{"name": "Temporada 2026"})
	assertStatus(t, season, http.StatusCreated)
	seasonID := season.Body["season"].(map[string]any)["id"].(float64)

	fn := admin.post("/api/functions", map[string]any{
		"season_id":   seasonID,
		"venue":       "Teatro Municipal",
		"starts_at":   "2026-12-10T21:00:00-03:00",
		"capacity":    capacity,
		"price_cents": 800000,
	})
	assertStatus(t, fn, http.StatusCreated)
	return fn.Body["function"].(map[string]any)["id"].(float64)
}

// TestAceptacionFase2 sigue el criterio de la spec: una vendedora registra una
// venta de 3 entradas; llega email (driver log) con 3 QRs; la pagina publica
// renderiza; una venta que excede cupo se rechaza; una cortesia no suma deuda.
func TestAceptacionFase2(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 5)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 5)

	// 1. La vendedora registra una venta de 3 con email.
	created := seller.post("/api/sales", map[string]any{
		"function_id": fnID,
		"buyer_name":  "Maria Dutra",
		"buyer_email": "maria@gmail.com",
		"quantity":    3,
	})
	assertStatus(t, created, http.StatusCreated)

	sale := created.Body["sale"].(map[string]any)
	tickets := created.Body["tickets"].([]any)
	if len(tickets) != 3 {
		t.Fatalf("se esperaban 3 tickets, hay %d", len(tickets))
	}
	if sale["amount_cents"].(float64) != 2400000 {
		t.Fatalf("monto congelado incorrecto: %v", sale["amount_cents"])
	}
	if created.Body["email_status"] != "sent" {
		t.Fatalf("el email tendria que haberse mandado: %v", created.Body["email_status"])
	}
	publicURL, _ := created.Body["public_url"].(string)
	if !strings.Contains(publicURL, "/e/") {
		t.Fatalf("public_url rara: %q", publicURL)
	}

	// 2. El email quedo en el driver log, con sus 3 QR adjuntos.
	emailOut := env.emailLog.String()
	for _, want := range []string{"maria@gmail.com", "entrada-1-de-3.png", "entrada-3-de-3.png", "Teatro Municipal"} {
		if !strings.Contains(emailOut, want) {
			t.Fatalf("el email logueado no contiene %q:\n%s", want, emailOut)
		}
	}

	// 3. La pagina publica responde sin sesion, con un payload firmado por QR.
	saleCode := sale["code"].(string)
	anonymous := env.client(t)
	pub := anonymous.get("/api/public/sales/" + saleCode)
	assertStatus(t, pub, http.StatusOK)
	if pub.Body["buyer_name"] != "Maria Dutra" || pub.Body["seller_name"] != "Carolina" {
		t.Fatalf("datos publicos incompletos: %v", pub.Body)
	}
	pubTickets := pub.Body["tickets"].([]any)
	if len(pubTickets) != 3 {
		t.Fatalf("la pagina publica tendria que listar 3 entradas: %v", pub.Body)
	}
	for _, raw := range pubTickets {
		ticket := raw.(map[string]any)
		payload, _ := ticket["payload"].(string)
		code, ok := env.signer.Verify(payload)
		if !ok || code != ticket["code"] {
			t.Fatalf("payload invalido para el ticket %v", ticket)
		}
	}
	// No filtra datos sensibles.
	if _, has := pub.Body["amount_cents"]; has {
		t.Fatal("la pagina publica no debe exponer montos")
	}

	// 4. El PNG publico del QR responde.
	png := anonymous.get("/api/public/tickets/" + pubTickets[0].(map[string]any)["code"].(string) + ".png")
	assertStatus(t, png, http.StatusOK)

	// 5. Una venta que excede el cupo (quedan 2 de 5) se rechaza.
	rejected := seller.post("/api/sales", map[string]any{
		"function_id": fnID,
		"buyer_name":  "Pedro",
		"quantity":    3,
	})
	assertErrorCode(t, rejected, http.StatusConflict, "conflict")

	// 6. Una cortesia del admin no suma deuda (monto 0) y ocupa cupo.
	comp := admin.post("/api/sales", map[string]any{
		"function_id": fnID,
		"buyer_name":  "Invitado de Eli",
		"quantity":    2,
		"is_comp":     true,
	})
	assertStatus(t, comp, http.StatusCreated)
	if comp.Body["sale"].(map[string]any)["amount_cents"].(float64) != 0 {
		t.Fatalf("una cortesia vale 0: %v", comp.Body)
	}
	if comp.Body["email_status"] != "none" {
		t.Fatalf("sin email no hay envio: %v", comp.Body["email_status"])
	}

	// El cupo quedo lleno (3 + 2 = 5): ni una entrada mas.
	full := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Tarde", "quantity": 1,
	})
	assertErrorCode(t, full, http.StatusConflict, "conflict")
}

func TestCupoBajoConcurrencia(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 5)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 5)

	// Dos ventas de 3 sobre un cupo de 5, disparadas a la vez: exactamente
	// una tiene que entrar.
	var wg sync.WaitGroup
	results := make([]int, 2)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := seller.post("/api/sales", map[string]any{
				"function_id": fnID,
				"buyer_name":  fmt.Sprintf("Comprador %d", i),
				"quantity":    3,
			})
			results[i] = resp.Status
		}()
	}
	wg.Wait()

	ok, conflict := 0, 0
	for _, status := range results {
		switch status {
		case http.StatusCreated:
			ok++
		case http.StatusConflict:
			conflict++
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("se esperaba 1 creada y 1 rechazada, hubo %v", results)
	}
}

func TestPagosDeVenta(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 10)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 10)

	created := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria", "quantity": 2,
	})
	assertStatus(t, created, http.StatusCreated)
	saleID := created.Body["sale"].(map[string]any)["id"].(float64)
	path := fmt.Sprintf("/api/sales/%.0f", saleID)

	// paid sin metodo → 400.
	assertErrorCode(t, seller.do(http.MethodPatch, path, map[string]string{
		"payment_status": "paid",
	}), http.StatusBadRequest, "validation_error")

	// paid con transferencia → 200.
	paid := seller.do(http.MethodPatch, path, map[string]string{
		"payment_status": "paid", "payment_method": "transfer",
	})
	assertStatus(t, paid, http.StatusOK)
	if paid.Body["sale"].(map[string]any)["payment_method"] != "transfer" {
		t.Fatalf("metodo no guardado: %v", paid.Body)
	}

	// Volver a pending limpia el metodo.
	pending := seller.do(http.MethodPatch, path, map[string]string{"payment_status": "pending"})
	assertStatus(t, pending, http.StatusOK)
	if pending.Body["sale"].(map[string]any)["payment_method"] != nil {
		t.Fatalf("el metodo tendria que quedar null: %v", pending.Body)
	}

	// Una cortesia no admite pagos.
	comp := admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Invitado", "quantity": 1, "is_comp": true,
	})
	compPath := fmt.Sprintf("/api/sales/%.0f", comp.Body["sale"].(map[string]any)["id"].(float64))
	assertErrorCode(t, admin.do(http.MethodPatch, compPath, map[string]string{
		"payment_status": "paid", "payment_method": "cash",
	}), http.StatusBadRequest, "validation_error")
}

func TestReenvioDeEmail(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 10)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 10)

	// Venta sin email: reenviar da 400.
	noEmail := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Sin Mail", "quantity": 1,
	})
	noEmailID := noEmail.Body["sale"].(map[string]any)["id"].(float64)
	assertErrorCode(t, seller.post(fmt.Sprintf("/api/sales/%.0f/resend-email", noEmailID), nil),
		http.StatusBadRequest, "validation_error")

	// Venta con email: el reenvio manda de nuevo y queda registrado.
	withEmail := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria", "buyer_email": "maria@gmail.com", "quantity": 1,
	})
	withEmailID := withEmail.Body["sale"].(map[string]any)["id"].(float64)
	resent := seller.post(fmt.Sprintf("/api/sales/%.0f/resend-email", withEmailID), nil)
	assertStatus(t, resent, http.StatusOK)
	if resent.Body["email_status"] != "sent" {
		t.Fatalf("reenvio fallido: %v", resent.Body)
	}

	var sends int
	row := env.pool.QueryRow(t.Context(),
		"SELECT count(*) FROM email_sends WHERE sale_id = $1", int64(withEmailID))
	if err := row.Scan(&sends); err != nil {
		t.Fatalf("contar envios: %v", err)
	}
	if sends != 2 { // alta + reenvio
		t.Fatalf("se esperaban 2 envios registrados, hay %d", sends)
	}
}

func TestAnulaciones(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 3)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 3)

	created := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria", "quantity": 3,
	})
	assertStatus(t, created, http.StatusCreated)
	saleID := created.Body["sale"].(map[string]any)["id"].(float64)

	// Cupo lleno.
	assertErrorCode(t, seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Otro", "quantity": 1,
	}), http.StatusConflict, "conflict")

	// La vendedora no puede anular; el admin si.
	assertErrorCode(t, seller.post(fmt.Sprintf("/api/sales/%.0f/void", saleID), nil),
		http.StatusForbidden, "forbidden")
	voided := admin.post(fmt.Sprintf("/api/sales/%.0f/void", saleID), nil)
	assertStatus(t, voided, http.StatusOK)
	if voided.Body["sale"].(map[string]any)["voided_at"] == nil {
		t.Fatalf("voided_at vacio: %v", voided.Body)
	}

	// Anular libero el cupo: entran 3 de nuevo.
	again := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Nueva", "quantity": 3,
	})
	assertStatus(t, again, http.StatusCreated)

	// La venta anulada no acepta pagos ni reenvios.
	path := fmt.Sprintf("/api/sales/%.0f", saleID)
	assertErrorCode(t, seller.do(http.MethodPatch, path, map[string]string{
		"payment_status": "paid", "payment_method": "cash",
	}), http.StatusConflict, "conflict")

	// Anular un ticket suelto libera una sola entrada.
	newSaleTickets := again.Body["tickets"].([]any)
	ticketID := newSaleTickets[0].(map[string]any)["id"].(float64)
	assertStatus(t, admin.post(fmt.Sprintf("/api/tickets/%.0f/void", ticketID), nil), http.StatusOK)

	one := seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Ultima", "quantity": 1,
	})
	assertStatus(t, one, http.StatusCreated)

	// La pagina publica de la venta anulada lo dice.
	saleCode := created.Body["sale"].(map[string]any)["code"].(string)
	pub := env.client(t).get("/api/public/sales/" + saleCode)
	assertStatus(t, pub, http.StatusOK)
	if pub.Body["voided"] != true {
		t.Fatalf("la venta anulada tendria que marcarse: %v", pub.Body)
	}
}

func TestAutorizacionDeVentas(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 10)

	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	valeria := createSellerClient(t, env, admin, "Valeria", "vale@acapelius.test")
	assignQuota(t, admin, fnID, 2, 5)

	sale := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria", "quantity": 1,
	})
	saleID := sale.Body["sale"].(map[string]any)["id"].(float64)
	path := fmt.Sprintf("/api/sales/%.0f", saleID)

	// Valeria no ve la venta de Carolina en su listado...
	list := valeria.get("/api/sales")
	assertStatus(t, list, http.StatusOK)
	if got := len(list.Body["sales"].([]any)); got != 0 {
		t.Fatalf("Valeria no tendria que ver ventas ajenas, ve %d", got)
	}

	// ...ni puede operar sobre ella.
	assertErrorCode(t, valeria.do(http.MethodPatch, path, map[string]string{
		"payment_status": "paid", "payment_method": "cash",
	}), http.StatusForbidden, "forbidden")
	assertErrorCode(t, valeria.post(path+"/resend-email", nil), http.StatusForbidden, "forbidden")

	// El admin ve todo; con mine=1 filtra lo propio.
	adminList := admin.get("/api/sales")
	if got := len(adminList.Body["sales"].([]any)); got != 1 {
		t.Fatalf("el admin tendria que ver 1 venta, ve %d", got)
	}
	mineList := admin.get("/api/sales?mine=1")
	if got := len(mineList.Body["sales"].([]any)); got != 0 {
		t.Fatalf("el admin no vendio nada propio, ve %d", got)
	}

	// Una vendedora no emite cortesias.
	assertErrorCode(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Cuela", "quantity": 1, "is_comp": true,
	}), http.StatusForbidden, "forbidden")

	// El rol puerta no toca ventas.
	doorCreated := admin.post("/api/users", map[string]string{
		"name": "Puerta", "email": "puerta@acapelius.test", "role": "door",
	})
	doorTemp, _ := doorCreated.Body["temp_password"].(string)
	door := env.client(t)
	assertStatus(t, door.post("/api/auth/login", map[string]string{
		"email": "puerta@acapelius.test", "password": doorTemp,
	}), http.StatusOK)
	assertStatus(t, door.post("/api/auth/change-password", map[string]string{
		"current_password": doorTemp, "new_password": "abro-la-puerta",
	}), http.StatusOK)
	assertErrorCode(t, door.get("/api/sales"), http.StatusForbidden, "forbidden")
}

func TestCupoDeFuncionNoBajaDeLoVendido(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 10)
	seller := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	assignQuota(t, admin, fnID, 2, 4)

	assertStatus(t, seller.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Maria", "quantity": 4,
	}), http.StatusCreated)

	// Bajar el cupo a 3 con 4 vendidas → 409.
	assertErrorCode(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"capacity": 3}), http.StatusConflict, "conflict")

	// Bajarlo a 4 (justo lo vendido) esta bien.
	assertStatus(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"capacity": 4}), http.StatusOK)
}

// TestCobrosParciales: una venta se puede cobrar en varias veces. El saldo, el
// estado y lo que ven los reportes salen siempre del historial de cobros.
func TestCobrosParciales(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 80)
	corista := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test") // user 2
	assertStatus(t, admin.do(http.MethodPut, fmt.Sprintf("/api/functions/%.0f/allocations", fnID),
		map[string]any{"allocations": []map[string]any{{"user_id": 2, "quantity": 10}}}), http.StatusOK)

	venta := corista.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Fran Sponton", "quantity": 3,
	})
	assertStatus(t, venta, http.StatusCreated)
	saleID := venta.Body["sale"].(map[string]any)["id"].(float64)
	total := venta.Body["sale"].(map[string]any)["amount_cents"].(float64)
	pagos := fmt.Sprintf("/api/sales/%.0f/payments", saleID)

	estado := func() (paid float64, status string) {
		t.Helper()
		resp := corista.get(pagos)
		assertStatus(t, resp, http.StatusOK)
		s := resp.Body["sale"].(map[string]any)
		return s["paid_cents"].(float64), s["payment_status"].(string)
	}

	// Una seña: la venta sigue pendiente pero ya tiene plata cobrada.
	assertStatus(t, corista.post(pagos, map[string]any{
		"amount_cents": total / 3, "method": "cash",
	}), http.StatusOK)
	paid, status := estado()
	if paid != total/3 || status != "pending" {
		t.Fatalf("tras la seña: cobrado %v estado %q (esperaba %v / pending)", paid, status, total/3)
	}

	// Cobrar de mas no se acepta: eso es una vuelta, no un cobro de la venta.
	assertStatus(t, corista.post(pagos, map[string]any{
		"amount_cents": total, "method": "cash",
	}), http.StatusBadRequest)

	// El resto por transferencia: queda paga, y el metodo es el del ultimo cobro.
	assertStatus(t, corista.post(pagos, map[string]any{
		"amount_cents": total - total/3, "method": "transfer",
	}), http.StatusOK)
	paid, status = estado()
	if paid != total || status != "paid" {
		t.Fatalf("tras cobrar todo: cobrado %v estado %q", paid, status)
	}

	// El resumen de ventas cuenta lo cobrado de verdad, no el total de la venta.
	resumen := corista.get("/api/sales").Body["summary"].(map[string]any)
	if resumen["paid_cents"].(float64) != total || resumen["pending_cents"].(float64) != 0 {
		t.Fatalf("resumen: cobrado %v, por cobrar %v", resumen["paid_cents"], resumen["pending_cents"])
	}

	// Rendiciones ve la misma plata: lo que la corista tiene en la mano.
	rend := admin.get("/api/reports/settlements?season_id=1")
	assertStatus(t, rend, http.StatusOK)
	for _, raw := range rend.Body["rows"].([]any) {
		row := raw.(map[string]any)
		if row["seller_name"] != "Carolina" {
			continue
		}
		if row["collected_cents"].(float64) != total || row["pending_cents"].(float64) != 0 {
			t.Fatalf("rendiciones: cobrado %v, por cobrar %v (esperaba %v / 0)",
				row["collected_cents"], row["pending_cents"], total)
		}
	}

	// Quitar un cobro mal cargado devuelve la venta a pendiente por esa parte.
	historial := corista.get(pagos).Body["payments"].([]any)
	if len(historial) != 2 {
		t.Fatalf("tendria que haber 2 cobros, hay %d", len(historial))
	}
	primero := historial[0].(map[string]any)["id"].(float64)
	assertStatus(t, corista.do(http.MethodDelete,
		fmt.Sprintf("%s/%.0f", pagos, primero), nil), http.StatusOK)
	paid, status = estado()
	if paid != total-total/3 || status != "pending" {
		t.Fatalf("tras quitar un cobro: cobrado %v estado %q", paid, status)
	}

	// "Marcar pagó" cobra lo que falta y queda anotado en el historial.
	assertStatus(t, corista.do(http.MethodPatch, fmt.Sprintf("/api/sales/%.0f", saleID),
		map[string]any{"payment_status": "paid", "payment_method": "cash"}), http.StatusOK)
	paid, status = estado()
	if paid != total || status != "paid" {
		t.Fatalf("tras marcar pago: cobrado %v estado %q", paid, status)
	}
	if n := len(corista.get(pagos).Body["payments"].([]any)); n != 2 {
		t.Fatalf("el atajo tendria que dejar rastro: hay %d cobros", n)
	}

	// "Volver a pendiente" borra los cobros de esa venta.
	assertStatus(t, corista.do(http.MethodPatch, fmt.Sprintf("/api/sales/%.0f", saleID),
		map[string]any{"payment_status": "pending"}), http.StatusOK)
	paid, status = estado()
	if paid != 0 || status != "pending" {
		t.Fatalf("tras volver a pendiente: cobrado %v estado %q", paid, status)
	}
	if n := len(corista.get(pagos).Body["payments"].([]any)); n != 0 {
		t.Fatalf("no tendria que quedar ningun cobro, quedan %d", n)
	}

	// Una cortesia no admite cobros.
	comp := admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Padre Benítez", "quantity": 1, "is_comp": true,
	})
	assertStatus(t, comp, http.StatusCreated)
	compID := comp.Body["sale"].(map[string]any)["id"].(float64)
	assertStatus(t, admin.post(fmt.Sprintf("/api/sales/%.0f/payments", compID),
		map[string]any{"amount_cents": 100, "method": "cash"}), http.StatusBadRequest)
}
