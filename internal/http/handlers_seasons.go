package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"

	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

type createSeasonRequest struct {
	Name string `json:"name"`
	// Si la temporada nueva pasa a ser la que miran Inicio, Rendiciones y
	// Direccion. Por omision si: es el caso de "arranca la temporada". En
	// false se puede armar la del año que viene sin mover la de ahora.
	Activate *bool `json:"activate"`
	// Copia la grilla de otra temporada: mismo lugar, cupo y precio, con las
	// fechas corridas un año. Cargar cinco funciones a mano cada año era el
	// trabajo que nadie queria hacer.
	CopyFromSeasonID *int64 `json:"copy_from_season_id"`
	// Si el equipo de esa temporada pasa tambien. Por omision si.
	CopyMembers *bool `json:"copy_members"`
	// Solo estas personas (con su rol) entran a la temporada nueva. Es el
	// resultado del paso de equipo del asistente; sin esto se copia el equipo
	// entero de la anterior.
	Members []seasonMemberInput `json:"members"`
}

type seasonMemberInput struct {
	UserID int64  `json:"user_id"`
	Role   string `json:"role"`
}

type seasonResponse struct {
	Season sqlcgen.Season `json:"season"`
	// Cuantas funciones se copiaron, si se pidio copiar.
	Copied int `json:"copied,omitempty"`
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

	// Hay una sola temporada en curso: la nueva entra activa y apaga a la
	// anterior en la misma transaccion. Con dos activas, Inicio y Rendiciones
	// —que toman "la temporada" sin preguntar— mostraban la vacia.
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	q := s.queries.WithTx(tx)

	activar := req.Activate == nil || *req.Activate
	if activar {
		if err := q.DeactivateAllSeasons(ctx, s.org(ctx)); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}
	// Sin activar: la nueva queda cargada e inactiva, y la de ahora sigue
	// siendo la que mira el resto de la app.
	season, err := q.CreateSeason(ctx, sqlcgen.CreateSeasonParams{
		Name: req.Name, OrganizationID: s.org(ctx), IsActive: activar,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	// Quien crea la temporada entra como direccion: una temporada sin
	// direccion no la puede administrar nadie, y quedaria trabada.
	actor := auth.MustUserFrom(ctx)
	if _, err := q.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
		OrganizationID: s.org(ctx),
		SeasonID:       season.ID, UserID: actor.ID, Role: string(domain.RoleAdmin),
	}); err != nil {
		httpx.Internal(w, r, err)
		return
	}

	// El equipo de la temporada anterior pasa con su rol. Es el default del
	// asistente: vienen todas tildadas y se destilda a las que se fueron.
	if len(req.Members) > 0 {
		for _, m := range req.Members {
			role := domain.Role(m.Role)
			if !role.IsValid() {
				httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "El rol no es valido.")
				return
			}
			if _, err := q.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
				OrganizationID: s.org(ctx),
				SeasonID:       season.ID, UserID: m.UserID, Role: string(role),
			}); err != nil {
				httpx.Internal(w, r, err)
				return
			}
		}
	} else if req.CopyFromSeasonID != nil && (req.CopyMembers == nil || *req.CopyMembers) {
		if err := q.CopySeasonMembers(ctx, sqlcgen.CopySeasonMembersParams{
			OrganizationID: s.org(ctx),
			ToSeasonID:     season.ID,
			FromSeasonID:   *req.CopyFromSeasonID,
		}); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}

	copiadas := 0
	if req.CopyFromSeasonID != nil {
		if _, err := q.GetSeason(ctx, sqlcgen.GetSeasonParams{ID: *req.CopyFromSeasonID, OrganizationID: s.org(ctx)}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				mapDomainError(w, domain.ErrSeasonNotFound)
				return
			}
			httpx.Internal(w, r, err)
			return
		}
		nuevas, err := q.CopySeasonFunctions(ctx, sqlcgen.CopySeasonFunctionsParams{
			OrganizationID: s.org(ctx),
			ToSeasonID:     season.ID,
			FromSeasonID:   *req.CopyFromSeasonID,
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		copiadas = len(nuevas)
	}

	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, seasonResponse{Season: season, Copied: copiadas})
}

