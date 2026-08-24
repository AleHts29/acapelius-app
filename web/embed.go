// Package web embebe el build del frontend para que el deploy sea un unico
// binario. En desarrollo el frontend lo sirve Vite en :5173 y estas rutas solo
// se usan si alguien entra directo al puerto del server.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// assetsPrefix es donde Vite escribe los archivos con hash en el nombre; solo
// esos se pueden cachear para siempre.
const assetsPrefix = "assets/"

// SPAHandler sirve el build de Vite. Cualquier ruta que no corresponda a un
// archivo cae en index.html, para que el router del cliente la resuelva.
func SPAHandler() http.Handler {
	root, err := fs.Sub(distFS, "dist")
	if err != nil {
		// Solo puede fallar si el go:embed de arriba cambio y quedo mal.
		panic("web: no se pudo abrir el build embebido: " + err.Error())
	}

	index, indexErr := fs.ReadFile(root, "index.html")
	fileServer := http.FileServer(http.FS(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if indexErr != nil {
			writeMissingBuild(w)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" {
			if f, err := root.Open(name); err == nil {
				info, statErr := f.Stat()
				_ = f.Close()
				if statErr == nil && !info.IsDir() {
					if strings.HasPrefix(name, assetsPrefix) {
						w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
					}
					fileServer.ServeHTTP(w, r)
					return
				}
			}
		}

		// Fallback de SPA. Sin cache: index.html referencia los assets con
		// hash y una version vieja apunta a archivos que ya no existen.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}

// HasBuild indica si el binario trae un frontend compilado adentro.
func HasBuild() bool {
	_, err := distFS.Open("dist/index.html")
	return err == nil
}

func writeMissingBuild(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8">
<title>Acapelius</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.6">
<h1>Frontend sin compilar</h1>
<p>El binario no trae el build de <code>web/dist</code>.</p>
<p>En desarrollo, abri el frontend en <a href="http://localhost:5173">http://localhost:5173</a>.</p>
<p>Para embeberlo en el binario: <code>make build</code>.</p>
</body>`))
}
