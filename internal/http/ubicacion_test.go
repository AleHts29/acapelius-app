package httpapi_test

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// TestUbicacionYLinkCorto: la funcion guarda direccion y link de Maps (sin el
// ?g_st=ic de compartir), el mail los muestra, y el link corto /k/{8} lleva a
// la pagina de las entradas.
func TestUbicacionYLinkCorto(t *testing.T) {
	env := newTestEnv(t)
	admin := loginAdmin(t, env)

	fn := admin.post("/api/functions", map[string]any{
		"season_id": activeSeasonID(t, admin), "venue": "Salón de conferencias del Teatro del Globo",
		"address":   "Marcelo T. de Alvear 1155, CABA",
		"maps_url":  "https://maps.app.goo.gl/2hCqy1V3H1bd9j8r8?g_st=ic",
		"starts_at": "2099-12-11T20:00:00-03:00", "capacity": 10, "price_cents": 800000,
	})
	assertStatus(t, fn, http.StatusCreated)
	f := fn.Body["function"].(map[string]any)
	if f["address"] != "Marcelo T. de Alvear 1155, CABA" || f["maps_url"] != "https://maps.app.goo.gl/2hCqy1V3H1bd9j8r8" {
		t.Fatalf("direccion o link mal guardados: %v", f)
	}
	fnID := f["id"].(float64)

	// Un link que no es link no pasa.
	assertStatus(t, admin.do(http.MethodPatch, fmt.Sprintf("/api/functions/%.0f", fnID),
		map[string]any{"maps_url": "Marcelo T de Alvear 1155"}), http.StatusBadRequest)

	created := admin.post("/api/sales", map[string]any{
		"function_id": fnID, "buyer_name": "Ezequiel", "buyer_email": "eze@prueba.test", "quantity": 1,
	})
	assertStatus(t, created, http.StatusCreated)
	mail := env.emailLog.String()
	for _, want := range []string{"Marcelo T. de Alvear 1155, CABA", "Como llegar: https://maps.app.goo.gl/2hCqy1V3H1bd9j8r8"} {
		if !strings.Contains(mail, want) {
			t.Fatalf("el mail no trae %q", want)
		}
	}

	// El listado trae la ubicacion para el WhatsApp de la ficha.
	row := admin.get("/api/sales").Body["sales"].([]any)[0].(map[string]any)
	if row["function_address"] != "Marcelo T. de Alvear 1155, CABA" || row["function_maps_url"] == nil {
		t.Fatalf("el listado no trae la ubicacion: %v", row)
	}

	// Link corto: los ultimos 8 del codigo, en mayusculas o minusculas.
	code := created.Body["sale"].(map[string]any)["code"].(string)
	noFollow := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, short := range []string{code[len(code)-8:], strings.ToLower(code[len(code)-8:])} {
		resp, err := noFollow.Get(admin.baseURL + "/k/" + short)
		if err != nil {
			t.Fatalf("GET /k: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/e/"+code {
			t.Fatalf("/k/%s tendria que llevar a /e/%s: %d %s", short, code, resp.StatusCode, resp.Header.Get("Location"))
		}
	}
	// El "Como llegar" del WhatsApp: una pagina de Acapelius que manda al
	// Maps, para que la vista previa no sea la foto del teatro.
	mapa, err := noFollow.Get(admin.baseURL + "/k/" + strings.ToLower(code[len(code)-8:]) + "/mapa")
	if err != nil {
		t.Fatalf("GET /k/mapa: %v", err)
	}
	cuerpo, _ := io.ReadAll(mapa.Body)
	mapa.Body.Close()
	if mapa.StatusCode != http.StatusOK ||
		!strings.Contains(string(cuerpo), `content="0; url=https://maps.app.goo.gl/2hCqy1V3H1bd9j8r8"`) ||
		!strings.Contains(string(cuerpo), `<meta property="og:title" content="Acapelius">`) {
		t.Fatalf("/k/…/mapa tendria que mandar al Maps con la vista previa de Acapelius: %d %s", mapa.StatusCode, cuerpo)
	}
	resp, err := noFollow.Get(admin.baseURL + "/k/ZZZZZZZZ/mapa")
	if err != nil {
		t.Fatalf("GET /k/mapa: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/k/ZZZZZZZZ" {
		t.Fatalf("sin venta, el mapa cae en el link de las entradas: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}

	resp, err = noFollow.Get(admin.baseURL + "/k/ZZZZZZZZ")
	if err != nil {
		t.Fatalf("GET /k: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/e/ZZZZZZZZ" {
		t.Fatalf("un link corto que no existe cae en la pagina de entradas, que dice que no existe: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
}
