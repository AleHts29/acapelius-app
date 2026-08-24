package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// publicTicket es lo que ve el comprador de cada entrada. El payload es lo que
// se dibuja como QR en el browser.
type publicTicket struct {
	Code    string `json:"code"`
	Payload string `json:"payload"`
	Status  string `json:"status"`
}

type publicFunction struct {
	Name     *string   `json:"name"`
	Venue    string    `json:"venue"`
	StartsAt time.Time `json:"starts_at"`
}

type publicSaleResponse struct {
	BuyerName  string         `json:"buyer_name"`
	SellerName string         `json:"seller_name"`
	Quantity   int32          `json:"quantity"`
	IsComp     bool           `json:"is_comp"`
	Voided     bool           `json:"voided"`
	Function   publicFunction `json:"function"`
	Tickets    []publicTicket `json:"tickets"`
}

// handlePublicSale es la pagina publica de la entrada (spec §7): sin login,
// autorizada por el sale_code no adivinable. No expone email ni telefono del
// comprador, ni montos.
func (s *Server) handlePublicSale(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")

	sale, err := s.queries.GetSaleByCode(r.Context(), code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "Esta entrada no existe.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	function, err := s.queries.GetFunction(r.Context(), sale.FunctionID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	seller, err := s.queries.GetUserByID(r.Context(), sale.SellerID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	tickets, err := s.queries.ListTicketsBySale(r.Context(), sale.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	resp := publicSaleResponse{
		BuyerName:  sale.BuyerName,
		SellerName: seller.Name,
		Quantity:   sale.Quantity,
		IsComp:     sale.IsComp,
		Voided:     sale.VoidedAt != nil,
		Function: publicFunction{
			Name:     function.Name,
			Venue:    function.Venue,
			StartsAt: function.StartsAt,
		},
	}
	for _, t := range tickets {
		pt := publicTicket{Code: t.Code, Status: t.Status}
		// Una entrada anulada no lleva QR valido; se muestra su estado.
		if t.Status != string(domain.TicketVoid) {
			pt.Payload = s.signer.Payload(t.Code)
		}
		resp.Tickets = append(resp.Tickets, pt)
	}

	httpx.JSON(w, http.StatusOK, resp)
}

// handlePublicTicketPNG sirve el QR de un ticket como imagen, para el email.
func (s *Server) handlePublicTicketPNG(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")

	ticket, err := s.queries.GetTicketByCode(r.Context(), code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "Esta entrada no existe.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	png, err := s.signer.PNG(ticket.Code)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	// El payload de un ticket no cambia nunca: cache larga.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(png)
}
