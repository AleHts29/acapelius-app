package httpapi

import (
	"context"
	"errors"
	"fmt"
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

// ============================================================================
// Panel de Direccion v2 (C9)
// ============================================================================

// requireSeasonID lee season_id obligatorio. ok=false: ya se respondio.
func requireSeasonID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	seasonID, ok := parseOptionalID(w, r, "season_id")
	if !ok {
		return 0, false
	}
	if seasonID == nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Falta season_id.")
		return 0, false
	}
	return *seasonID, true
}

// handleFunctionsSummary: la temporada funcion por funcion (C9).
func (s *Server) handleFunctionsSummary(w http.ResponseWriter, r *http.Request) {
	seasonID, ok := requireSeasonID(w, r)
	if !ok {
		return
	}
	rows, err := s.queries.FunctionsSummary(r.Context(), seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string][]sqlcgen.FunctionsSummaryRow{"functions": rows})
}

// timelineDay es un dia del ritmo de ventas, con cero incluido.
type timelineDay struct {
	Day     string `json:"day"` // YYYY-MM-DD en hora de Buenos Aires
	Tickets int64  `json:"tickets"`
}

type salesTimelineResponse struct {
	Days []timelineDay `json:"days"`
	// Delta = entradas de la ultima semana menos las de la anterior. Es la
	// lectura que le importa a Eli: ¿se esta vendiendo mas o menos?
	Delta int64 `json:"delta"`
	Total int64 `json:"total"`
}

const (
	timelineDefaultDays = 14
	timelineMaxDays     = 90
)

