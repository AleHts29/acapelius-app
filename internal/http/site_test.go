package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ale-hts/acapelius/internal/domain"
)

// El sitio publico y el enrutado de la app bajo /app (C17 §B.1).
func TestSitioPublicoYRutasDeLaApp(t *testing.T) {
	env := newTestEnv(t)
	anon := env.client(t)

	// Sin sesion: landing, alta y login son paginas; la app redirige al login
	// desde el cliente (el index se sirve igual: es el SPA quien manda a /entrar).
	for ruta, marca := range map[string]string{
		"/":             "Sacá las",
		"/crear-cuenta": `id="alta"`,
		"/entrar":       `id="entrar"`,
		"/demo":         "demo",
	} {
		resp := anon.getRaw(ruta)
		if resp.Status != http.StatusOK || !strings.Contains(resp.Text, marca) {
			t.Fatalf("%s: status %d, cuerpo sin %q", ruta, resp.Status, marca)
		}
		if strings.Contains(resp.Text, "/app/assets/") {
			t.Fatalf("%s carga el bundle de la app", ruta)
		}
	}

	// Estaticos del sitio y lo que tiene que seguir en la raiz.
	for ruta, tipo := range map[string]string{
		"/site/afiche.css":          "text/css",
		"/site/fonts/anton.woff2":   "font/woff2",
		"/site/og.png":              "image/png",
		"/robots.txt":               "text/plain",
		"/sitemap.xml":              "application/xml",
		"/sw.js":                    "text/javascript",
		"/email-logo.png":           "image/png",
		"/app/manifest.webmanifest": "application/manifest+json",
	} {
		resp, err := anon.http.Get(env.server.URL + ruta)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), tipo) {
			t.Fatalf("%s: %d %s, se esperaba 200 %s", ruta, resp.StatusCode, resp.Header.Get("Content-Type"), tipo)
		}
	}
	if !strings.Contains(anon.getRaw("/sw.js").Text, "unregister") {
		t.Fatal("/sw.js tendria que ser el service worker de baja")
	}
	if robots := anon.getRaw("/robots.txt").Text; !strings.Contains(robots, "Disallow: /app") {
		t.Fatalf("robots.txt: %q", robots)
	}

	// Rutas viejas de la app: 301 a /app/… conservando la query.
	sinRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for vieja, nueva := range map[string]string{
		"/ventas":       "/app/ventas",
		"/ventas?fn=3":  "/app/ventas?fn=3",
		"/puerta/2":     "/app/puerta/2",
		"/rendiciones":  "/app/rendiciones",
		"/panel/ventas": "/app/panel/ventas",
	} {
		resp, err := sinRedirect.Get(env.server.URL + vieja)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusMovedPermanently || resp.Header.Get("Location") != nueva {
			t.Fatalf("%s: %d → %q, se esperaba 301 → %q", vieja, resp.StatusCode, resp.Header.Get("Location"), nueva)
		}
	}
	// Un archivo que no existe es 404, no un redirect ni el index.
	if resp, _ := sinRedirect.Get(env.server.URL + "/nada.png"); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("/nada.png: %d", resp.StatusCode)
	}
	// /api desconocida sigue siendo JSON.
	assertErrorCode(t, anon.get("/api/nada"), http.StatusNotFound, "not_found")

	// Con sesion, la landing y las pantallas de acceso van derecho a /app.
	env.seedUser(t, "Eli", adminEmail, adminTempPass, domain.RoleAdmin)
	con := env.client(t)
	assertStatus(t, con.post("/api/auth/login", map[string]string{"email": adminEmail, "password": adminTempPass}), http.StatusOK)
	for _, ruta := range []string{"/", "/entrar", "/crear-cuenta", "/demo"} {
		req, _ := http.NewRequest(http.MethodGet, env.server.URL+ruta, nil)
		for _, c := range con.http.Jar.Cookies(req.URL) {
			req.AddCookie(c)
		}
		resp, err := sinRedirect.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/app" {
			t.Fatalf("%s con sesion: %d → %q, se esperaba 302 → /app", ruta, resp.StatusCode, resp.Header.Get("Location"))
		}
	}
	// Y la app y las entradas publicas sirven el index del SPA.
	for _, ruta := range []string{"/app", "/app/ventas", "/e/ABC", "/t/XYZ"} {
		resp := con.getRaw(ruta)
		if resp.Status != http.StatusOK || !strings.Contains(resp.Text, "/app/assets/") {
			t.Fatalf("%s: status %d, no es el index del SPA", ruta, resp.Status)
		}
	}
}
