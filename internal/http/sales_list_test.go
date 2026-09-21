package httpapi_test

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// TestListadoEscalable cubre C3 del lado del server: busqueda por comprador
// y corista sin acentos, filtros de estado, resumen y paginacion por cursor.
func TestListadoEscalable(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 500)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	createSellerClient(t, env, admin, "Josefina", "jose@acapelius.test")
	assignQuota(t, admin, fnID, 2, 200)

	// 55 ventas de Carolina (fuerza una segunda pagina con page size 50)...
	for i := range 55 {
		assertStatus(t, carolina.post("/api/sales", map[string]any{
			"function_id": fnID, "buyer_name": fmt.Sprintf("Compradora %02d", i), "quantity": 1,
		}), http.StatusCreated)
	}
	// ...una compradora con acento que matchea la busqueda "caro"...
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Cárola Vega", "quantity": 2,
	}), http.StatusCreated)
	// ...una paga y una cortesia de Eli.
	paid := admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Pago Total", "quantity": 3,
	})
	markPaid(t, admin, paid.Body["sale"].(map[string]any)["id"].(float64), "cash")
	admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Invitado", "quantity": 1, "is_comp": true,
	})

	// 1. Paginacion por cursor: dos paginas que suman todo sin repetir.
	first := admin.get("/api/sales")
	assertStatus(t, first, http.StatusOK)
	page1 := first.Body["sales"].([]any)
	if len(page1) != 50 {
		t.Fatalf("primera pagina de 50, hay %d", len(page1))
	}
	cursor, _ := first.Body["next_cursor"].(string)
	if cursor == "" {
		t.Fatal("con 58 ventas tiene que haber next_cursor")
	}
	second := admin.get("/api/sales?cursor=" + url.QueryEscape(cursor))
	page2 := second.Body["sales"].([]any)
	if len(page1)+len(page2) != 58 {
		t.Fatalf("58 ventas en total, hay %d", len(page1)+len(page2))
	}
	seen := map[float64]bool{}
	for _, raw := range append(page1, page2...) {
		id := raw.(map[string]any)["id"].(float64)
		if seen[id] {
			t.Fatalf("venta repetida entre paginas: %v", id)
		}
		seen[id] = true
	}
	if _, has := second.Body["next_cursor"]; has {
		t.Fatalf("la ultima pagina no lleva cursor: %v", second.Body["next_cursor"])
	}

	// 2. El resumen acompaña: 61 entradas vendibles (55+2+3+1 cortesia no), etc.
	summary := first.Body["summary"].(map[string]any)
	if summary["tickets_sold"].(float64) != 60 { // 55*1 + 2 + 3 (cortesia excluida)
		t.Fatalf("tickets_sold = %v, se esperaba 60", summary["tickets_sold"])
	}
	if summary["pending_count"].(float64) != 56 { // 55 + Carola
		t.Fatalf("pending_count = %v, se esperaba 56", summary["pending_count"])
	}
	if summary["total_count"].(float64) != 58 {
		t.Fatalf("total_count = %v, se esperaba 58", summary["total_count"])
	}

	// 3. Busqueda "caro": matchea a la corista Carolina (todas sus ventas)
	// y a la compradora Cárola (acento-insensible en ambos lados).
	search := admin.get("/api/sales?q=caro")
	found := search.Body["sales"].([]any)
	if len(found) != 50 { // 56 matches de Carolina + Carola > pagina de 50
		t.Fatalf("busqueda con paginacion: %d", len(found))
	}
	if search.Body["summary"].(map[string]any)["total_count"].(float64) != 56 {
		t.Fatalf("summary de la busqueda: %v", search.Body["summary"])
	}
	// Busqueda CON acento tambien encuentra (normaliza los dos lados).
	accent := admin.get("/api/sales?q=" + url.QueryEscape("cáro"))
	if accent.Body["summary"].(map[string]any)["total_count"].(float64) != 56 {
		t.Fatalf("busqueda acentuada: %v", accent.Body["summary"])
	}

	// 4. Filtros de estado.
	pending := admin.get("/api/sales?status=pending")
	if pending.Body["summary"].(map[string]any)["pending_count"].(float64) != 56 {
		t.Fatalf("pending: %v", pending.Body["summary"])
	}
	paidList := admin.get("/api/sales?status=paid")
	if got := len(paidList.Body["sales"].([]any)); got != 1 {
		t.Fatalf("pagas = %d, se esperaba 1", got)
	}
	comps := admin.get("/api/sales?status=comp")
	if got := len(comps.Body["sales"].([]any)); got != 1 {
		t.Fatalf("cortesias = %d, se esperaba 1", got)
	}

	// 5. last_email_at: null sin envios; con envio, aparece.
	withEmail := carolina.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Zulema Con Mail", "buyer_email": "z@x.com", "quantity": 1,
	})
	assertStatus(t, withEmail, http.StatusCreated)
	afterEmail := admin.get("/api/sales?q=zulema")
	row := afterEmail.Body["sales"].([]any)[0].(map[string]any)
	if row["last_email_at"] == nil {
		t.Fatalf("last_email_at tendria que estar tras el envio: %v", row)
	}
	noEmailRow := admin.get("/api/sales?q=invitado").Body["sales"].([]any)[0].(map[string]any)
	if noEmailRow["last_email_at"] != nil {
		t.Fatalf("sin envios, last_email_at es null: %v", noEmailRow)
	}

	// 6. La corista sigue viendo solo lo suyo, con resumen propio.
	own := carolina.get("/api/sales")
	if own.Body["summary"].(map[string]any)["total_count"].(float64) != 57 { // 55+Carola+Zulema
		t.Fatalf("resumen de Carolina: %v", own.Body["summary"])
	}
}

