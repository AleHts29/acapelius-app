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
	DeviceID   string `json:"device_id,omitempty"` // identifica al dispositivo que sincroniza
}

type checkinResponse struct {
	Result      string     `json:"result"`
	Code        string     `json:"code,omitempty"` // ticket resuelto (eco para el cliente)
	BuyerName   string     `json:"buyer_name,omitempty"`
	SellerName  string     `json:"seller_name,omitempty"`
	CheckedInAt *time.Time `json:"checked_in_at,omitempty"`
	ByName      string     `json:"by_name,omitempty"` // quien lo registro antes
}

// resolveTicketCode saca el codigo del ticket segun el metodo: verifica la
// firma del QR en scan, toma el codigo directo en manual. Devuelve "" si no
// hay codigo utilizable (→ invalid).
func (s *Server) resolveTicketCode(method, payload, code string) (string, bool) {
	switch method {
	case "scan":
		verified, ok := s.signer.Verify(payload)
		if !ok {
			return "", true // metodo valido, QR invalido
		}
		return verified, true
	case "manual":
		return code, true
	default:
		return "", false // metodo desconocido: error de request, no "rojo"
	}
}

// processCheckin ejecuta un check-in y devuelve el resultado discriminado.
// Es la misma logica para el modo online y para cada item del sync offline;
// `at` es el momento real del ingreso (now online, el del cliente en sync).
func (s *Server) processCheckin(r *http.Request, functionID, userID int64, method, code string, deviceID *string, at time.Time) (checkinResponse, error) {
	ctx := r.Context()

	if code == "" {
		return checkinResponse{Result: checkinInvalid}, nil
	}

	ticket, err := s.queries.GetTicketByCode(ctx, sqlcgen.GetTicketByCodeParams{Code: code, OrganizationID: s.org(ctx)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return checkinResponse{Result: checkinInvalid, Code: code}, nil
		}
		return checkinResponse{}, err
	}

	sale, err := s.queries.GetSale(ctx, sqlcgen.GetSaleParams{ID: ticket.SaleID, OrganizationID: s.org(ctx)})
	if err != nil {
		return checkinResponse{}, err
	}
	seller, err := s.queries.GetUserByID(ctx, sqlcgen.GetUserByIDParams{ID: sale.SellerID, OrganizationID: s.org(ctx)})
	if err != nil {
		return checkinResponse{}, err
	}

	resp := checkinResponse{Code: code, BuyerName: sale.BuyerName, SellerName: seller.Name}

	if sale.FunctionID != functionID {
		resp.Result = checkinWrongFunction
		return resp, nil
	}
	if ticket.Status == string(domain.TicketVoid) || sale.VoidedAt != nil {
		resp.Result = checkinVoid
		return resp, nil
	}

	// El UNIQUE(ticket_id) resuelve la carrera: de dos registros simultaneos
	// del mismo ticket (dos escaneos, o dos dispositivos sincronizando),
	// exactamente uno inserta. Gana el primero que llega (spec §6.4).
	checkin, err := s.queries.InsertCheckin(ctx, sqlcgen.InsertCheckinParams{
		OrganizationID: s.org(ctx),
		TicketID:       ticket.ID,
		UserID:         userID,
		Method:         method,
		DeviceID:       deviceID,
		CreatedAt:      at,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Conflicto: ya habia entrado. Rojo con la hora y quien lo marco.
			existing, err := s.queries.GetCheckinByTicket(ctx, sqlcgen.GetCheckinByTicketParams{TicketID: ticket.ID, OrganizationID: s.org(ctx)})
			if err != nil {
				return checkinResponse{}, err
			}
			resp.Result = checkinAlready
			resp.CheckedInAt = &existing.CreatedAt
			resp.ByName = existing.ByName
			return resp, nil
		}
		return checkinResponse{}, err
	}

	if err := s.queries.MarkTicketCheckedIn(ctx, sqlcgen.MarkTicketCheckedInParams{ID: ticket.ID, OrganizationID: s.org(ctx)}); err != nil {
		return checkinResponse{}, err
	}

	resp.Result = checkinOK
	resp.CheckedInAt = &checkin.CreatedAt
	return resp, nil
}

