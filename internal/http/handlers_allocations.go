package httpapi

import (
	"errors"
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
	updated, err := s.auth.UpdateUser(r.Context(), actor.ID, id,
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

type setAllocationRequest struct {
	UserID     int64 `json:"user_id"`
	FunctionID int64 `json:"function_id"`
	// Quantity 0 borra la asignacion.
	Quantity int32 `json:"quantity"`
}

// handleSetAllocation: Eli le asigna a una corista cuantas entradas de una
// funcion le toca vender. Es un objetivo, no un limite: el unico tope duro
// sigue siendo el cupo de la funcion.
func (s *Server) handleSetAllocation(w http.ResponseWriter, r *http.Request) {
	var req setAllocationRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Quantity < 0 {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "La cantidad no puede ser negativa.")
		return
	}

	if _, err := s.queries.GetUserByID(r.Context(), req.UserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrUserNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	if _, err := s.queries.GetFunction(r.Context(), req.FunctionID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	if req.Quantity == 0 {
		if err := s.queries.DeleteAllocation(r.Context(), sqlcgen.DeleteAllocationParams{
			UserID:     req.UserID,
			FunctionID: req.FunctionID,
		}); err != nil {
			httpx.Internal(w, r, err)
			return
		}
		httpx.NoContent(w)
		return
	}

	allocation, err := s.queries.UpsertAllocation(r.Context(), sqlcgen.UpsertAllocationParams{
		UserID:     req.UserID,
		FunctionID: req.FunctionID,
		Quantity:   req.Quantity,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]sqlcgen.Allocation{"allocation": allocation})
}

// handleListAllocations: con ?function_id= (admin) lista las asignaciones de
// esa funcion con el avance de cada corista; con ?mine=1, las de quien
// pregunta (la corista ve su objetivo).
func (s *Server) handleListAllocations(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUserFrom(r.Context())

	if r.URL.Query().Get("mine") == "1" {
		rows, err := s.queries.MyAllocations(r.Context(), user.ID)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string][]sqlcgen.MyAllocationsRow{"allocations": rows})
		return
	}

	// Por funcion: solo admin (expone el avance de todas).
	if user.Role != domain.RoleAdmin {
		httpx.Error(w, http.StatusForbidden, httpx.CodeForbidden, "No tenes permiso para hacer esto.")
		return
	}
	functionID, ok := parseOptionalID(w, r, "function_id")
	if !ok {
		return
	}
	if functionID == nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Falta function_id (o usa mine=1).")
		return
	}
	rows, err := s.queries.AllocationsByFunction(r.Context(), *functionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string][]sqlcgen.AllocationsByFunctionRow{"allocations": rows})
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
