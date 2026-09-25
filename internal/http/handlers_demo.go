package httpapi

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/demo"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// handleDemoSession: POST /api/demo/session — abre una sesion de invitado
// (6 horas, rol direccion, escritura habilitada) contra la organizacion demo
// (C17 §C). Sin formulario: /demo la llama y manda a /app.
func (s *Server) handleDemoSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	org, err := s.queries.GetOrganizationBySlug(ctx, demo.Slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "La demo no esta disponible.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	if !org.IsDemo {
		// Nadie puede colgarse de una organizacion real con este endpoint.
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "La demo no esta disponible.")
		return
	}
	admin, err := s.queries.GetUserByOrgEmail(ctx, sqlcgen.GetUserByOrgEmailParams{
		OrganizationID: org.ID, Email: demo.AdminEmail,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "La demo no esta disponible.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	user, err := s.auth.OpenDemoSession(ctx, admin.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, userResponse{User: *user})
}
