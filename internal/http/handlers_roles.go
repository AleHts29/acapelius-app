package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// Roles propios (C21): direccion le pone nombre a un rol ("Acomodador",
// "Tesoreria") y elige de cual de los tres de base copia los permisos. Los
// permisos siguen saliendo del rol de base; el propio solo nombra.

type customRolesResponse struct {
	Roles []sqlcgen.CustomRole `json:"roles"`
}

// handleListRoles: GET /api/roles — los roles propios de la organizacion.
func (s *Server) handleListRoles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	roles, err := s.queries.ListCustomRoles(ctx, s.org(ctx))
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if roles == nil {
		roles = []sqlcgen.CustomRole{}
	}
	httpx.JSON(w, http.StatusOK, customRolesResponse{Roles: roles})
}

// handleCreateRole: POST /api/roles {name, base_role}.
func (s *Server) handleCreateRole(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		BaseRole string `json:"base_role"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || utf8.RuneCountInString(req.Name) > 40 {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "El nombre del rol tiene que tener entre 1 y 40 letras.")
		return
	}
	if !domain.Role(req.BaseRole).IsValid() {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Elegí de qué rol copia los permisos.")
		return
	}
	for _, base := range []string{"corista", "puerta", "dirección", "direccion"} {
		if strings.EqualFold(req.Name, base) {
			httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "Ese rol ya existe.")
			return
		}
	}
	ctx := r.Context()
	role, err := s.queries.CreateCustomRole(ctx, sqlcgen.CreateCustomRoleParams{
		OrganizationID: s.org(ctx), Name: req.Name, BaseRole: req.BaseRole,
	})
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "Ya hay un rol con ese nombre.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]sqlcgen.CustomRole{"role": role})
}

// handleDeleteRole: DELETE /api/roles/{id}. Quien lo tenia no pierde nada:
// sigue con los permisos de base, y vuelve a verse el nombre de base.
func (s *Server) handleDeleteRole(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "Ese rol no existe.")
		return
	}
	ctx := r.Context()
	n, err := s.queries.DeleteCustomRole(ctx, sqlcgen.DeleteCustomRoleParams{ID: id, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if n == 0 {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "Ese rol no existe.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// rolPropio resuelve el rol pedido: si viene custom_role_id, el rol de base
// sale de ahi (y pisa el que haya mandado el cliente). Escribe el error y
// devuelve false si el rol no es de esta organizacion.
func (s *Server) rolPropio(w http.ResponseWriter, r *http.Request, customRoleID *int64, role *domain.Role) bool {
	if customRoleID == nil {
		return true
	}
	ctx := r.Context()
	cr, err := s.queries.GetCustomRole(ctx, sqlcgen.GetCustomRoleParams{ID: *customRoleID, OrganizationID: s.org(ctx)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Ese rol no existe.")
			return false
		}
		httpx.Internal(w, r, err)
		return false
	}
	*role = domain.Role(cr.BaseRole)
	return true
}

// ponerRolPropio guarda (o saca, con nil) el nombre propio de la persona en
// una temporada. Va despues de UpsertMembership, que lo limpia si cambia el rol.
func (s *Server) ponerRolPropio(r *http.Request, seasonID, userID int64, customRoleID *int64) error {
	ctx := r.Context()
	return s.queries.SetMembershipCustomRole(ctx, sqlcgen.SetMembershipCustomRoleParams{
		CustomRoleID: customRoleID, SeasonID: seasonID, UserID: userID, OrganizationID: s.org(ctx),
	})
}

// ponerRolPropioEnCurso: lo mismo, en la temporada en curso (alta y edicion).
func (s *Server) ponerRolPropioEnCurso(r *http.Request, userID int64, customRoleID *int64) error {
	ctx := r.Context()
	season, err := s.queries.GetActiveSeason(ctx, s.org(ctx))
	if err != nil {
		return err
	}
	return s.ponerRolPropio(r, season.ID, userID, customRoleID)
}
