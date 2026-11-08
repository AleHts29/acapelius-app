package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// handleDeleteUser: DELETE /api/users/{id} — direccion borra un perfil que no
// quiere mas (C21). Solo si nunca hizo nada que cuente plata o entradas: con
// historial, borrarlo dejaria ventas y rendiciones sin dueño; ahi lo que
// corresponde es sacarlo de la temporada.
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrUserNotFound)
		return
	}
	ctx := r.Context()
	if auth.MustUserFrom(ctx).ID == id {
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "No te podés eliminar a vos misma.")
		return
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)

	historial, err := q.UserHasHistory(ctx, sqlcgen.UserHasHistoryParams{ID: id, OrganizationID: s.org(ctx)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrUserNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	if historial {
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
			"Tiene ventas, cobros o ingresos registrados: no se puede eliminar. Sacala de la temporada.")
		return
	}
	if err := q.DeleteUserAllocations(ctx, sqlcgen.DeleteUserAllocationsParams{UserID: id, OrganizationID: s.org(ctx)}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := q.DeleteUserMemberships(ctx, sqlcgen.DeleteUserMembershipsParams{UserID: id, OrganizationID: s.org(ctx)}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if _, err := q.DeleteUser(ctx, sqlcgen.DeleteUserParams{ID: id, OrganizationID: s.org(ctx)}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