// handleSalesTimeline: entradas vendidas por dia, con los dias vacios en cero
// para que el grafico de barras no mienta sobre el ritmo.
func (s *Server) handleSalesTimeline(w http.ResponseWriter, r *http.Request) {
	seasonID, ok := requireSeasonID(w, r)
	if !ok {
		return
	}

	days := timelineDefaultDays
	if raw := r.URL.Query().Get("days"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > timelineMaxDays {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest,
				fmt.Sprintf("days tiene que ser un numero entre 1 y %d.", timelineMaxDays))
			return
		}
		days = parsed
	}

	// La ventana se calcula en hora de Buenos Aires, igual que el corte del
	// dia en la query: si no, el primer y el ultimo dia quedarian partidos.
	loc, err := time.LoadLocation(s.cfg.TZ)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	since := today.AddDate(0, 0, -(days - 1))

	rows, err := s.queries.SalesTimeline(r.Context(), sqlcgen.SalesTimelineParams{
		SeasonID: seasonID,
		Since:    since,
		Tz:       s.cfg.TZ,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	byDay := make(map[string]int64, len(rows))
	for _, row := range rows {
		byDay[row.Day] = row.Tickets
	}

	resp := salesTimelineResponse{Days: make([]timelineDay, 0, days)}
	for i := 0; i < days; i++ {
		key := since.AddDate(0, 0, i).Format("2006-01-02")
		tickets := byDay[key]
		resp.Days = append(resp.Days, timelineDay{Day: key, Tickets: tickets})
		resp.Total += tickets
		// Ultima mitad menos primera mitad de la ventana.
		if i >= days-days/2 {
			resp.Delta += tickets
		} else if i >= days-2*(days/2) {
			resp.Delta -= tickets
		}
	}

	httpx.JSON(w, http.StatusOK, resp)
}

// Tipos de alerta del panel. El server decide *cuales* hay y con que datos;
// el texto, el icono y el destino los pone el frontend (mismo criterio que el
// resto del design system: la copy vive con la UI).
const (
	alertSettlement = "settlement" // corista con saldo a rendir
	alertAllocation = "allocation" // funcion con entradas sin asignar
	alertInvite     = "invite"     // alguien que nunca entro a la app
)

// attentionAlert es una tarea abierta. Los campos que no aplican al tipo van
// en cero: el frontend usa solo los de su `kind`.
type attentionAlert struct {
	Kind string `json:"kind"`
	Name string `json:"name"` // corista, funcion o persona
	// settlement
	SellerID    int64 `json:"seller_id,omitempty"`
	AmountCents int64 `json:"amount_cents,omitempty"`
	// Lo que el pop-up de rendicion necesita para su encabezado, sin tener que
	// pedir el reporte entero desde la home (C14).
	CollectedCents int64 `json:"collected_cents,omitempty"`
	SettledCents   int64 `json:"settled_cents,omitempty"`
	// allocation
	FunctionID int64      `json:"function_id,omitempty"`
	Missing    int64      `json:"missing,omitempty"`
	Capacity   int32      `json:"capacity,omitempty"`
	StartsAt   *time.Time `json:"starts_at,omitempty"`
	// invite
	UserID int64  `json:"user_id,omitempty"`
	Role   string `json:"role,omitempty"`
	// Since: referencia temporal del pendiente (ultimo cobro / alta).
	Since *time.Time `json:"since,omitempty"`
}

type attentionResponse struct {
	Alerts []attentionAlert `json:"alerts"`
}

// handleAttention: todo lo accionable de la temporada en una sola lista (C9),
// en orden de urgencia: primero la plata, despues los cupos sin repartir de
// la funcion mas proxima, por ultimo las invitaciones sin usar.
func (s *Server) handleAttention(w http.ResponseWriter, r *http.Request) {
	seasonID, ok := requireSeasonID(w, r)
	if !ok {
		return
	}
	alerts, err := s.attentionAlerts(r.Context(), seasonID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, attentionResponse{Alerts: alerts})
}

// attentionAlerts arma la lista de cosas que necesitan a la direccion. Vive
// aparte del handler porque la home (C12) muestra las mismas alertas y tienen
// que ser exactamente las mismas: dos armados distintos es la forma segura de
// que la home y Direccion terminen contando cosas diferentes.
func (s *Server) attentionAlerts(ctx context.Context, seasonID int64) ([]attentionAlert, error) {
	debts, err := s.queries.AttentionSettlements(ctx, seasonID)
	if err != nil {
		return nil, err
	}
	unassigned, err := s.queries.AttentionUnassigned(ctx, seasonID)
	if err != nil {
		return nil, err
	}
	invites, err := s.queries.AttentionPendingInvites(ctx, seasonID)
	if err != nil {
		return nil, err
	}

	alerts := make([]attentionAlert, 0, len(debts)+len(unassigned)+len(invites))
	for _, row := range debts {
		alerts = append(alerts, attentionAlert{
			Kind:           alertSettlement,
			Name:           row.SellerName,
			SellerID:       row.SellerID,
			AmountCents:    row.BalanceCents,
			CollectedCents: row.CollectedCents,
			SettledCents:   row.SettledCents,
			Since:          sentinelTime(row.LastPaidAt),
		})
	}
	for _, row := range unassigned {
		startsAt := row.StartsAt
		name := row.Venue
		if row.Name != nil {
			name = *row.Name
		}
		alerts = append(alerts, attentionAlert{
			Kind:       alertAllocation,
			Name:       name,
			FunctionID: row.FunctionID,
			Missing:    int64(row.Capacity) - row.Assigned,
			Capacity:   row.Capacity,
			StartsAt:   &startsAt,
		})
	}
	for _, row := range invites {
		createdAt := row.CreatedAt
		alerts = append(alerts, attentionAlert{
			Kind:   alertInvite,
			Name:   row.Name,
			UserID: row.UserID,
			Role:   row.Role,
			Since:  &createdAt,
		})
	}

	return alerts, nil
}

// sentinelTime convierte el centinela año 1 de SQL en null (mismo criterio
// que last_email_at en el listado de ventas).
func sentinelTime(t time.Time) *time.Time {
	if t.Year() <= 1 {
		return nil
	}
	return &t
}
