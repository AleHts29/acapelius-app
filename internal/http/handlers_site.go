package httpapi

import (
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

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
	r.Get("/k/{short}", s.handleShortLink)
	r.Get("/k/{short}/mapa", s.handleShortMapa)

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

// handleShortLink: /k/{short} lleva a la pagina de las entradas. Es el link
// que va por WhatsApp, donde no se le puede poner nombre a un link y uno
// largo se ve feo. Si no existe, va igual a /e/: esa pagina ya sabe decir
// "esta entrada no existe" con la cara de la app.
func (s *Server) handleShortLink(w http.ResponseWriter, r *http.Request) {
	short := chi.URLParam(r, "short")
	destino := "/e/" + url.PathEscape(short)
	if len(short) == 8 {
		code, err := s.queries.GetSaleCodeByShort(r.Context(), short)
		switch {
		case err == nil:
			destino = "/e/" + code
		case !errors.Is(err, pgx.ErrNoRows):
			slog.ErrorContext(r.Context(), "no se pudo resolver el link corto", "error", err)
		}
	}
	http.Redirect(w, r, destino, http.StatusFound)
}

// handleShortMapa: /k/{short}/mapa es el "Como llegar" del WhatsApp. Lleva al
// Google Maps de la funcion de esa venta. No va directo el link de Google
// porque WhatsApp le arma la vista previa al primer link del mensaje, y con el
// de Maps sale la foto del teatro arriba de todo. Esta pagina tiene la vista
// previa de Acapelius y manda al Maps apenas abre (no con un 302: WhatsApp
// sigue las redirecciones y volveria a mostrar la de Google).
func (s *Server) handleShortMapa(w http.ResponseWriter, r *http.Request) {
	short := chi.URLParam(r, "short")
	var mapsURL string
	if len(short) == 8 {
		u, err := s.queries.GetMapsURLByShort(r.Context(), short)
		switch {
		case err == nil && u != nil:
			mapsURL = *u
		case err != nil && !errors.Is(err, pgx.ErrNoRows):
			slog.ErrorContext(r.Context(), "no se pudo resolver el mapa del link corto", "error", err)
		}
	}
	if mapsURL == "" {
		// Sin Maps cargado (o venta que no existe): a las entradas.
		http.Redirect(w, r, "/k/"+url.PathEscape(short), http.StatusFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	if err := paginaMapa.Execute(w, map[string]string{"Maps": mapsURL, "Base": s.cfg.BaseURL}); err != nil {
		slog.ErrorContext(r.Context(), "no se pudo armar la pagina del mapa", "error", err)
	}
}

var paginaMapa = template.Must(template.New("mapa").Parse(`<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acapelius</title>
<meta name="description" content="Entradas del coro: ventas, envio por email y control de ingreso.">
<meta property="og:title" content="Acapelius">
<meta property="og:description" content="Entradas del coro: ventas, envio por email y control de ingreso.">
<meta property="og:image" content="{{.Base}}/app/apple-touch-icon.png?v=bordo">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url={{.Maps}}">
<script>location.replace({{.Maps}})</script>
</head>
<body style="font-family:system-ui,sans-serif;padding:24px">
<p>Abriendo el mapa… <a href="{{.Maps}}">Tocá acá si no se abre.</a></p>
</body>
</html>
`))