// TestVenderC15 cubre lo que agrega la spec C15 del lado del server:
// subtotales por función, resumen filtrado, estado de entrega, filtro por
// vendedora, acciones en lote y export.
func TestVenderC15(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fnID := setupCatalog(t, admin, 100)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	josefina := createSellerClient(t, env, admin, "Josefina", "jose@acapelius.test")
	assignQuota(t, admin, fnID, 2, 30)
	assignQuota(t, admin, fnID, 3, 30)

	venta := func(c *testClient, nombre, email string, cantidad int) float64 {
		t.Helper()
		body := map[string]any{"function_id": fnID, "buyer_name": nombre, "quantity": cantidad}
		if email != "" {
			body["buyer_email"] = email
		}
		resp := c.post("/api/sales", body)
		assertStatus(t, resp, http.StatusCreated)
		return resp.Body["sale"].(map[string]any)["id"].(float64)
	}

	conEmail := venta(carolina, "Con Email", "conemail@demo.acapelius.local", 2)
	sinEmail := venta(carolina, "Sin Email", "", 1)
	deJosefina := venta(josefina, "De Josefina", "", 3)
	markPaid(t, admin, conEmail, "cash")

	// 1. Estado de entrega: la que tiene email quedó enviada (driver log), la
	//    que no tiene queda en "none". Nunca "opened": no hay webhook.
	lista := admin.get("/api/sales")
	assertStatus(t, lista, http.StatusOK)
	entregas := map[float64]string{}
	for _, raw := range lista.Body["sales"].([]any) {
		v := raw.(map[string]any)
		entregas[v["id"].(float64)] = v["delivery"].(string)
	}
	if entregas[conEmail] != "sent" {
		t.Fatalf("la venta con email tendría que estar enviada; está %q", entregas[conEmail])
	}
	if entregas[sinEmail] != "none" {
		t.Fatalf("la venta sin email tendría que ser 'none'; es %q", entregas[sinEmail])
	}

	// 2. Subtotales por función: los del bloque, no los de la página.
	totales := lista.Body["function_totals"].([]any)
	if len(totales) != 1 {
		t.Fatalf("una sola función, hay %d bloques de subtotales", len(totales))
	}
	bloque := totales[0].(map[string]any)
	if bloque["sales"].(float64) != 3 || bloque["tickets"].(float64) != 6 {
		t.Fatalf("subtotales del bloque mal: %v", bloque)
	}
	if bloque["paid_cents"].(float64) != 1600000 {
		t.Fatalf("recaudado del bloque = %v, se esperaban 1600000", bloque["paid_cents"])
	}
	if bloque["pending_cents"].(float64) != 3200000 {
		t.Fatalf("adeudado del bloque = %v, se esperaban 3200000", bloque["pending_cents"])
	}

	// 3. El resumen filtrado respeta el estado; el otro no (alimenta los chips).
	deben := admin.get("/api/sales?status=pending")
	assertStatus(t, deben, http.StatusOK)
	filtrado := deben.Body["filtered"].(map[string]any)
	if filtrado["total_count"].(float64) != 2 {
		t.Fatalf("con filtro 'deben' el resumen tendría que contar 2; contó %v", filtrado["total_count"])
	}
	if filtrado["paid_cents"].(float64) != 0 {
		t.Fatalf("con filtro 'deben' lo cobrado tendría que ser 0; es %v", filtrado["paid_cents"])
	}
	sinFiltrar := deben.Body["summary"].(map[string]any)
	if sinFiltrar["total_count"].(float64) != 3 {
		t.Fatalf("el summary de los chips tendría que ignorar el filtro; contó %v", sinFiltrar["total_count"])
	}

	// 4. Filtro por vendedora (solo dirección).
	soloJose := admin.get(fmt.Sprintf("/api/sales?seller_id=%.0f", sellerID(t, josefina)))
	assertStatus(t, soloJose, http.StatusOK)
	ventas := soloJose.Body["sales"].([]any)
	if len(ventas) != 1 || ventas[0].(map[string]any)["id"].(float64) != deJosefina {
		t.Fatalf("el filtro por vendedora tendría que dejar solo la de Josefina: %v", ventas)
	}

	// 5. Cobro en lote: cobra lo que falta y saltea lo que no aplica.
	lote := admin.post("/api/sales/bulk-payment", map[string]any{
		"sale_ids": []float64{conEmail, sinEmail, deJosefina}, "method": "cash",
	})
	assertStatus(t, lote, http.StatusOK)
	if lote.Body["charged"].(float64) != 2 {
		t.Fatalf("tendría que haber cobrado 2 (la tercera ya estaba paga); cobró %v", lote.Body["charged"])
	}
	if lote.Body["skipped"].(float64) != 1 {
		t.Fatalf("tendría que haber salteado 1; salteó %v", lote.Body["skipped"])
	}
	despues := admin.get("/api/sales")
	if despues.Body["filtered"].(map[string]any)["pending_cents"].(float64) != 0 {
		t.Fatalf("después del lote no tendría que quedar nada por cobrar: %v", despues.Body["filtered"])
	}

	// 6. Reenvío en lote: informa cuántas se omitieron por no tener email.
	reenvio := admin.post("/api/sales/bulk-resend", map[string]any{
		"sale_ids": []float64{conEmail, sinEmail},
	})
	assertStatus(t, reenvio, http.StatusOK)
	if reenvio.Body["sent"].(float64) != 1 || reenvio.Body["no_email"].(float64) != 1 {
		t.Fatalf("reenvío en lote mal contado: %v", reenvio.Body)
	}

	// 7. Una corista no puede operar en lote ventas ajenas.
	assertStatus(t, carolina.post("/api/sales/bulk-payment", map[string]any{
		"sale_ids": []float64{deJosefina}, "method": "cash",
	}), http.StatusForbidden)

	// 8. Export: CSV con encabezado y una fila por venta del filtro.
	csv := admin.getRaw("/api/sales/export")
	if csv.Status != http.StatusOK {
		t.Fatalf("export status = %d", csv.Status)
	}
	if !strings.Contains(csv.Text, "Comprador") || !strings.Contains(csv.Text, "De Josefina") {
		t.Fatalf("el CSV no tiene lo que debería: %q", csv.Text)
	}
	if lineas := strings.Count(strings.TrimSpace(csv.Text), "\n"); lineas != 3 {
		t.Fatalf("el CSV tendría que tener encabezado + 3 ventas; tiene %d saltos", lineas)
	}
}

