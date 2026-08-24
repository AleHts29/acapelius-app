// Package httpapi arma el router y los handlers de la API.
package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/config"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
	"github.com/ale-hts/acapelius/internal/mail"
	"github.com/ale-hts/acapelius/internal/qr"
	"github.com/ale-hts/acapelius/web"
)

// Server tiene las dependencias que comparten los handlers.
type Server struct {
	cfg     *config.Config
	pool    *pgxpool.Pool
	auth    *auth.Service
	queries *sqlcgen.Queries
	signer  *qr.Signer
	mailer  mail.Driver
}

// New construye el server HTTP con todas sus rutas montadas.
func New(cfg *config.Config, pool *pgxpool.Pool, authService *auth.Service, signer *qr.Signer, mailer mail.Driver) *Server {
	return &Server{
		cfg:     cfg,
		pool:    pool,
		auth:    authService,
		queries: sqlcgen.New(pool),
		signer:  signer,
		mailer:  mailer,
	}
}

// loginRateLimit acota los intentos de login por IP. Generoso para no trabar a
// varias vendedoras detras del mismo NAT, pero suficiente contra fuerza bruta.
const (
	loginRateLimitRequests = 10
	loginRateLimitWindow   = time.Minute
)

// Handler devuelve el http.Handler raiz: API bajo /api, entradas publicas bajo
// /e y el frontend embebido en el resto.
func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(RequestLogger())
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(s.auth.Sessions().LoadAndSave)

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", s.handleHealth)

		// Publico, sin sesion: la pagina de la entrada y los PNG de los QR.
		// El sale_code / ticket_code no adivinable es la autorizacion.
		api.Get("/public/sales/{code}", s.handlePublicSale)
		api.Get("/public/tickets/{code}.png", s.handlePublicTicketPNG)

		api.Group(func(pub chi.Router) {
			pub.Use(httprate.LimitByIP(loginRateLimitRequests, loginRateLimitWindow))
			pub.Post("/auth/login", s.handleLogin)
		})

		api.Group(func(priv chi.Router) {
			priv.Use(s.auth.LoadUser)
			priv.Use(s.auth.RequireAuth)

			// Accesibles incluso con password provisoria: son justamente las
			// rutas que necesita la pantalla de "cambia tu contrasena".
			priv.Get("/me", s.handleMe)
			priv.Post("/auth/logout", s.handleLogout)
			priv.Post("/auth/change-password", s.handleChangePassword)

			priv.Group(func(ready chi.Router) {
				ready.Use(auth.RequirePasswordChanged)

				// Lecturas del catalogo, para cualquier rol: la vendedora
				// elige funcion al vender y la puerta al abrir su modo.
				ready.Get("/seasons", s.handleListSeasons)
				ready.Get("/functions", s.handleListFunctions)

				ready.Group(func(seller chi.Router) {
					seller.Use(auth.RequireRole(domain.RoleSeller))
					seller.Post("/sales", s.handleCreateSale)
					seller.Get("/sales", s.handleListSales)
					seller.Patch("/sales/{id}", s.handleUpdateSalePayment)
					seller.Post("/sales/{id}/resend-email", s.handleResendEmail)
				})

				// Modo puerta: door es su rol natural, pero una vendedora
				// tambien puede estar en la puerta (spec §3, nota de roles).
				ready.Group(func(door chi.Router) {
					door.Use(auth.RequireRole(domain.RoleDoor, domain.RoleSeller))
					door.Get("/functions/{id}/door-snapshot", s.handleDoorSnapshot)
					door.Post("/checkins", s.handleCreateCheckin)
					door.Post("/checkins/sync", s.handleSyncCheckins)
				})

				ready.Group(func(admin chi.Router) {
					admin.Use(auth.RequireRole(domain.RoleAdmin))
					admin.Post("/users", s.handleCreateUser)
					admin.Get("/users", s.handleListUsers)
					admin.Post("/seasons", s.handleCreateSeason)
					admin.Post("/functions", s.handleCreateFunction)
					admin.Patch("/functions/{id}", s.handleUpdateFunction)
					admin.Post("/sales/{id}/void", s.handleVoidSale)
					admin.Post("/tickets/{id}/void", s.handleVoidTicket)
				})
			})
		})

		// Cualquier ruta /api/* desconocida responde JSON, no el index.html
		// del frontend: un 404 en HTML rompe el cliente silenciosamente.
		api.NotFound(func(w http.ResponseWriter, r *http.Request) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "Ese endpoint no existe.")
		})
		api.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
			httpx.Error(w, http.StatusMethodNotAllowed, httpx.CodeNotFound, "Metodo no permitido para este endpoint.")
		})
	})

	// El frontend (SPA) se sirve embebido en el binario. Las rutas del cliente
	// caen al index.html.
	r.NotFound(web.SPAHandler().ServeHTTP)

	return r
}
