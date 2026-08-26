package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// parseOptionalID lee un query param numerico opcional. Devuelve ok=false si
// vino y no es un numero (ya respondio el error).
func parseOptionalID(w http.ResponseWriter, r *http.Request, name string) (*int64, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return nil, true
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, name+" tiene que ser un numero.")
		return nil, false
	}
	return &id, true
}

type salesReportResponse struct {
	Rows []sqlcgen.SalesReportRow `json:"rows"`
}

// handleSalesReport: ventas por funcion x vendedora, pagas vs. pendientes.
func (s *Server) handleSalesReport(w http.ResponseWriter, r *http.Request) {
	functionID, ok := parseOptionalID(w, r, "function_id")
	if !ok {
		return
	}
	sellerID, ok := parseOptionalID(w, r, "seller_id")
	if !ok {
		return
	}

	rows, err := s.queries.SalesReport(r.Context(), sqlcgen.SalesReportParams{
		FunctionID: functionID,
		SellerID:   sellerID,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, salesReportResponse{Rows: rows})
}

// settlementRow agrega el saldo calculado a la fila del reporte.
type settlementRow struct {
	sqlcgen.SettlementsReportRow
	BalanceCents int64 `json:"balance_cents"`
}

type settlementsReportResponse struct {
	Rows        []settlementRow              `json:"rows"`
	Settlements []sqlcgen.ListSettlementsRow `json:"settlements"`
}

// handleSettlementsReport: por vendedora, cobrado / rendido / saldo a rendir,
// mas el historial de rendiciones. El admin ve a todas; una vendedora solo su
// propia fila (su "saldo a rendir" del rol seller, spec §3).
func (s *Server) handleSettlementsReport(w http.ResponseWriter, r *http.Request) {
	seasonIDPtr, ok := parseOptionalID(w, r, "season_id")
	if !ok {
		return
	}
	if seasonIDPtr == nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Falta season_id.")
		return
	}
	seasonID := *seasonIDPtr

	user := auth.MustUserFrom(r.Context())
	var onlySeller *int64
	if user.Role != domain.RoleAdmin {
		onlySeller = &user.ID
	}

	rows, err := s.queries.SettlementsReport(r.Context(), seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	out := make([]settlementRow, 0, len(rows))
	for _, row := range rows {
		if onlySeller != nil && row.SellerID != *onlySeller {
			continue
		}
		out = append(out, settlementRow{
			SettlementsReportRow: row,
			BalanceCents:         domain.SettlementBalance(row.CollectedCents, row.SettledCents),
		})
	}

	settlements, err := s.queries.ListSettlements(r.Context(), sqlcgen.ListSettlementsParams{
		SeasonID: seasonID,
		SellerID: onlySeller,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	httpx.JSON(w, http.StatusOK, settlementsReportResponse{Rows: out, Settlements: settlements})
}

// handleListSettlements: GET /api/settlements?season_id=&seller_id= — el
// historial cronologico descendente (C5). Con seller_id filtra a una corista
// (misma query con y sin filtro); una corista solo ve el propio.
func (s *Server) handleListSettlements(w http.ResponseWriter, r *http.Request) {
	seasonIDPtr, ok := parseOptionalID(w, r, "season_id")
	if !ok {
		return
	}
	if seasonIDPtr == nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Falta season_id.")
		return
	}

	sellerID, ok := parseOptionalID(w, r, "seller_id")
	if !ok {
		return
	}
	user := auth.MustUserFrom(r.Context())
	if user.Role != domain.RoleAdmin {
		sellerID = &user.ID
	}

	settlements, err := s.queries.ListSettlements(r.Context(), sqlcgen.ListSettlementsParams{
		SeasonID: *seasonIDPtr,
		SellerID: sellerID,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string][]sqlcgen.ListSettlementsRow{"settlements": settlements})
}

type createSettlementRequest struct {
	SellerID    int64  `json:"seller_id"`
	SeasonID    int64  `json:"season_id"`
	AmountCents int64  `json:"amount_cents"`
	Method      string `json:"method"`
	Notes       string `json:"notes"`
}

func (s *Server) handleCreateSettlement(w http.ResponseWriter, r *http.Request) {
	var req createSettlementRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	if err := domain.ValidateSettlement(req.AmountCents, domain.PaymentMethod(req.Method)); err != nil {
		mapDomainError(w, err)
		return
	}

	// Existencia de vendedora y temporada, para responder 404 claros.
	if _, err := s.queries.GetUserByID(r.Context(), req.SellerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrUserNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	if _, err := s.queries.GetSeason(r.Context(), req.SeasonID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrSeasonNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	settlement, err := s.queries.CreateSettlement(r.Context(), sqlcgen.CreateSettlementParams{
		SellerID:    req.SellerID,
		SeasonID:    req.SeasonID,
		AmountCents: req.AmountCents,
		Method:      req.Method,
		Notes:       optionalText(req.Notes),
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]sqlcgen.Settlement{"settlement": settlement})
}

type attendanceReportResponse struct {
	Function struct {
		ID       int64     `json:"id"`
		Name     *string   `json:"name"`
		Venue    string    `json:"venue"`
		StartsAt time.Time `json:"starts_at"`
		Capacity int32     `json:"capacity"`
	} `json:"function"`
	Issued  int64                          `json:"issued"`
	Entered int64                          `json:"entered"`
	Entries []sqlcgen.AttendanceEntriesRow `json:"entries"`
}

// handleAttendanceReport: emitidas vs. ingresadas y quien entro a que hora.
// La UI lo consulta con polling; no hace falta websockets (spec §11).
func (s *Server) handleAttendanceReport(w http.ResponseWriter, r *http.Request) {
	functionIDPtr, ok := parseOptionalID(w, r, "function_id")
	if !ok {
		return
	}
	if functionIDPtr == nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Falta function_id.")
		return
	}
	functionID := *functionIDPtr

	function, err := s.queries.GetFunction(r.Context(), functionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	issued, err := s.queries.CountActiveTickets(r.Context(), functionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	entered, err := s.queries.CountCheckinsForFunction(r.Context(), functionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	entries, err := s.queries.AttendanceEntries(r.Context(), functionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	var resp attendanceReportResponse
	resp.Function.ID = function.ID
	resp.Function.Name = function.Name
	resp.Function.Venue = function.Venue
	resp.Function.StartsAt = function.StartsAt
	resp.Function.Capacity = function.Capacity
	resp.Issued = issued
	resp.Entered = entered
	resp.Entries = entries

	httpx.JSON(w, http.StatusOK, resp)
}
