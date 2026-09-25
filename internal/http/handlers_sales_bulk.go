package httpapi

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// Tope de una accion en lote. No es una limitacion tecnica: es que 200 emails
// o 200 cobros de un click son una decision que conviene tomar en tandas.
const maxBulk = 200

type bulkRequest struct {
	SaleIDs []int64 `json:"sale_ids"`
	Method  string  `json:"method"`
}

// cargarSeleccion valida los ids y trae las ventas, verificando que quien pide
// pueda operarlas: la corista solo las suyas.
func (s *Server) cargarSeleccion(w http.ResponseWriter, r *http.Request, ids []int64) ([]sqlcgen.SalesByIDsRow, bool) {
	if len(ids) == 0 {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "No hay ninguna venta seleccionada.")
		return nil, false
	}
	if len(ids) > maxBulk {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation,
			fmt.Sprintf("Son demasiadas de una vez: el maximo es %d.", maxBulk))
		return nil, false
	}

	ventas, err := s.queries.SalesByIDs(r.Context(), sqlcgen.SalesByIDsParams{Ids: ids, OrganizationID: s.org(r.Context())})
	if err != nil {
		httpx.Internal(w, r, err)
		return nil, false
	}
	if len(ventas) != len(ids) {
		mapDomainError(w, domain.ErrSaleNotFound)
		return nil, false
	}

	user := auth.MustUserFrom(r.Context())
	if user.Role != domain.RoleAdmin {
		for _, v := range ventas {
			if v.SellerID != user.ID {
				mapDomainError(w, domain.ErrNotYourSale)
				return nil, false
			}
		}
	}
	return ventas, true
}

// handleBulkPayment: POST /api/sales/bulk-payment — cobra de una lo que falte
// de varias ventas. Cada cobro entra al historial como cualquier otro: en
// lote o de a una, la venta termina contando lo mismo.
func (s *Server) handleBulkPayment(w http.ResponseWriter, r *http.Request) {
	var req bulkRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	ventas, ok := s.cargarSeleccion(w, r, req.SaleIDs)
	if !ok {
		return
	}
	if req.Method != string(domain.MethodCash) && req.Method != string(domain.MethodTransfer) {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation,
			"El metodo tiene que ser cash o transfer.")
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

	cobradas, omitidas := 0, 0
	var total int64
	for _, v := range ventas {
		// Anuladas, cortesias y ya cobradas se saltean sin romper el lote: en
		// una seleccion de veinte, que una no aplique no puede frenar al resto.
		falta := v.AmountCents - v.PaidCents
		if v.VoidedAt != nil || v.IsComp || falta <= 0 {
			omitidas++
			continue
		}
		if _, err := q.CreateSalePayment(ctx, sqlcgen.CreateSalePaymentParams{
			SaleID: v.ID, AmountCents: falta, Method: req.Method, UserID: user.ID,
		}); err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if _, err := q.RecalcSalePayment(ctx, v.ID); err != nil {
			httpx.Internal(w, r, err)
			return
		}
		cobradas++
		total += falta
	}

	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"charged": cobradas, "skipped": omitidas, "amount_cents": total,
	})
}

// handleBulkResend: POST /api/sales/bulk-resend — reenvia las entradas de la
// seleccion. Las que no tienen email se omiten y se informan.
func (s *Server) handleBulkResend(w http.ResponseWriter, r *http.Request) {
	var req bulkRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	ventas, ok := s.cargarSeleccion(w, r, req.SaleIDs)
	if !ok {
		return
	}

	ctx := r.Context()
	enviados, fallidos, sinEmail, preview := 0, 0, 0, 0
	for _, v := range ventas {
		if v.BuyerEmail == nil || *v.BuyerEmail == "" {
			sinEmail++
			continue
		}
		if v.VoidedAt != nil {
			sinEmail++
			continue
		}
		sale, err := s.queries.GetSale(ctx, sqlcgen.GetSaleParams{ID: v.ID, OrganizationID: s.org(ctx)})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		function, err := s.queries.GetFunction(ctx, sqlcgen.GetFunctionParams{ID: sale.FunctionID, OrganizationID: s.org(ctx)})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		tickets, err := s.queries.ListTicketsBySale(ctx, sale.ID)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		switch s.sendTicketEmail(ctx, sale, function, tickets) {
		case emailStatusSent:
			enviados++
		case emailStatusPreview:
			preview++
		default:
			fallidos++
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]int{
		"sent": enviados, "failed": fallidos, "no_email": sinEmail, "preview": preview,
	})
}

