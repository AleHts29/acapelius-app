package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

type createSeasonRequest struct {
	Name string `json:"name"`
}

type seasonResponse struct {
	Season sqlcgen.Season `json:"season"`
}

type listSeasonsResponse struct {
	Seasons []sqlcgen.Season `json:"seasons"`
}

func (s *Server) handleCreateSeason(w http.ResponseWriter, r *http.Request) {
	var req createSeasonRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if err := domain.ValidateSeasonName(req.Name); err != nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, capitalize(err.Error()))
		return
	}

	season, err := s.queries.CreateSeason(r.Context(), req.Name)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, seasonResponse{Season: season})
}

func (s *Server) handleListSeasons(w http.ResponseWriter, r *http.Request) {
	seasons, err := s.queries.ListSeasons(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, listSeasonsResponse{Seasons: seasons})
}

// mapDomainError traduce un error de validacion de dominio a la respuesta HTTP
// que corresponde. Devuelve false si el error no era de validacion.
func mapDomainError(w http.ResponseWriter, err error) bool {
	var status int
	var code string
	switch {
	case errors.Is(err, domain.ErrSeasonNotFound),
		errors.Is(err, domain.ErrFunctionNotFound),
		errors.Is(err, domain.ErrSaleNotFound),
		errors.Is(err, domain.ErrTicketNotFound),
		errors.Is(err, domain.ErrUserNotFound):
		status, code = http.StatusNotFound, httpx.CodeNotFound
	case errors.Is(err, domain.ErrCapacityExceeded),
		errors.Is(err, domain.ErrSaleVoided),
		errors.Is(err, domain.ErrTicketCheckedIn):
		status, code = http.StatusConflict, httpx.CodeConflict
	case errors.Is(err, domain.ErrNotYourSale):
		status, code = http.StatusForbidden, httpx.CodeForbidden
	case errors.Is(err, domain.ErrSeasonNameRequired),
		errors.Is(err, domain.ErrVenueRequired),
		errors.Is(err, domain.ErrStartsAtRequired),
		errors.Is(err, domain.ErrCapacityInvalid),
		errors.Is(err, domain.ErrPriceInvalid),
		errors.Is(err, domain.ErrBuyerNameRequired),
		errors.Is(err, domain.ErrQuantityInvalid),
		errors.Is(err, domain.ErrEmailInvalid),
		errors.Is(err, domain.ErrEmailRequired),
		errors.Is(err, domain.ErrPaymentMethodMissing),
		errors.Is(err, domain.ErrPaymentMethodInvalid),
		errors.Is(err, domain.ErrPaymentStatusInvalid),
		errors.Is(err, domain.ErrCompHasNoPayment),
		errors.Is(err, domain.ErrBuyerEmailMissing),
		errors.Is(err, domain.ErrSettlementAmountInvalid),
		errors.Is(err, domain.ErrSettlementMethodInvalid):
		status, code = http.StatusBadRequest, httpx.CodeValidation
	default:
		return false
	}
	httpx.Error(w, status, code, capitalize(err.Error()))
	return true
}
