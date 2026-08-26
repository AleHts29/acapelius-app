package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
	"github.com/ale-hts/acapelius/internal/mail"
)

type createUserRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
	// Password es opcional: si no viene, el server genera una provisoria y la
	// devuelve una unica vez para que el admin se la pase a la persona.
	Password string `json:"password"`
}

type createUserResponse struct {
	User domain.User `json:"user"`
	// TempPassword solo viene cuando el server la genero. No se guarda en
	// claro ni se puede volver a consultar.
	TempPassword string `json:"temp_password,omitempty"`
	// EmailStatus: sent | failed | none. Si fallo, la UI todavia tiene la
	// contrasena provisoria para pasarla por WhatsApp.
	EmailStatus string `json:"email_status"`
}

// roleLabel es el nombre del rol en castellano, tal como lo lee el equipo.
func roleLabel(role domain.Role) string {
	switch role {
	case domain.RoleAdmin:
		return "Direccion"
	case domain.RoleDoor:
		return "Puerta"
	default:
		return "Corista"
	}
}

// sendInviteEmail manda el acceso (o la contrasena nueva) y devuelve el estado
// del envio. Nunca devuelve error: un email caido no invalida el alta.
func (s *Server) sendInviteEmail(ctx context.Context, user domain.User, tempPassword string, reset bool) string {
	msg := mail.ComposeInviteEmail(mail.InviteEmailData{
		Name:         user.Name,
		Email:        user.Email,
		RoleLabel:    roleLabel(user.Role),
		TempPassword: tempPassword,
		BaseURL:      s.cfg.BaseURL,
		Reset:        reset,
	})

	sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := s.mailer.Send(sendCtx, msg); err != nil {
		slog.ErrorContext(ctx, "fallo el envio de la invitacion",
			"user_id", user.ID, "driver", s.mailer.Name(), "error", err)
		return emailStatusFailed
	}
	return emailStatusSent
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	role := domain.Role(strings.TrimSpace(req.Role))

	password := req.Password
	generated := false
	if password == "" {
		var err error
		if password, err = auth.GenerateTempPassword(); err != nil {
			httpx.Internal(w, r, err)
			return
		}
		generated = true
	}

	user, err := s.auth.CreateUser(r.Context(), req.Name, req.Email, role, password)
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrEmailTaken):
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "Ya hay un usuario con ese email.")
		return
	case errors.Is(err, domain.ErrNameRequired),
		errors.Is(err, domain.ErrEmailRequired),
		errors.Is(err, domain.ErrEmailInvalid),
		errors.Is(err, domain.ErrRoleInvalid),
		errors.Is(err, domain.ErrPasswordShort),
		errors.Is(err, domain.ErrPasswordLong):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, capitalize(err.Error()))
		return
	default:
		httpx.Internal(w, r, err)
		return
	}

	// El alta dispara la invitacion (C7). Se manda siempre que el server haya
	// generado la clave: si la eligio el admin, no es suya para mandarla.
	resp := createUserResponse{User: *user, EmailStatus: emailStatusNone}
	if generated {
		resp.TempPassword = password
		resp.EmailStatus = s.sendInviteEmail(r.Context(), *user, password, false)
	}
	httpx.JSON(w, http.StatusCreated, resp)
}

// handleResendInvite: POST /api/users/{id}/resend-invite — genera una clave
// provisoria nueva y vuelve a mandar el acceso. Solo para quien nunca entro:
// si ya usa la app, lo que corresponde es resetear la contrasena.
func (s *Server) handleResendInvite(w http.ResponseWriter, r *http.Request) {
	user, password, ok := s.resetUserPassword(w, r)
	if !ok {
		return
	}
	if !user.InvitePending() {
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
			"Esa persona ya entro alguna vez: usa Resetear contrasena.")
		return
	}
	httpx.JSON(w, http.StatusOK, createUserResponse{
		User:         *user,
		TempPassword: password,
		EmailStatus:  s.sendInviteEmail(r.Context(), *user, password, false),
	})
}

// handleResetPassword: POST /api/users/{id}/reset-password — clave provisoria
// nueva para quien se la olvido. La persona elige la suya al entrar.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	user, password, ok := s.resetUserPassword(w, r)
	if !ok {
		return
	}
	httpx.JSON(w, http.StatusOK, createUserResponse{
		User:         *user,
		TempPassword: password,
		EmailStatus:  s.sendInviteEmail(r.Context(), *user, password, true),
	})
}

// resetUserPassword es la parte comun de reenviar invitacion y resetear:
// parsea el id, genera la clave nueva y responde los errores. `ok=false`
// significa que ya se respondio.
func (s *Server) resetUserPassword(w http.ResponseWriter, r *http.Request) (*domain.User, string, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrUserNotFound)
		return nil, "", false
	}

	user, password, err := s.auth.ResetPassword(r.Context(), id)
	if err != nil {
		if !mapDomainError(w, err) {
			httpx.Internal(w, r, err)
		}
		return nil, "", false
	}
	return user, password, true
}

type listUsersResponse struct {
	Users []domain.User `json:"users"`
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, listUsersResponse{Users: users})
}
