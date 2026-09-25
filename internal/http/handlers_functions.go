package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

type createFunctionRequest struct {
	SeasonID   int64     `json:"season_id"`
	Name       string    `json:"name"`
	Venue      string    `json:"venue"`
	StartsAt   time.Time `json:"starts_at"` // RFC 3339
	Capacity   int32     `json:"capacity"`
	PriceCents int64     `json:"price_cents"`
}

type functionResponse struct {
	Function sqlcgen.Function `json:"function"`
}

type listFunctionsResponse struct {
	Functions []sqlcgen.ListFunctionsRow `json:"functions"`
}

func (s *Server) handleCreateFunction(w http.ResponseWriter, r *http.Request) {
	var req createFunctionRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	req.Venue = strings.TrimSpace(req.Venue)
	if err := domain.ValidateFunction(req.Venue, req.StartsAt, req.Capacity, req.PriceCents); err != nil {
		mapDomainError(w, err)
		return
	}

	// Se chequea que la temporada exista para responder un 404 claro en vez
	// de dejar que reviente la foreign key.
	if _, err := s.queries.GetSeason(r.Context(), sqlcgen.GetSeasonParams{ID: req.SeasonID, OrganizationID: s.org(r.Context())}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrSeasonNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	function, err := s.queries.CreateFunction(r.Context(), sqlcgen.CreateFunctionParams{
		OrganizationID: s.org(r.Context()),
		SeasonID:       req.SeasonID,
		Name:           domain.NormalizeFunctionName(req.Name),
		Venue:          req.Venue,
		StartsAt:       req.StartsAt,
		Capacity:       req.Capacity,
		PriceCents:     req.PriceCents,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, functionResponse{Function: function})
}

func (s *Server) handleListFunctions(w http.ResponseWriter, r *http.Request) {
	var seasonID *int64
	if raw := r.URL.Query().Get("season_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "season_id tiene que ser un numero.")
			return
		}
		if !s.temporadaExiste(w, r, id) {
			return
		}
		seasonID = &id
	}

	functions, err := s.queries.ListFunctions(r.Context(), sqlcgen.ListFunctionsParams{SeasonID: seasonID, OrganizationID: s.org(r.Context())})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, listFunctionsResponse{Functions: functions})
}

// updateFunctionRequest usa punteros para distinguir "no vino" de "vino vacio":
// un PATCH solo toca lo que el cliente mando.
type updateFunctionRequest struct {
	Name       *string    `json:"name"`
	Venue      *string    `json:"venue"`
	StartsAt   *time.Time `json:"starts_at"`
	Capacity   *int32     `json:"capacity"`
	PriceCents *int64     `json:"price_cents"`
}

func (s *Server) handleUpdateFunction(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrFunctionNotFound)
		return
	}

	var req updateFunctionRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	current, err := s.queries.GetFunction(r.Context(), sqlcgen.GetFunctionParams{ID: id, OrganizationID: s.org(r.Context())})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	// Una funcion con ingresos registrados no se edita mas (spec §5.1): a esa
	// altura cambiar fecha, lugar o cupo solo puede generar lio en la puerta.
	checkins, err := s.queries.CountCheckinsForFunction(r.Context(), sqlcgen.CountCheckinsForFunctionParams{FunctionID: id, OrganizationID: s.org(r.Context())})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if checkins > 0 {
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
			"La funcion ya tiene ingresos registrados y no se puede editar.")
		return
	}

	name := current.Name
	if req.Name != nil {
		name = domain.NormalizeFunctionName(*req.Name)
	}
	venue := current.Venue
	if req.Venue != nil {
		venue = strings.TrimSpace(*req.Venue)
	}
	startsAt := current.StartsAt
	if req.StartsAt != nil {
		startsAt = *req.StartsAt
	}
	capacity := current.Capacity
	if req.Capacity != nil {
		capacity = *req.Capacity
	}
	priceCents := current.PriceCents
	if req.PriceCents != nil {
		priceCents = *req.PriceCents
	}

	if err := domain.ValidateFunction(venue, startsAt, capacity, priceCents); err != nil {
		mapDomainError(w, err)
		return
	}

	// El cupo no puede quedar por debajo de lo ya vendido, ni de la suma de
	// asignaciones vigentes (invariante 1 de C8): primero se bajan cupos.
	if capacity < current.Capacity {
		active, err := s.queries.CountActiveTickets(r.Context(), sqlcgen.CountActiveTicketsParams{FunctionID: id, OrganizationID: s.org(r.Context())})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if int64(capacity) < active {
			httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
				fmt.Sprintf("Ya hay %d entradas emitidas: el cupo no puede ser menor.", active))
			return
		}
		assigned, err := s.queries.SumAllocations(r.Context(), sqlcgen.SumAllocationsParams{FunctionID: id, OrganizationID: s.org(r.Context())})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if int64(capacity) < assigned {
			httpx.Error(w, http.StatusConflict, httpx.CodeAllocationExceeded,
				fmt.Sprintf("Hay %d entradas asignadas a coristas: bajá las asignaciones antes de reducir el cupo.", assigned))
			return
		}
	}

	updated, err := s.queries.UpdateFunction(r.Context(), sqlcgen.UpdateFunctionParams{
		OrganizationID: s.org(r.Context()),
		Name:           name,
		Venue:          venue,
		StartsAt:       startsAt,
		Capacity:       capacity,
		PriceCents:     priceCents,
		ID:             id,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, functionResponse{Function: updated})
}

// handleDeleteFunction: DELETE /api/functions/{id} — saca una funcion que se
// cargo por error. Solo si nunca se vendio nada: una funcion con ventas no se
// da de baja con un boton, porque antes hay que decidir que pasa con las
// entradas, con lo que las coristas ya cobraron y con lo que tienen que
// rendir. Eso es una decision, no una accion de pantalla.
func (s *Server) handleDeleteFunction(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrFunctionNotFound)
		return
	}

	ctx := r.Context()
	if _, err := s.queries.GetFunction(ctx, sqlcgen.GetFunctionParams{ID: id, OrganizationID: s.org(ctx)}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	ventas, err := s.queries.CountSalesForFunction(ctx, sqlcgen.CountSalesForFunctionParams{FunctionID: id, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if ventas > 0 {
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
			fmt.Sprintf("La funcion ya tiene %d ventas y no se puede cancelar desde aca.", ventas))
		return
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	q := s.queries.WithTx(tx)
	// Las asignaciones no sobreviven a la funcion: sin funcion no hay cupo
	// que repartir, y la FK las dejaria colgadas.
	if err := q.DeleteAllocationsForFunction(ctx, sqlcgen.DeleteAllocationsForFunctionParams{FunctionID: id, OrganizationID: s.org(ctx)}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := q.DeleteFunction(ctx, sqlcgen.DeleteFunctionParams{ID: id, OrganizationID: s.org(ctx)}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