func (s *Server) handleCreateCheckin(w http.ResponseWriter, r *http.Request) {
	var req checkinRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	code, methodOK := s.resolveTicketCode(req.Method, req.Payload, req.Code)
	if !methodOK {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "El metodo tiene que ser scan o manual.")
		return
	}

	if !s.funcionExiste(w, r, req.FunctionID) {
		return
	}
	user := auth.MustUserFrom(r.Context())
	resp, err := s.processCheckin(r, req.FunctionID, user.ID, req.Method, code, optionalText(req.DeviceID), time.Now())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, resp)
}

// funcionExiste verifica que la funcion exista para esta organizacion
// (C17 §A.2): una ajena no existe y responde 404, no "invalid". Escribe el
// error y devuelve false si no.
func (s *Server) funcionExiste(w http.ResponseWriter, r *http.Request, functionID int64) bool {
	ctx := r.Context()
	if _, err := s.queries.GetFunction(ctx, sqlcgen.GetFunctionParams{ID: functionID, OrganizationID: s.org(ctx)}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return false
		}
		httpx.Internal(w, r, err)
		return false
	}
	return true
}

// maxSyncBatch acota el tamano de un sync. La cola offline de una funcion
// entera entra de sobra; un batch mas grande es un cliente roto.
const maxSyncBatch = 1000

type syncCheckinItem struct {
	Payload string    `json:"payload,omitempty"` // scan: el QR completo, se verifica aca
	Code    string    `json:"code,omitempty"`    // manual
	Method  string    `json:"method"`
	At      time.Time `json:"at"` // momento real del ingreso en el dispositivo
}

type syncCheckinsRequest struct {
	FunctionID int64             `json:"function_id"`
	DeviceID   string            `json:"device_id,omitempty"`
	Checkins   []syncCheckinItem `json:"checkins"`
}

type syncCheckinsResponse struct {
	Results []checkinResponse `json:"results"`
}

// handleSyncCheckins procesa la cola offline de un dispositivo (spec §6.3).
// Es idempotente por ticket: reintentar un batch ya procesado devuelve
// already_checked_in en cada item, que el cliente trata igual que ok. Los
// resultados vienen en el mismo orden que los items.
func (s *Server) handleSyncCheckins(w http.ResponseWriter, r *http.Request) {
	var req syncCheckinsRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.Checkins) > maxSyncBatch {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Demasiados check-ins en un solo sync.")
		return
	}

	if !s.funcionExiste(w, r, req.FunctionID) {
		return
	}
	user := auth.MustUserFrom(r.Context())
	deviceID := optionalText(req.DeviceID)
	now := time.Now()

	results := make([]checkinResponse, 0, len(req.Checkins))
	for _, item := range req.Checkins {
		code, methodOK := s.resolveTicketCode(item.Method, item.Payload, item.Code)
		if !methodOK {
			results = append(results, checkinResponse{Result: checkinInvalid})
			continue
		}

		// El reloj del cliente puede estar corrido: un timestamp vacio o
		// futuro se reemplaza por ahora.
		at := item.At
		if at.IsZero() || at.After(now) {
			at = now
		}

		resp, err := s.processCheckin(r, req.FunctionID, user.ID, item.Method, code, deviceID, at)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		results = append(results, resp)
	}

	httpx.JSON(w, http.StatusOK, syncCheckinsResponse{Results: results})
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
// tickets con nombres y estado, y los ingresos ya hechos. El cliente lo
// guarda en IndexedDB para validar localmente sin conexion (spec §6).
func (s *Server) handleDoorSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrFunctionNotFound)
		return
	}

	function, err := s.queries.GetFunction(r.Context(), sqlcgen.GetFunctionParams{ID: id, OrganizationID: s.org(r.Context())})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrFunctionNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	tickets, err := s.queries.DoorSnapshotTickets(r.Context(), sqlcgen.DoorSnapshotTicketsParams{FunctionID: id, OrganizationID: s.org(r.Context())})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	checkins, err := s.queries.DoorSnapshotCheckins(r.Context(), sqlcgen.DoorSnapshotCheckinsParams{FunctionID: id, OrganizationID: s.org(r.Context())})
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
