package auth

import (
	"context"
	"net/http"

	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

type contextKey struct{ name string }

var userContextKey = &contextKey{"acapelius.user"}

// WithUser deja al usuario autenticado en el contexto del request.
func WithUser(ctx context.Context, user *domain.User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

// UserFrom devuelve el usuario autenticado del contexto, si lo hay.
func UserFrom(ctx context.Context) (*domain.User, bool) {
	user, ok := ctx.Value(userContextKey).(*domain.User)
	return user, ok && user != nil
}

// MustUserFrom devuelve el usuario autenticado. Solo se usa dentro de handlers
// montados detras de RequireAuth, donde su ausencia seria un bug de routing.
func MustUserFrom(ctx context.Context) *domain.User {
	user, ok := UserFrom(ctx)
	if !ok {
		panic("auth: no hay usuario en el contexto; falta el middleware RequireAuth")
	}
	return user
}

// LoadUser resuelve el usuario de la sesion y lo deja en el contexto sin
// exigir que exista. Sirve para rutas que se comportan distinto segun haya o
// no sesion.
func (s *Service) LoadUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := s.CurrentUser(r.Context())
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if user != nil {
			r = r.WithContext(WithUser(r.Context(), user))
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAuth corta con 401 si no hay sesion valida.
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := UserFrom(r.Context()); !ok {
			httpx.Error(w, http.StatusUnauthorized, httpx.CodeUnauthenticated, "Necesitas iniciar sesion.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequirePasswordChanged bloquea la API mientras el usuario arrastre una
// password provisoria. Se monta despues de RequireAuth y antes de las rutas de
// negocio; /api/me, cambio de password y logout quedan fuera para que el
// frontend pueda mostrar la pantalla de cambio.
func RequirePasswordChanged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := MustUserFrom(r.Context())
		if user.MustChangePassword {
			httpx.Error(w, http.StatusForbidden, httpx.CodePasswordChangeNeeded,
				"Tenes que cambiar tu contrasena antes de seguir.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireHistory deja pasar a quien participa de la temporada en curso y
// tambien a quien participo de alguna anterior. Es el permiso de "mirar lo
// mio": una corista que este año no esta en el coro puede entrar a ver sus
// ventas y su rendicion, pero no a vender (eso lo sigue cortando RequireRole).
func (s *Service) RequireHistory(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := MustUserFrom(r.Context())
		if user.Role.CanAny(domain.RoleSeller) {
			next.ServeHTTP(w, r)
			return
		}
		// Quien tiene otro rol este año (la puerta) no pasa por antiguedad:
		// el permiso es sobre ventas propias, y no tiene.
		if user.Role != "" {
			httpx.Error(w, http.StatusForbidden, httpx.CodeForbidden, "No tenes permiso para hacer esto.")
			return
		}
		tiene, err := s.HasHistory(r.Context(), user)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if !tiene {
			httpx.Error(w, http.StatusForbidden, httpx.CodeForbidden, "No tenes permiso para hacer esto.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRole exige que el usuario cumpla al menos uno de los roles. El admin
// siempre pasa (ver domain.Role.Can).
func RequireRole(roles ...domain.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := MustUserFrom(r.Context())
			if !user.Role.CanAny(roles...) {
				httpx.Error(w, http.StatusForbidden, httpx.CodeForbidden, "No tenes permiso para hacer esto.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// IsDemo indica si la sesion es de la organizacion demo (C17 §C): ahi no
// sale ningun mail y no se cambian contraseñas.
func IsDemo(ctx context.Context) bool {
	user, ok := UserFrom(ctx)
	return ok && user != nil && user.OrganizationIsDemo
}

// OrgFrom devuelve la organizacion de la sesion (C17 §A.2). Es lo que acota
// cada consulta a la base. Sin sesion devuelve 0, que no coincide con ninguna
// organizacion: si a un handler se le escapa una consulta sin usuario, falla
// cerrado —no ve nada— en vez de ver todo.
func OrgFrom(ctx context.Context) int64 {
	user, ok := UserFrom(ctx)
	if !ok || user == nil {
		return 0
	}
	return user.OrganizationID
}
