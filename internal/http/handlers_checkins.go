package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// Resultados de un intento de check-in. Son estados esperados del flujo de
// puerta, no errores: viajan con HTTP 200 y la UI decide verde o rojo.
const (
	checkinOK            = "ok"
	checkinAlready       = "already_checked_in"
	checkinInvalid       = "invalid"
	checkinVoid          = "void"
	checkinWrongFunction = "wrong_function"
)

type checkinRequest struct {
	FunctionID int64  `json:"function_id"`
	Method     string `json:"method"`              // 'scan' | 'manual'
	Payload    string `json:"payload,omitempty"`   // scan: contenido del QR
	Code       string `json:"code,omitempty"`      // manual: codigo del ticket
	DeviceID   string `json:"device_id,omitempty"` // para el sync offline (fase 4)
}

type checkinResponse struct {
	Result      string     `json:"result"`
	BuyerName   string     `json:"buyer_name,omitempty"`
	SellerName  string     `json:"seller_name,omitempty"`
	CheckedInAt *time.Time `json:"checked_in_at,omitempty"`
	ByName      string     `json:"by_name,omitempty"` // quien lo registro antes
}

func (s *Server) handleCreateCheckin(w http.ResponseWriter, r *http.Request) {
	var req checkinRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	// El codigo sale del QR firmado (scan) o directo del snapshot (manual).
	var code string
	switch req.Method {
	case "scan":
		verified, ok := s.signer.Verify(req.Payload)
		if !ok {
			// Firma invalida: QR ajeno o adulterado. Rojo.
			httpx.JSON(w, http.StatusOK, checkinResponse{Result: checkinInvalid})
			return
		}
		code = verified
	case "manual":
		code = req.Code
	default:
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "El metodo tiene que ser scan o manual.")
		return
	}
	if code == "" {
		httpx.JSON(w, http.StatusOK, checkinResponse{Result: checkinInvalid})
		return
	}

	ctx := r.Context()
	ticket, err := s.queries.GetTicketByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.JSON(w, http.StatusOK, checkinResponse{Result: checkinInvalid})
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	sale, err := s.queries.GetSale(ctx, ticket.SaleID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	seller, err := s.queries.GetUserByID(ctx, sale.SellerID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	resp := checkinResponse{BuyerName: sale.BuyerName, SellerName: seller.Name}

	if sale.FunctionID != req.FunctionID {
		resp.Result = checkinWrongFunction
		httpx.JSON(w, http.StatusOK, resp)
		return
	}
	if ticket.Status == string(domain.TicketVoid) || sale.VoidedAt != nil {
		resp.Result = checkinVoid
		httpx.JSON(w, http.StatusOK, resp)
		return
	}

	user := auth.MustUserFrom(ctx)
	now := time.Now()

	// El UNIQUE(ticket_id) resuelve la carrera: de dos escaneos simultaneos
	// del mismo ticket, exactamente uno inserta.
	checkin, err := s.queries.InsertCheckin(ctx, sqlcgen.InsertCheckinParams{
		TicketID:  ticket.ID,
		UserID:    user.ID,
		Method:    req.Method,
		DeviceID:  optionalText(req.DeviceID),
		CreatedAt: now,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Conflicto: ya habia entrado. Rojo con la hora y quien lo marco.
			existing, err := s.queries.GetCheckinByTicket(ctx, ticket.ID)
			if err != nil {
				httpx.Internal(w, r, err)
				return
			}
			resp.Result = checkinAlready
			resp.CheckedInAt = &existing.CreatedAt
			resp.ByName = existing.ByName
			httpx.JSON(w, http.StatusOK, resp)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	if err := s.queries.MarkTicketCheckedIn(ctx, ticket.ID); err != nil {
		httpx.Internal(w, r, err)
		return
	}

	resp.Result = checkinOK
	resp.CheckedInAt = &checkin.CreatedAt
	httpx.JSON(w, http.StatusOK, resp)
}

type doorSnapshotResponse struct {
	Function struct {
		ID       int64     `json:"id"`
		Name     *string   `json:"name"`
		Venue    string    `json:"venue"`
		StartsAt time.Time `json:"starts_at"`
		Capacity int32     `json:"capacity"`
	} `json:"function"`
	Tickets  []sqlcgen.DoorSnapshotTicketsRow  `json:"tickets"`
	Checkins []sqlcgen.DoorSnapshotCheckinsRow `json:"checkins"`
}

// handleDoorSnapshot devuelve todo lo que la puerta necesita de una funcion:
// tickets con nombres y estado, y los ingresos ya hechos. En la fase 4 este
// mismo snapshot se precarga en IndexedDB para trabajar sin conexion.
func (s *Server) handleDoorSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrFunctionNotFound)
		return
	}

	function, err := s.queries.GetFunction(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	tickets, err := s.queries.DoorSnapshotTickets(r.Context(), id)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	checkins, err := s.queries.DoorSnapshotCheckins(r.Context(), id)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	var resp doorSnapshotResponse
	resp.Function.ID = function.ID
	resp.Function.Name = function.Name
	resp.Function.Venue = function.Venue
	resp.Function.StartsAt = function.StartsAt
	resp.Function.Capacity = function.Capacity
	resp.Tickets = tickets
	resp.Checkins = checkins

	httpx.JSON(w, http.StatusOK, resp)
}
