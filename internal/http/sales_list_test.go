package httpapi_test

import (
	"fmt"
	"net/http"
	"net/url"
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
