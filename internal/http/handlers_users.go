package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
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

	resp := createUserResponse{User: *user}
	if generated {
		resp.TempPassword = password
	}
	httpx.JSON(w, http.StatusCreated, resp)
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
