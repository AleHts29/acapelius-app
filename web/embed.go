// Package web embebe en el binario todo lo que se sirve por HTTP fuera de la
// API: el build del SPA (bajo /app) y el sitio publico (landing, alta,
// login), que es HTML estatico en su propio lenguaje visual y no carga el
// bundle de la app (C17 §B).
//
// En desarrollo el frontend lo sirve Vite en :5173 (bajo /app/) y proxea a
// este server lo que no es suyo; estas rutas solo se usan si alguien entra
// directo al puerto del server.
package web

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

func init() {
	// Go no conoce la extension del manifest de la PWA y la serviria como
	// texto plano.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

//go:embed all:dist
var distFS embed.FS

// El sitio publico vive en web/src/public: paginas, su CSS/JS y sus fuentes.
//
//go:embed all:src/public
var siteFS embed.FS

// AppPrefix es donde vive la app. Las rutas viejas (/ventas, /puerta, …)
// redirigen aca: hay links en emails ya enviados.
const AppPrefix = "/app"

// assetsPrefix es donde Vite escribe los archivos con hash en el nombre; solo
// esos se pueden cachear para siempre.
const assetsPrefix = "assets/"

// Handlers sirve el SPA y el sitio publico.
type Handlers struct {
	dist  fs.FS
	site  fs.FS
	index []byte
}

// New abre los sistemas de archivos embebidos. Solo falla si el go:embed de
// arriba cambio y quedo mal, y entonces conviene enterarse al arrancar.
func New() (*Handlers, error) {
	dist, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, err
	}
	site, err := fs.Sub(siteFS, "src/public")
	if err != nil {
		return nil, err
	}
	// Sin build (desarrollo sin `make build`) index queda en nil y las rutas
	// de la app explican como levantar Vite.
	index, _ := fs.ReadFile(dist, "index.html")
	return &Handlers{dist: dist, site: site, index: index}, nil
}

// HasBuild indica si el binario trae un frontend compilado adentro.
func HasBuild() bool {
	_, err := distFS.Open("dist/index.html")
	return err == nil
}

// App sirve el build de Vite bajo /app: un archivo si existe, y si no el
// index.html para que el router del cliente resuelva la ruta.
func (h *Handlers) App() http.Handler {
	fileServer := http.FileServer(http.FS(h.dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.index == nil {
			writeMissingBuild(w)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+strings.TrimPrefix(r.URL.Path, AppPrefix)), "/")
		if name != "" && name != "index.html" && h.has(h.dist, name) {
			if strings.HasPrefix(name, assetsPrefix) {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/" + name
			fileServer.ServeHTTP(w, r2)
			return
		}
		h.writeIndex(w)
	})
}

// Index sirve el index.html del SPA tal cual, para las rutas del cliente que
// viven fuera de /app: las paginas publicas de entradas (/e/, /t/).
func (h *Handlers) Index() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.index == nil {
			writeMissingBuild(w)
			return
		}
		h.writeIndex(w)
	})
}

// RootFile sirve, en la raiz, un archivo del build que tiene que seguir
// existiendo ahi: los logos que usan los emails ya enviados, los iconos y el
// manifest de las PWAs instaladas antes de /app. Devuelve false si no hay tal
// archivo (y no escribe nada).
func (h *Handlers) RootFile(w http.ResponseWriter, r *http.Request) bool {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || name == "index.html" || strings.Contains(name, "/") || !h.has(h.dist, name) {
		return false
	}
	http.FileServer(http.FS(h.dist)).ServeHTTP(w, r)
	return true
}

// SitePage sirve una pagina del sitio publico. Sin cache: son chicas y
// cambian con cada deploy.
func (h *Handlers) SitePage(name string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := fs.ReadFile(h.site, name)
		if err != nil {
			http.Error(w, "pagina no encontrada", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(body)
	})
}

// SiteAssets sirve /site/*: el CSS, el JS y las fuentes del sitio publico.
// Las fuentes no cambian: cache larga. El resto se revalida.
func (h *Handlers) SiteAssets() http.Handler {
	fileServer := http.StripPrefix("/site/", http.FileServer(http.FS(h.site)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/site/")
		if strings.HasSuffix(name, ".html") || !h.has(h.site, name) {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(name, "fonts/") || strings.HasSuffix(name, ".png") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	})
}

// killServiceWorker es lo que se sirve en /sw.js, donde vivia el service
// worker de la app antes de /app. Las PWAs ya instaladas lo tienen
// registrado con alcance "/" y responderian la landing con la shell vieja
// cacheada. Este lo reemplaza: borra los caches, se da de baja y recarga las
// pestañas, que pasan a registrar el nuevo en /app/sw.js.
const killServiceWorker = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await self.registration.unregister()
    const clients = await self.clients.matchAll({ type: 'window' })
    clients.forEach((c) => c.navigate(c.url))
  })())
})
`

// KillServiceWorker sirve el service worker de baja (ver killServiceWorker).
func KillServiceWorker() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write([]byte(killServiceWorker))
	})
}

func (h *Handlers) has(root fs.FS, name string) bool {
	f, err := root.Open(name)
	if err != nil {
		return false
	}
	info, err := f.Stat()
	_ = f.Close()
	return err == nil && !info.IsDir()
}

// writeIndex: sin cache, porque index.html referencia los assets con hash y
// una version vieja apunta a archivos que ya no existen.
func (h *Handlers) writeIndex(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(h.index)
}

func writeMissingBuild(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8">
<title>Acapelius</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.6">
<h1>Frontend sin compilar</h1>
<p>El binario no trae el build de <code>web/dist</code>.</p>
<p>En desarrollo, abri el frontend en <a href="http://localhost:5173/app/">http://localhost:5173/app/</a>.</p>
<p>Para embeberlo en el binario: <code>make build</code>.</p>
</body>`))
}