// handleActivateSeason: POST /api/seasons/{id}/activate — elige cual es la
// temporada en curso. Es la que miran Inicio, Rendiciones y Direccion.
func (s *Server) handleActivateSeason(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrSeasonNotFound)
		return
	}

	ctx := r.Context()
	if _, err := s.queries.GetSeason(ctx, sqlcgen.GetSeasonParams{ID: id, OrganizationID: s.org(ctx)}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrSeasonNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	// Cambiar a una temporada donde no hay direccion dejaria la app trabada:
	// quien la activa entra como direccion de esa temporada.
	admins, err := s.queries.CountAdminsInSeason(ctx, sqlcgen.CountAdminsInSeasonParams{SeasonID: id, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if admins == 0 {
		actor := auth.MustUserFrom(ctx)
		if _, err := s.queries.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
			OrganizationID: s.org(ctx),
			SeasonID:       id, UserID: actor.ID, Role: string(domain.RoleAdmin),
		}); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err := q.DeactivateAllSeasons(ctx, s.org(ctx)); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := q.SetActiveSeason(ctx, sqlcgen.SetActiveSeasonParams{ID: id, OrganizationID: s.org(ctx)}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	season, err := s.queries.GetSeason(ctx, sqlcgen.GetSeasonParams{ID: id, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, seasonResponse{Season: season})
}

func (s *Server) handleListSeasons(w http.ResponseWriter, r *http.Request) {
	seasons, err := s.queries.ListSeasons(r.Context(), s.org(r.Context()))
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
		errors.Is(err, domain.ErrPaymentNotFound),
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
		errors.Is(err, domain.ErrPaymentAmountInvalid),
		errors.Is(err, domain.ErrPaymentOverBalance),
		errors.Is(err, domain.ErrSettlementMethodInvalid):
		status, code = http.StatusBadRequest, httpx.CodeValidation
	default:
		return false
	}
	httpx.Error(w, status, code, capitalize(err.Error()))
	return true
}

// handleSeasonsOverview: GET /api/reports/seasons — el indice de temporadas
// con el resultado de cada una. Admin-only: lleva plata, a diferencia de
// GET /seasons, que leen todos los roles para elegir funcion.
func (s *Server) handleSeasonsOverview(w http.ResponseWriter, r *http.Request) {
	rows, err := s.queries.SeasonsOverview(r.Context(), s.org(r.Context()))
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	out := make([]seasonOverview, 0, len(rows))
	for _, row := range rows {
		out = append(out, seasonOverview{
			ID:             row.ID,
			Name:           row.Name,
			IsActive:       row.IsActive,
			CreatedAt:      row.CreatedAt,
			Functions:      row.Functions,
			Capacity:       row.Capacity,
			Sold:           row.Sold,
			CollectedCents: row.CollectedCents,
			Assigned:       row.Assigned,
			Sellers:        row.Sellers,
			FirstAt:        sentinelTime(row.FirstAt),
			LastAt:         sentinelTime(row.LastAt),
			NextAt:         sentinelTime(row.NextAt),
		})
	}
	httpx.JSON(w, http.StatusOK, map[string][]seasonOverview{"seasons": out})
}

// seasonOverview es una fila del indice. Las fechas van como puntero porque
// una temporada sin funciones no tiene ni primera ni ultima.
type seasonOverview struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`

	Functions      int64 `json:"functions"`
	Capacity       int64 `json:"capacity"`
	Sold           int64 `json:"sold"`
	CollectedCents int64 `json:"collected_cents"`
	Assigned       int64 `json:"assigned"`
	Sellers        int64 `json:"sellers"`

	FirstAt *time.Time `json:"first_at"`
	LastAt  *time.Time `json:"last_at"`
	NextAt  *time.Time `json:"next_at"`
}
