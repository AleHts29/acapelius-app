package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

type updateUserRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	IsActive bool   `json:"is_active"`
}

// handleUpdateUser: el CRUD de coristas del admin — nombre, email, rol y
// activa/inactiva. La baja es logica: la corista no puede entrar mas pero sus
// ventas quedan.
func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrUserNotFound)
		return
	}

	var req updateUserRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	actor := auth.MustUserFrom(r.Context())
	updated, err := s.auth.UpdateUser(r.Context(), actor.OrganizationID, actor.ID, id,
		strings.TrimSpace(req.Name), req.Email, domain.Role(strings.TrimSpace(req.Role)), req.IsActive)
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrEmailTaken):
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "Ya hay un usuario con ese email.")
		return
	case errors.Is(err, domain.ErrSelfLockout):
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, capitalize(err.Error()))
		return
	default:
		if !mapDomainError(w, err) {
			httpx.Internal(w, r, err)
		}
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]domain.User{"user": *updated})
}

// ============================================================================
// Cupos de venta (C8, modo estricto)
// ============================================================================

// handleFunctionAllocationBoard: GET /api/functions/{id}/allocations — todas
// las coristas activas con su cupo asignado y lo vendido (admin).
func (s *Server) handleFunctionAllocationBoard(w http.ResponseWriter, r *http.Request) {
	functionID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrFunctionNotFound)
		return
	}
	function, err := s.queries.GetFunction(r.Context(), sqlcgen.GetFunctionParams{ID: functionID, OrganizationID: s.org(r.Context())})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	rows, err := s.queries.FunctionAllocationBoard(r.Context(), sqlcgen.FunctionAllocationBoardParams{FunctionID: functionID, OrganizationID: s.org(r.Context())})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	var totalAssigned int64
	for _, row := range rows {
		totalAssigned += int64(row.Assigned)
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"capacity":       function.Capacity,
		"total_assigned": totalAssigned,
		"allocations":    rows,
	})
}

type putAllocationsRequest struct {
	Allocations []struct {
		UserID   int64 `json:"user_id"`
		Quantity int32 `json:"quantity"`
	} `json:"allocations"`
}

