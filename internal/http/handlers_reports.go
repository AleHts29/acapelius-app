package httpapi

import (
	"errors"
	"net/http"
	"sort"
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

// attendanceCheckin es el ingreso de una entrada puntual (C6).
type attendanceCheckin struct {
	At     time.Time `json:"at"`
	Method string    `json:"method"` // scan | manual
	ByName string    `json:"by_name"`
}

type attendanceTicket struct {
	TicketID int64              `json:"ticket_id"`
	Checkin  *attendanceCheckin `json:"checkin"` // null = sin ingresar
}

// attendanceSale es una fila por comprador: sus entradas con el detalle de
// cada ingreso, mas los agregados que la lista muestra sin expandir.
type attendanceSale struct {
	SaleID        int64              `json:"sale_id"`
	BuyerName     string             `json:"buyer_name"`
	SellerName    string             `json:"seller_name"`
	IsComp        bool               `json:"is_comp"`
	Total         int                `json:"total"`
	Entered       int                `json:"entered"`
	LastCheckinAt *time.Time         `json:"last_checkin_at"`
	LastMethod    *string            `json:"last_method"`
	Tickets       []attendanceTicket `json:"tickets"`
}

type attendanceReportResponse struct {
	Function struct {
		ID       int64     `json:"id"`
		Name     *string   `json:"name"`
		Venue    string    `json:"venue"`
		StartsAt time.Time `json:"starts_at"`
		Capacity int32     `json:"capacity"`
	} `json:"function"`
	Issued         int              `json:"issued"`
	Entered        int              `json:"entered"`
	BuyersTotal    int              `json:"buyers_total"`
	BuyersComplete int              `json:"buyers_complete"`
	Sales          []attendanceSale `json:"sales"`
}

// handleAttendanceReport: asistencia agrupada por comprador (C6) — una fila
// por venta con el estado de cada entrada. La UI lo consulta con polling; no
// hace falta websockets (spec §11).
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

	rows, err := s.queries.AttendanceBySale(r.Context(), functionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	// Las filas vienen ordenadas por (sale_id, ticket_id): se agrupan en una
	// pasada. Los totales salen de las mismas filas, asi el encabezado nunca
	// contradice la suma de los chips k/N.
	sales := make([]attendanceSale, 0)
	for _, row := range rows {
		if len(sales) == 0 || sales[len(sales)-1].SaleID != row.SaleID {
			sales = append(sales, attendanceSale{
				SaleID:     row.SaleID,
				BuyerName:  row.BuyerName,
				SellerName: row.SellerName,
				IsComp:     row.IsComp,
				Tickets:    make([]attendanceTicket, 0, 4),
			})
		}
		sale := &sales[len(sales)-1]
		ticket := attendanceTicket{TicketID: row.TicketID}
		if row.CheckinAt != nil && row.CheckinMethod != nil && row.CheckinBy != nil {
			ticket.Checkin = &attendanceCheckin{
				At:     *row.CheckinAt,
				Method: *row.CheckinMethod,
				ByName: *row.CheckinBy,
			}
			sale.Entered++
			if sale.LastCheckinAt == nil || row.CheckinAt.After(*sale.LastCheckinAt) {
				sale.LastCheckinAt = row.CheckinAt
				sale.LastMethod = row.CheckinMethod
			}
		}
		sale.Total++
		sale.Tickets = append(sale.Tickets, ticket)
	}

	// Ultimo ingreso primero; los que no entraron van al final, por nombre.
	sort.SliceStable(sales, func(i, j int) bool {
		a, b := sales[i].LastCheckinAt, sales[j].LastCheckinAt
		switch {
		case a != nil && b != nil:
			return a.After(*b)
		case a != nil:
			return true
		case b != nil:
			return false
		default:
			return sales[i].BuyerName < sales[j].BuyerName
		}
	})

	var resp attendanceReportResponse
	resp.Function.ID = function.ID
	resp.Function.Name = function.Name
	resp.Function.Venue = function.Venue
	resp.Function.StartsAt = function.StartsAt
	resp.Function.Capacity = function.Capacity
	resp.Sales = sales
	resp.BuyersTotal = len(sales)
	for _, sale := range sales {
		resp.Issued += sale.Total
		resp.Entered += sale.Entered
		if sale.Entered == sale.Total {
			resp.BuyersComplete++
		}
	}

	httpx.JSON(w, http.StatusOK, resp)
}