// handleExportSales: GET /api/sales/export — el CSV de lo que se está mirando.
// Acepta los mismos filtros que el listado, o `ids` para exportar solo una
// seleccion. Sale del server y no del cliente para que exporte TODO el filtro
// y no las filas que se alcanzaron a cargar.
func (s *Server) handleExportSales(w http.ResponseWriter, r *http.Request) {
	user := auth.MustUserFrom(r.Context())
	query := r.URL.Query()

	var seleccion map[int64]bool
	if raw := query.Get("ids"); raw != "" {
		seleccion = map[int64]bool{}
		for _, part := range strings.Split(raw, ",") {
			id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
			if err != nil {
				httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "ids invalido.")
				return
			}
			seleccion[id] = true
		}
	}

	var sellerID *int64
	if user.Role != domain.RoleAdmin || query.Get("mine") == "1" {
		sellerID = &user.ID
	} else if raw := query.Get("seller_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "seller_id tiene que ser un numero.")
			return
		}
		sellerID = &id
	}

	var functionID *int64
	if raw := query.Get("function_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "function_id tiene que ser un numero.")
			return
		}
		if !s.funcionExiste(w, r, id) {
			return
		}
		functionID = &id
	}

	var status *string
	switch raw := query.Get("status"); raw {
	case "":
	case "pending", "paid", "comp", "void":
		status = &raw
	default:
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "status invalido.")
		return
	}

	var q *string
	if raw := strings.TrimSpace(query.Get("q")); raw != "" {
		escaped := escapeLike(raw)
		q = &escaped
	}

	seasonID, ok := s.seasonDelListado(w, r)
	if !ok {
		return
	}

	// Se pagina con el mismo keyset del listado hasta juntar todo: el CSV es
	// del filtro entero, no de una pagina.
	var filas []sqlcgen.ListSalesPageRow
	var cursorPast *int32
	var cursorRank = pgtypeFloat8Null()
	var cursorID *int64
	for range 200 { // 200 * 50 = 10.000 ventas, mas que una temporada entera
		page, err := s.queries.ListSalesPage(r.Context(), sqlcgen.ListSalesPageParams{
			OrganizationID: s.org(r.Context()),
			SeasonID:       seasonID,
			SellerID:       sellerID,
			FunctionID:     functionID,
			Status:         status,
			Q:              q,
			CursorPast:     cursorPast,
			CursorRank:     cursorRank,
			CursorID:       cursorID,
			PageSize:       salesPageSize,
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		filas = append(filas, page...)
		if len(page) < salesPageSize {
			break
		}
		last := page[len(page)-1]
		cursorPast, cursorRank, cursorID = ptrInt32(last.PastRank), float8(last.FnRank), ptrInt64(last.ID)
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="ventas-%s.csv"`, time.Now().Format("2006-01-02")))
	// BOM: sin esto Excel abre los acentos rotos.
	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return
	}

	cw := csv.NewWriter(w)
	defer cw.Flush()
	_ = cw.Write([]string{
		"Función", "Fecha función", "Comprador", "Email", "Vendedora",
		"Entradas", "Total", "Cobrado", "Debe", "Estado", "Método", "Vendida",
	})
	for _, row := range filas {
		if seleccion != nil && !seleccion[row.ID] {
			continue
		}
		nombreFn := row.FunctionVenue
		if row.FunctionName != nil && *row.FunctionName != "" {
			nombreFn = *row.FunctionName
		}
		email := ""
		if row.BuyerEmail != nil {
			email = *row.BuyerEmail
		}
		metodo := ""
		if row.PaymentMethod != nil {
			metodo = *row.PaymentMethod
		}
		_ = cw.Write([]string{
			nombreFn,
			row.FunctionStartsAt.Format("2006-01-02 15:04"),
			row.BuyerName,
			email,
			row.SellerName,
			strconv.FormatInt(int64(row.Quantity), 10),
			pesos(row.AmountCents),
			pesos(row.PaidCents),
			pesos(row.AmountCents - row.PaidCents),
			estadoDeVenta(row),
			metodo,
			row.CreatedAt.Format("2006-01-02"),
		})
	}
}

// estadoDeVenta: el mismo texto que muestra el chip de la fila.
func estadoDeVenta(row sqlcgen.ListSalesPageRow) string {
	switch {
	case row.VoidedAt != nil:
		return "Anulada"
	case row.IsComp:
		return "Cortesía"
	case row.PaymentStatus == string(domain.PaymentPaid):
		return "Pagó"
	default:
		return "Debe"
	}
}

// pesos: centavos a "8000.00" con punto decimal, que es lo que espera una
// planilla. El formato con separador de miles se lee lindo y no se suma.
func pesos(cents int64) string {
	return strconv.FormatFloat(float64(cents)/100, 'f', 2, 64)
}

// handleSellersWithSales: GET /api/reports/sellers — las coristas que
// aparecen en el listado, con cuantas ventas tienen. Alimenta el menu
// "Todas las vendedoras" con el conteo de cada opcion.
func (s *Server) handleSellersWithSales(w http.ResponseWriter, r *http.Request) {
	var functionID *int64
	if raw := r.URL.Query().Get("function_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "function_id tiene que ser un numero.")
			return
		}
		if !s.funcionExiste(w, r, id) {
			return
		}
		functionID = &id
	}
	seasonID, ok := s.seasonDelListado(w, r)
	if !ok {
		return
	}
	rows, err := s.queries.SellersWithSales(r.Context(), sqlcgen.SellersWithSalesParams{
		OrganizationID: s.org(r.Context()),
		SeasonID:       seasonID,
		FunctionID:     functionID,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string][]sqlcgen.SellersWithSalesRow{"sellers": rows})
}
