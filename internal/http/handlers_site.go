package httpapi

import (
	"fmt"
	"net/http"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ale-hts/acapelius/web"
)

// Sitio publico y app (C17 §B.1):
//
//	/               landing (con sesion → /app)
//	/crear-cuenta   alta de organizacion
//	/entrar         login
//	/demo           la demo (pieza C); mientras tanto, una pagina que lo dice
//	/app/*          toda la app, con sesion
//	/e/*, /t/*      entradas publicas, sin cambios
//
// Las rutas viejas de la app (/ventas, /puerta, …) redirigen a /app/…: hay
// links en emails ya enviados.
func (s *Server) mountSite(r chi.Router) {
	r.Get("/", s.publicPage("landing.html"))
	r.Get("/crear-cuenta", s.publicPage("crear-cuenta.html"))
	r.Get("/entrar", s.publicPage("entrar.html"))
	r.Get("/demo", s.publicPage("demo.html"))

	r.Get("/site/*", s.web.SiteAssets().ServeHTTP)
	r.Get("/robots.txt", s.handleRobots)
	r.Get("/sitemap.xml", s.handleSitemap)
	r.Get("/sw.js", web.KillServiceWorker().ServeHTTP)

	app := s.web.App()
	r.Get(web.AppPrefix, app.ServeHTTP)
	r.Get(web.AppPrefix+"/*", app.ServeHTTP)
	index := s.web.Index()
	r.Get("/e/*", index.ServeHTTP)
	r.Get("/t/*", index.ServeHTTP)

	r.NotFound(s.handleNotFound)
}

// publicPage sirve una pagina del sitio. Con sesion abierta, la landing y las
// pantallas de acceso no tienen sentido: derecho a la app.
func (s *Server) publicPage(name string) http.HandlerFunc {
	page := s.web.SitePage(name)
	return func(w http.ResponseWriter, r *http.Request) {
		if user, err := s.auth.CurrentUser(r.Context()); err == nil && user != nil {
			http.Redirect(w, r, web.AppPrefix, http.StatusFound)
			return
		}
		page.ServeHTTP(w, r)
	}
}

// handleNotFound resuelve lo que no matcheo ninguna ruta:
//   - un archivo del build en la raiz (logos de los emails, iconos, manifest
//     de las PWAs instaladas antes de /app) se sirve tal cual;
//   - una ruta sin extension es una ruta vieja de la app: 301 a /app/…;
//   - lo demas es 404.
func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && s.web.RootFile(w, r) {
		return
	}
	if r.Method == http.MethodGet && path.Ext(r.URL.Path) == "" && !strings.HasPrefix(r.URL.Path, "/api/") {
		destino := web.AppPrefix + path.Clean("/"+r.URL.Path)
		if r.URL.RawQuery != "" {
			destino += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, destino, http.StatusMovedPermanently)
		return
	}
	http.NotFound(w, r)
}

// handleRobots: la landing se indexa; la app y la API no.
func (s *Server) handleRobots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	fmt.Fprintf(w, "User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\nDisallow: /e/\nDisallow: /t/\n\nSitemap: %s/sitemap.xml\n", s.cfg.BaseURL)
}

func (s *Server) handleSitemap(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	fmt.Fprint(w, `<?xml version="1.0" encoding="UTF-8"?>`+"\n"+`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`+"\n")
	for _, p := range []string{"/", "/crear-cuenta", "/entrar", "/demo"} {
		fmt.Fprintf(w, "  <url><loc>%s%s</loc></url>\n", s.cfg.BaseURL, p)
	}
	fmt.Fprint(w, "</urlset>\n")
}
