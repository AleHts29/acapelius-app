package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type userResponse struct {
	User domain.User `json:"user"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || req.Password == "" {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Ingresa tu email y tu contrasena.")
		return
	}

	user, err := s.auth.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			httpx.Error(w, http.StatusUnauthorized, httpx.CodeInvalidCredentials, "Email o contrasena incorrectos.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	httpx.JSON(w, http.StatusOK, userResponse{User: *user})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.auth.Logout(r.Context()); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUserFrom(r.Context())
	httpx.JSON(w, http.StatusOK, userResponse{User: *user})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	user := auth.MustUserFrom(r.Context())
	err := s.auth.ChangePassword(r.Context(), user.OrganizationID, user.ID, req.CurrentPassword, req.NewPassword)
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrInvalidCredentials):
		httpx.Error(w, http.StatusUnauthorized, httpx.CodeInvalidCredentials, "La contrasena actual no es correcta.")
		return
	case errors.Is(err, domain.ErrPasswordShort),
		errors.Is(err, domain.ErrPasswordLong),
		errors.Is(err, domain.ErrPasswordSame):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, capitalize(err.Error()))
		return
	default:
		httpx.Internal(w, r, err)
		return
	}

	// La sesion queda abierta, pero con un token nuevo: si la password
	// provisoria circulo por WhatsApp, cualquier sesion vieja deja de servir.
	if err := s.auth.Sessions().RenewToken(r.Context()); err != nil {
		httpx.Internal(w, r, err)
		return
	}

	updated, err := s.auth.CurrentUser(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, userResponse{User: *updated})
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func timeoutContext(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}