// TestVentasPorTemporada: el listado vive dentro de una temporada. Sin esto,
// el selector global decía 2025 y Ventas mostraba los dos años juntos.
func TestVentasPorTemporada(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)
	fn2026 := setupCatalog(t, admin, 50)
	season2026 := activeSeasonID(t, admin)
	carolina := createSellerClient(t, env, admin, "Carolina", "caro@acapelius.test")
	caroID := sellerID(t, carolina)
	assignQuota(t, admin, fn2026, int(caroID), 10)
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fn2026, "buyer_name": "De 2026", "quantity": 2,
	}), http.StatusCreated)

	// Una temporada nueva, con su propia función y su propia venta.
	nueva := admin.post("/api/seasons", map[string]any{"name": "Temporada 2027"})
	assertStatus(t, nueva, http.StatusCreated)
	season2027 := nueva.Body["season"].(map[string]any)["id"].(float64)
	fnResp := admin.post("/api/functions", map[string]any{
		"season_id": season2027, "venue": "Teatro Municipal",
		"starts_at": "2027-12-10T21:00:00-03:00", "capacity": 50, "price_cents": 900000,
	})
	assertStatus(t, fnResp, http.StatusCreated)
	fn2027 := fnResp.Body["function"].(map[string]any)["id"].(float64)
	assertStatus(t, admin.post(fmt.Sprintf("/api/seasons/%.0f/members", season2027),
		map[string]any{"user_id": caroID, "role": "seller"}), http.StatusOK)
	assignQuota(t, admin, fn2027, int(caroID), 10)
	assertStatus(t, carolina.post("/api/sales", map[string]any{
		"function_id": fn2027, "buyer_name": "De 2027", "quantity": 3,
	}), http.StatusCreated)

	compradores := func(qs string) []string {
		t.Helper()
		resp := admin.get("/api/sales" + qs)
		assertStatus(t, resp, http.StatusOK)
		var out []string
		for _, raw := range resp.Body["sales"].([]any) {
			out = append(out, raw.(map[string]any)["buyer_name"].(string))
		}
		return out
	}

	// Cada temporada muestra la suya, y sólo la suya.
	if got := compradores(fmt.Sprintf("?season_id=%.0f", season2026)); len(got) != 1 || got[0] != "De 2026" {
		t.Fatalf("2026 tendría que traer sólo su venta; trajo %v", got)
	}
	if got := compradores(fmt.Sprintf("?season_id=%.0f", season2027)); len(got) != 1 || got[0] != "De 2027" {
		t.Fatalf("2027 tendría que traer sólo su venta; trajo %v", got)
	}

	// Sin season_id manda la temporada en curso, que es la recién creada.
	if got := compradores(""); len(got) != 1 || got[0] != "De 2027" {
		t.Fatalf("sin season_id tendría que usar la temporada en curso; trajo %v", got)
	}

	// El resumen y los subtotales del bloque siguen el mismo alcance.
	resp := admin.get(fmt.Sprintf("/api/sales?season_id=%.0f", season2026))
	if resp.Body["filtered"].(map[string]any)["tickets_sold"].(float64) != 2 {
		t.Fatalf("el resumen de 2026 tendría que contar 2 entradas: %v", resp.Body["filtered"])
	}
	if len(resp.Body["function_totals"].([]any)) != 1 {
		t.Fatalf("2026 tiene una sola función con ventas: %v", resp.Body["function_totals"])
	}

	// Y la home de dirección también: es lo que hace cierto al selector.
	home := admin.get(fmt.Sprintf("/api/home?season_id=%.0f", season2026))
	assertStatus(t, home, http.StatusOK)
	if home.Body["season"].(map[string]any)["id"].(float64) != season2026 {
		t.Fatalf("la home tendría que responder por la temporada pedida: %v", home.Body["season"])
	}

	// La corista no elige temporada: opera siempre sobre la que está en curso.
	suHome := carolina.get(fmt.Sprintf("/api/home?season_id=%.0f", season2026))
	assertStatus(t, suHome, http.StatusOK)
	if suHome.Body["season"].(map[string]any)["id"].(float64) != season2027 {
		t.Fatalf("la corista tendría que ver la temporada en curso: %v", suHome.Body["season"])
	}
}
