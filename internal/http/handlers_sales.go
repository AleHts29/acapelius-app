package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
	"github.com/ale-hts/acapelius/internal/mail"
)

type createSaleRequest struct {
	FunctionID int64  `json:"function_id"`
	BuyerName  string `json:"buyer_name"`
	BuyerEmail string `json:"buyer_email"`
	BuyerPhone string `json:"buyer_phone"`
	Quantity   int32  `json:"quantity"`
	IsComp     bool   `json:"is_comp"`
	Notes      string `json:"notes"`
}

// Estados de envio de email que reporta la API al crear/reenviar.
const (
	emailStatusSent   = "sent"
	emailStatusFailed = "failed"
	emailStatusNone   = "none" // la venta no tiene email
)

type saleResponse struct {
	Sale        sqlcgen.Sale     `json:"sale"`
	Tickets     []sqlcgen.Ticket `json:"tickets"`
	PublicURL   string           `json:"public_url"`
	EmailStatus string           `json:"email_status"`
}

func (s *Server) publicSaleURL(code string) string {
	return s.cfg.BaseURL + "/e/" + code
}

func optionalText(v string) *string {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func (s *Server) handleCreateSale(w http.ResponseWriter, r *http.Request) {
	var req createSaleRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	user := auth.MustUserFrom(r.Context())

	// Las cortesias las emite solo el admin (spec §3).
	if req.IsComp && user.Role != domain.RoleAdmin {
		httpx.Error(w, http.StatusForbidden, httpx.CodeForbidden, "Las cortesias las emite la direccion.")
		return
	}

	req.BuyerName = strings.TrimSpace(req.BuyerName)
	req.BuyerEmail = domain.NormalizeEmail(req.BuyerEmail)
	if err := domain.ValidateNewSale(req.BuyerName, req.BuyerEmail, req.Quantity); err != nil {
		if !mapDomainError(w, err) {
			httpx.Internal(w, r, err)
		}
		return
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback tras commit es un no-op

	q := s.queries.WithTx(tx)

	// El lock sobre la funcion serializa las validaciones de cupo: dos ventas
	// concurrentes no pueden pasar el chequeo a la vez (spec §4).
	function, err := q.GetFunctionForUpdate(ctx, req.FunctionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	active, err := q.CountActiveTickets(ctx, req.FunctionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if !domain.FitsCapacity(function.Capacity, active, req.Quantity) {
		remaining := int64(function.Capacity) - active
		if remaining < 0 {
			remaining = 0
		}
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
			fmt.Sprintf("No queda cupo suficiente: quedan %d entradas.", remaining))
		return
	}

	// Cupo personal en modo estricto (C8): una corista solo vende lo que
	// direccion le asigno para esta funcion. El admin vende sin cupo personal
	// y las cortesias no consumen cupo (ya validaron capacity). Corre dentro
	// de la misma transaccion con la funcion lockeada: dos ventas
	// concurrentes de la misma corista no pueden superar su cupo.
	if !req.IsComp && user.Role != domain.RoleAdmin {
		allocation, err := q.GetAllocationQty(ctx, sqlcgen.GetAllocationQtyParams{
			UserID:     user.ID,
			FunctionID: req.FunctionID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.Error(w, http.StatusConflict, httpx.CodeNoAllocation,
					"No tenés cupo asignado para esta función. Pedile a dirección que te asigne entradas.")
				return
			}
			httpx.Internal(w, r, err)
			return
		}
		sold, err := q.SoldBySellerInFunction(ctx, sqlcgen.SoldBySellerInFunctionParams{
			SellerID:   user.ID,
			FunctionID: req.FunctionID,
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if sold+int64(req.Quantity) > int64(allocation) {
			remaining := int64(allocation) - sold
			if remaining < 0 {
				remaining = 0
			}
			httpx.Error(w, http.StatusConflict, httpx.CodeAllocationExceeded,
				fmt.Sprintf("Llegaste a tu cupo: te quedan %d de %d asignadas. Si necesitás más, pedile a Eli.", remaining, allocation))
			return
		}
	}

	sale, err := q.CreateSale(ctx, sqlcgen.CreateSaleParams{
		FunctionID:  req.FunctionID,
		SellerID:    user.ID,
		Code:        ulid.Make().String(),
		BuyerName:   req.BuyerName,
		BuyerEmail:  optionalText(req.BuyerEmail),
		BuyerPhone:  optionalText(req.BuyerPhone),
		Quantity:    req.Quantity,
		AmountCents: domain.SaleAmount(function.PriceCents, req.Quantity, req.IsComp),
		IsComp:      req.IsComp,
		Notes:       optionalText(req.Notes),
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	tickets := make([]sqlcgen.Ticket, 0, req.Quantity)
	for range req.Quantity {
		ticket, err := q.CreateTicket(ctx, sqlcgen.CreateTicketParams{
			SaleID: sale.ID,
			Code:   ulid.Make().String(),
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		tickets = append(tickets, ticket)
	}

	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}

	// El email va despues del commit: un fallo de envio no anula la venta,
	// queda registrado y se puede reenviar.
	emailStatus := emailStatusNone
	if sale.BuyerEmail != nil {
		emailStatus = s.sendTicketEmail(ctx, sale, function, tickets)
	}

	httpx.JSON(w, http.StatusCreated, saleResponse{
		Sale:        sale,
		Tickets:     tickets,
		PublicURL:   s.publicSaleURL(sale.Code),
		EmailStatus: emailStatus,
	})
}

// sendTicketEmail compone y manda el email de la entrada, y registra el
// resultado en email_sends. Nunca devuelve error: reporta el estado.
func (s *Server) sendTicketEmail(ctx context.Context, sale sqlcgen.Sale, function sqlcgen.Function, tickets []sqlcgen.Ticket) string {
	codes := make([]string, 0, len(tickets))
	for _, t := range tickets {
		if t.Status != string(domain.TicketVoid) {
			codes = append(codes, t.Code)
		}
	}

	functionName := ""
	if function.Name != nil {
		functionName = *function.Name
	}

	msg, err := mail.ComposeTicketEmail(mail.TicketEmailData{
		BuyerName:    sale.BuyerName,
		BuyerEmail:   *sale.BuyerEmail,
		FunctionName: functionName,
		Venue:        function.Venue,
		StartsAt:     function.StartsAt,
		Quantity:     len(codes),
		IsComp:       sale.IsComp,
		PublicURL:    s.publicSaleURL(sale.Code),
		TicketCodes:  codes,
		BaseURL:      s.cfg.BaseURL,
	}, s.signer.PNG)

	status := emailStatusSent
	var sendErr *string
	if err == nil {
		sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		err = s.mailer.Send(sendCtx, msg)
	}
	if err != nil {
		status = emailStatusFailed
		msg := err.Error()
		sendErr = &msg
		slog.ErrorContext(ctx, "fallo el envio del email de la entrada",
			"sale_id", sale.ID, "driver", s.mailer.Name(), "error", err)
	}

	if _, recErr := s.queries.RecordEmailSend(ctx, sqlcgen.RecordEmailSendParams{
		SaleID:    sale.ID,
		Recipient: *sale.BuyerEmail,
		Status:    status,
		Error:     sendErr,
	}); recErr != nil {
		slog.ErrorContext(ctx, "no se pudo registrar el envio de email", "sale_id", sale.ID, "error", recErr)
	}
	return status
}

// saleListItem es la fila del listado con last_email_at ya como puntero.
type saleListItem struct {
	sqlcgen.ListSalesPageRow
	LastEmailAt *time.Time `json:"last_email_at"`
}

type listSalesResponse struct {
	Sales      []saleListItem          `json:"sales"`
	Summary    sqlcgen.SalesSummaryRow `json:"summary"`
	NextCursor string                  `json:"next_cursor,omitempty"`
}

// Paginado del listado (C3). 50 filas por pagina alcanza para scrollear
// fluido; el cursor keyset mantiene los grupos por funcion contiguos.
const salesPageSize = 50

// encodeSalesCursor / decodeSalesCursor: keyset (starts_at, sale_id).
func encodeSalesCursor(startsAt time.Time, id int64) string {
	return fmt.Sprintf("v1:%d:%d", startsAt.UnixNano(), id)
}

func decodeSalesCursor(raw string) (startsAt *time.Time, id *int64, ok bool) {
	if raw == "" {
		return nil, nil, true
	}
	var nanos, saleID int64
	if _, err := fmt.Sscanf(raw, "v1:%d:%d", &nanos, &saleID); err != nil {
		return nil, nil, false
	}
	t := time.Unix(0, nanos)
	return &t, &saleID, true
}

// escapeLike neutraliza los comodines de LIKE en la busqueda del usuario.
func escapeLike(q string) string {
	q = strings.ReplaceAll(q, `\`, `\\`)
	q = strings.ReplaceAll(q, `%`, `\%`)
	q = strings.ReplaceAll(q, `_`, `\_`)
	return q
}

// handleListSales: listado escalable (C3) — q busca por comprador y por
// corista (sin distinguir mayusculas ni acentos), status filtra
// pending|paid|comp, y la respuesta trae el resumen del alcance y el cursor
// de la pagina siguiente.
func (s *Server) handleListSales(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUserFrom(r.Context())
	query := r.URL.Query()

	var sellerID *int64
	// La corista solo ve lo suyo; el admin ve todo, o lo suyo con ?mine=1.
	if user.Role != domain.RoleAdmin || query.Get("mine") == "1" {
		sellerID = &user.ID
	}

	var functionID *int64
	if raw := query.Get("function_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "function_id tiene que ser un numero.")
			return
		}
		functionID = &id
	}

	var status *string
	switch raw := query.Get("status"); raw {
	case "":
	case "pending", "paid", "comp":
		status = &raw
	default:
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "status tiene que ser pending, paid o comp.")
		return
	}

	var q *string
	if raw := strings.TrimSpace(query.Get("q")); raw != "" {
		escaped := escapeLike(raw)
		q = &escaped
	}

	cursorStarts, cursorID, ok := decodeSalesCursor(query.Get("cursor"))
	if !ok {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "cursor invalido.")
		return
	}

	rows, err := s.queries.ListSalesPage(r.Context(), sqlcgen.ListSalesPageParams{
		SellerID:     sellerID,
		FunctionID:   functionID,
		Status:       status,
		Q:            q,
		CursorStarts: cursorStarts,
		CursorID:     cursorID,
		PageSize:     salesPageSize,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	summary, err := s.queries.SalesSummary(r.Context(), sqlcgen.SalesSummaryParams{
		SellerID:   sellerID,
		FunctionID: functionID,
		Q:          q,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	items := make([]saleListItem, 0, len(rows))
	for _, row := range rows {
		item := saleListItem{ListSalesPageRow: row}
		if row.LastEmailAt.Year() > 1 {
			at := row.LastEmailAt
			item.LastEmailAt = &at
		}
		items = append(items, item)
	}

	resp := listSalesResponse{Sales: items, Summary: summary}
	if len(rows) == salesPageSize {
		last := rows[len(rows)-1]
		resp.NextCursor = encodeSalesCursor(last.FunctionStartsAt, last.ID)
	}
	httpx.JSON(w, http.StatusOK, resp)
}

// loadOwnedSale carga una venta y verifica que el usuario pueda operarla:
// la vendedora si es suya, el admin siempre. Escribe la respuesta de error y
// devuelve ok=false si no se puede seguir.
func (s *Server) loadOwnedSale(w http.ResponseWriter, r *http.Request) (sqlcgen.Sale, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrSaleNotFound)
		return sqlcgen.Sale{}, false
	}

	sale, err := s.queries.GetSale(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrSaleNotFound)
			return sqlcgen.Sale{}, false
		}
		httpx.Internal(w, r, err)
		return sqlcgen.Sale{}, false
	}

	user := auth.MustUserFrom(r.Context())
	if user.Role != domain.RoleAdmin && sale.SellerID != user.ID {
		mapDomainError(w, domain.ErrNotYourSale)
		return sqlcgen.Sale{}, false
	}
	return sale, true
}

type updateSalePaymentRequest struct {
	PaymentStatus string `json:"payment_status"`
	PaymentMethod string `json:"payment_method"`
}

func (s *Server) handleUpdateSalePayment(w http.ResponseWriter, r *http.Request) {
	var req updateSalePaymentRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	sale, ok := s.loadOwnedSale(w, r)
	if !ok {
		return
	}
	if sale.VoidedAt != nil {
		mapDomainError(w, domain.ErrSaleVoided)
		return
	}

	method, err := domain.ValidatePaymentChange(sale.IsComp,
		domain.PaymentStatus(req.PaymentStatus), domain.PaymentMethod(req.PaymentMethod))
	if err != nil {
		mapDomainError(w, err)
		return
	}

	// El atajo de siempre, ahora escrito en el historial: "marcar pagó" es un
	// cobro por lo que falte, y "volver a pendiente" borra los cobros de esa
	// venta. Asi los dos botones de la hoja siguen andando igual y dejan
	// rastro, sin un camino paralelo que pudiera desincronizar el cache.
	ctx := r.Context()
	user := auth.MustUserFrom(ctx)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)

	if domain.PaymentStatus(req.PaymentStatus) == domain.PaymentPaid {
		falta := sale.AmountCents - sale.PaidCents
		if falta <= 0 {
			httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "Esa venta ya está cobrada entera.")
			return
		}
		if _, err := q.CreateSalePayment(ctx, sqlcgen.CreateSalePaymentParams{
			SaleID: sale.ID, AmountCents: falta, Method: *method, UserID: user.ID,
		}); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	} else {
		if err := q.DeleteSalePayments(ctx, sale.ID); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}

	updated, err := q.RecalcSalePayment(ctx, sale.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]sqlcgen.Sale{"sale": updated})
}

// ============================================================================
// Cobros parciales
// ============================================================================

type createPaymentRequest struct {
	AmountCents int64  `json:"amount_cents"`
	Method      string `json:"method"`
}

type paymentsResponse struct {
	Sale     sqlcgen.Sale                  `json:"sale"`
	Payments []sqlcgen.ListSalePaymentsRow `json:"payments"`
}

// salePaymentsResponse arma la respuesta comun a alta y baja de cobros: la
// venta ya recalculada y su historial.
func (s *Server) salePaymentsResponse(w http.ResponseWriter, r *http.Request, sale sqlcgen.Sale) {
	payments, err := s.queries.ListSalePayments(r.Context(), sale.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, paymentsResponse{Sale: sale, Payments: payments})
}

// handleListSalePayments: GET /api/sales/{id}/payments — el historial de
// cobros de una venta. Lo ve la corista de esa venta y dirección.
func (s *Server) handleListSalePayments(w http.ResponseWriter, r *http.Request) {
	sale, ok := s.loadOwnedSale(w, r)
	if !ok {
		return
	}
	s.salePaymentsResponse(w, r, sale)
}

// handleCreateSalePayment: POST /api/sales/{id}/payments — registra un cobro,
// total o parcial. El cache de la venta (paid_cents, payment_status y el
// metodo del ultimo cobro) se recalcula entero en la misma transaccion.
func (s *Server) handleCreateSalePayment(w http.ResponseWriter, r *http.Request) {
	var req createPaymentRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	sale, ok := s.loadOwnedSale(w, r)
	if !ok {
		return
	}
	if sale.VoidedAt != nil {
		mapDomainError(w, domain.ErrSaleVoided)
		return
	}
	if err := domain.ValidateSalePayment(sale.IsComp, req.AmountCents,
		sale.AmountCents-sale.PaidCents, domain.PaymentMethod(req.Method)); err != nil {
		mapDomainError(w, err)
		return
	}

	ctx := r.Context()
	user := auth.MustUserFrom(ctx)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)

	if _, err := q.CreateSalePayment(ctx, sqlcgen.CreateSalePaymentParams{
		SaleID: sale.ID, AmountCents: req.AmountCents, Method: req.Method, UserID: user.ID,
	}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	updated, err := q.RecalcSalePayment(ctx, sale.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	s.salePaymentsResponse(w, r, updated)
}

// handleDeleteSalePayment: DELETE /api/sales/{id}/payments/{paymentID} — para
// corregir un cobro mal cargado. Borra ese cobro y recalcula la venta.
func (s *Server) handleDeleteSalePayment(w http.ResponseWriter, r *http.Request) {
	sale, ok := s.loadOwnedSale(w, r)
	if !ok {
		return
	}
	paymentID, err := strconv.ParseInt(chi.URLParam(r, "paymentID"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrPaymentNotFound)
		return
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)

	if _, err := q.DeleteSalePayment(ctx, sqlcgen.DeleteSalePaymentParams{
		ID: paymentID, SaleID: sale.ID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrPaymentNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	updated, err := q.RecalcSalePayment(ctx, sale.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	s.salePaymentsResponse(w, r, updated)
}

func (s *Server) handleResendEmail(w http.ResponseWriter, r *http.Request) {
	sale, ok := s.loadOwnedSale(w, r)
	if !ok {
		return
	}
	if sale.VoidedAt != nil {
		mapDomainError(w, domain.ErrSaleVoided)
		return
	}
	if sale.BuyerEmail == nil {
		mapDomainError(w, domain.ErrBuyerEmailMissing)
		return
	}

	function, err := s.queries.GetFunction(r.Context(), sale.FunctionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	tickets, err := s.queries.ListTicketsBySale(r.Context(), sale.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	status := s.sendTicketEmail(r.Context(), sale, function, tickets)
	httpx.JSON(w, http.StatusOK, map[string]string{"email_status": status})
}

func (s *Server) handleVoidSale(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrSaleNotFound)
		return
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	q := s.queries.WithTx(tx)

	sale, err := q.GetSale(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrSaleNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	// Anular dos veces es un no-op, no un error.
	if sale.VoidedAt == nil {
		checkedIn, err := q.CountTicketsBySaleAndStatus(ctx, sqlcgen.CountTicketsBySaleAndStatusParams{
			SaleID: sale.ID,
			Status: string(domain.TicketCheckedIn),
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if checkedIn > 0 {
			mapDomainError(w, domain.ErrTicketCheckedIn)
			return
		}

		if err := q.VoidTicketsOfSale(ctx, sale.ID); err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if sale, err = q.VoidSale(ctx, sale.ID); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]sqlcgen.Sale{"sale": sale})
}

func (s *Server) handleVoidTicket(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrTicketNotFound)
		return
	}

	ticket, err := s.queries.GetTicket(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrTicketNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	switch domain.TicketStatus(ticket.Status) {
	case domain.TicketCheckedIn:
		mapDomainError(w, domain.ErrTicketCheckedIn)
		return
	case domain.TicketVoid:
		// Idempotente.
	case domain.TicketIssued:
		if ticket, err = s.queries.VoidTicket(r.Context(), ticket.ID); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]sqlcgen.Ticket{"ticket": ticket})
}