// handlePutAllocations: PUT /api/functions/{id}/allocations — upsert batch
// con los invariantes del modo estricto, validados en transaccion con la
// funcion lockeada (la misma serializacion que usa el capacity de ventas):
//  1. SUM(allocations) <= capacity                (allocation_exceeded)
//  2. cada cupo >= lo ya vendido por esa corista  (allocation_below_sold)
//
// Cantidad 0 borra la asignacion.
func (s *Server) handlePutAllocations(w http.ResponseWriter, r *http.Request) {
	functionID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrFunctionNotFound)
		return
	}

	var req putAllocationsRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	for _, entry := range req.Allocations {
		if entry.Quantity < 0 {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Las cantidades no pueden ser negativas.")
			return
		}
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	q := s.queries.WithTx(tx)

	function, err := q.GetFunctionForUpdate(ctx, sqlcgen.GetFunctionForUpdateParams{ID: functionID, OrganizationID: s.org(ctx)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	// Invariante 2: ningun cupo por debajo de lo vendido por esa corista.
	for _, entry := range req.Allocations {
		seller, err := q.GetUserByID(ctx, sqlcgen.GetUserByIDParams{ID: entry.UserID, OrganizationID: s.org(ctx)})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				mapDomainError(w, domain.ErrUserNotFound)
				return
			}
			httpx.Internal(w, r, err)
			return
		}
		// Solo coristas de la temporada de esta funcion: el tablero muestra
		// esas y solo esas se cuentan al validar. Un cupo para otra persona
		// quedaria invisible en pantalla.
		miembro, err := q.GetMembership(ctx, sqlcgen.GetMembershipParams{
			OrganizationID: s.org(ctx),
			SeasonID:       function.SeasonID,
			UserID:         entry.UserID,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			httpx.Internal(w, r, err)
			return
		}
		if errors.Is(err, pgx.ErrNoRows) || miembro.Role != string(domain.RoleSeller) || miembro.LeftAt != nil {
			httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
				fmt.Sprintf("%s no es una corista de esta temporada: no se le puede asignar cupo.", seller.Name))
			return
		}
		sold, err := q.SoldBySellerInFunction(ctx, sqlcgen.SoldBySellerInFunctionParams{
			OrganizationID: s.org(ctx),
			SellerID:       entry.UserID,
			FunctionID:     functionID,
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if int64(entry.Quantity) < sold {
			httpx.Error(w, http.StatusConflict, httpx.CodeAllocationBelowSold,
				fmt.Sprintf("%s ya vendió %d: no podés bajar de %d.", seller.Name, sold, sold))
			return
		}
	}

	// Aplicar el batch y despues validar el invariante 1 sobre el resultado.
	for _, entry := range req.Allocations {
		if entry.Quantity == 0 {
			if err := q.DeleteAllocation(ctx, sqlcgen.DeleteAllocationParams{
				OrganizationID: s.org(ctx),
				UserID:         entry.UserID,
				FunctionID:     functionID,
			}); err != nil {
				httpx.Internal(w, r, err)
				return
			}
			continue
		}
		if _, err := q.UpsertAllocation(ctx, sqlcgen.UpsertAllocationParams{
			OrganizationID: s.org(ctx),
			UserID:         entry.UserID,
			FunctionID:     functionID,
			Quantity:       entry.Quantity,
		}); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}

	totalAssigned, err := q.SumAllocations(ctx, sqlcgen.SumAllocationsParams{FunctionID: functionID, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if totalAssigned > int64(function.Capacity) {
		// El rollback del defer descarta el batch completo.
		httpx.Error(w, http.StatusConflict, httpx.CodeAllocationExceeded,
			fmt.Sprintf("Las asignaciones suman %d y el cupo de la función es %d.", totalAssigned, function.Capacity))
		return
	}

	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"total_assigned": totalAssigned,
		"remaining":      int64(function.Capacity) - totalAssigned,
	})
}

// handleMyAllocations: GET /api/me/allocations — el cupo de la corista
// logueada por funcion, con vendido y restante (?function_id= filtra).
func (s *Server) handleMyAllocations(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUserFrom(r.Context())

	rows, err := s.queries.MyAllocations(r.Context(), sqlcgen.MyAllocationsParams{UserID: user.ID, OrganizationID: s.org(r.Context())})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	functionID, ok := parseOptionalID(w, r, "function_id")
	if !ok {
		return
	}

	type myAllocation struct {
		sqlcgen.MyAllocationsRow
		Remaining int64 `json:"remaining"`
	}
	out := make([]myAllocation, 0, len(rows))
	for _, row := range rows {
		if functionID != nil && row.FunctionID != *functionID {
			continue
		}
		remaining := int64(row.Assigned) - row.Sold
		if remaining < 0 {
			remaining = 0
		}
		out = append(out, myAllocation{MyAllocationsRow: row, Remaining: remaining})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"allocations": out})
}

// handlePublicTicket: la pagina publica de UNA entrada (/t/{code}), para que
// el comprador reenvie cada QR a la persona que va a usarlo.
func (s *Server) handlePublicTicket(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")

	row, err := s.queries.GetPublicTicket(r.Context(), code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "Esta entrada no existe.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	resp := map[string]any{
		"code":          row.Code,
		"status":        row.Status,
		"buyer_name":    row.BuyerName,
		"seller_name":   row.SellerName,
		"is_comp":       row.IsComp,
		"voided":        row.VoidedAt != nil || row.Status == string(domain.TicketVoid),
		"ticket_index":  row.TicketIndex,
		"sale_quantity": row.SaleQuantity,
		"function": map[string]any{
			"name":      row.FunctionName,
			"venue":     row.Venue,
			"starts_at": row.StartsAt,
		},
	}
	if row.VoidedAt == nil && row.Status != string(domain.TicketVoid) {
		resp["payload"] = s.signer.Payload(row.Code)
	}
	httpx.JSON(w, http.StatusOK, resp)
}
