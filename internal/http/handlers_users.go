package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/db/sqlcgen"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
	"github.com/ale-hts/acapelius/internal/mail"
)

type createUserRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
	// Password es opcional: si no viene, el server genera una provisoria y la
	// devuelve una unica vez para que el admin se la pase a la persona.
	Password string `json:"password"`
}

type createUserResponse struct {
	User domain.User `json:"user"`
	// TempPassword solo viene cuando el server la genero. No se guarda en
	// claro ni se puede volver a consultar.
	TempPassword string `json:"temp_password,omitempty"`
	// EmailStatus: sent | failed | none. Si fallo, la UI todavia tiene la
	// contrasena provisoria para pasarla por WhatsApp.
	EmailStatus string `json:"email_status"`
}

// roleLabel es el nombre del rol en castellano, tal como lo lee el equipo.
func roleLabel(role domain.Role) string {
	switch role {
	case domain.RoleAdmin:
		return "Direccion"
	case domain.RoleDoor:
		return "Puerta"
	default:
		return "Corista"
	}
}

// sendInviteEmail manda el acceso (o la contrasena nueva) y devuelve el estado
// del envio. Nunca devuelve error: un email caido no invalida el alta.
func (s *Server) sendInviteEmail(ctx context.Context, user domain.User, tempPassword string, reset bool) string {
	msg := mail.ComposeInviteEmail(mail.InviteEmailData{
		Name:         user.Name,
		Email:        user.Email,
		RoleLabel:    roleLabel(user.Role),
		TempPassword: tempPassword,
		BaseURL:      s.cfg.BaseURL,
		Reset:        reset,
	})

	if auth.IsDemo(ctx) {
		return emailStatusPreview
	}
	sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := s.mailer.Send(sendCtx, msg); err != nil {
		slog.ErrorContext(ctx, "fallo el envio de la invitacion",
			"user_id", user.ID, "driver", s.mailer.Name(), "error", err)
		return emailStatusFailed
	}
	return emailStatusSent
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	role := domain.Role(strings.TrimSpace(req.Role))

	password := req.Password
	generated := false
	if password == "" {
		var err error
		if password, err = auth.GenerateTempPassword(); err != nil {
			httpx.Internal(w, r, err)
			return
		}
		generated = true
	}

	user, err := s.auth.CreateUser(r.Context(), s.org(r.Context()), req.Name, req.Email, role, password)
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrEmailTaken):
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "Ya hay un usuario con ese email.")
		return
	case errors.Is(err, domain.ErrNameRequired),
		errors.Is(err, domain.ErrEmailRequired),
		errors.Is(err, domain.ErrEmailInvalid),
		errors.Is(err, domain.ErrRoleInvalid),
		errors.Is(err, domain.ErrPasswordShort),
		errors.Is(err, domain.ErrPasswordLong):
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, capitalize(err.Error()))
		return
	default:
		httpx.Internal(w, r, err)
		return
	}

	// El alta dispara la invitacion (C7). Se manda siempre que el server haya
	// generado la clave: si la eligio el admin, no es suya para mandarla.
	resp := createUserResponse{User: *user, EmailStatus: emailStatusNone}
	if generated {
		resp.TempPassword = password
		resp.EmailStatus = s.sendInviteEmail(r.Context(), *user, password, false)
	}
	httpx.JSON(w, http.StatusCreated, resp)
}

// handleResendInvite: POST /api/users/{id}/resend-invite — genera una clave
// provisoria nueva y vuelve a mandar el acceso. Solo para quien nunca entro:
// si ya usa la app, lo que corresponde es resetear la contrasena.
func (s *Server) handleResendInvite(w http.ResponseWriter, r *http.Request) {
	user, password, ok := s.resetUserPassword(w, r)
	if !ok {
		return
	}
	if !user.InvitePending() {
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
			"Esa persona ya entro alguna vez: usa Resetear contrasena.")
		return
	}
	httpx.JSON(w, http.StatusOK, createUserResponse{
		User:         *user,
		TempPassword: password,
		EmailStatus:  s.sendInviteEmail(r.Context(), *user, password, false),
	})
}

// handleResetPassword: POST /api/users/{id}/reset-password — clave provisoria
// nueva para quien se la olvido. La persona elige la suya al entrar.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	user, password, ok := s.resetUserPassword(w, r)
	if !ok {
		return
	}
	httpx.JSON(w, http.StatusOK, createUserResponse{
		User:         *user,
		TempPassword: password,
		EmailStatus:  s.sendInviteEmail(r.Context(), *user, password, true),
	})
}

// resetUserPassword es la parte comun de reenviar invitacion y resetear:
// parsea el id, genera la clave nueva y responde los errores. `ok=false`
// significa que ya se respondio.
func (s *Server) resetUserPassword(w http.ResponseWriter, r *http.Request) (*domain.User, string, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrUserNotFound)
		return nil, "", false
	}

	user, password, err := s.auth.ResetPassword(r.Context(), s.org(r.Context()), id)
	if err != nil {
		if !mapDomainError(w, err) {
			httpx.Internal(w, r, err)
		}
		return nil, "", false
	}
	return user, password, true
}

// --- Equipo por temporada (spec acapelius-equipo) ---------------------------

// teamMember es una fila de Equipo: quien es, que rol tiene ESTA temporada y
// que hizo en ella.
type teamMember struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Email       string     `json:"email"`
	Role        string     `json:"role"`
	JoinedAt    time.Time  `json:"joined_at"`
	LeftAt      *time.Time `json:"left_at"`
	LastLoginAt *time.Time `json:"last_login_at"`

	TicketsSold  int64 `json:"tickets_sold"`
	Assigned     int64 `json:"assigned"`
	BalanceCents int64 `json:"balance_cents"`
	Checkins     int64 `json:"checkins"`
	// Cuantas temporadas lleva, contando esta.
	Seasons int64 `json:"seasons"`
}

// formerMember es alguien que participo antes pero no de esta temporada.
type formerMember struct {
	ID              int64      `json:"id"`
	Name            string     `json:"name"`
	Email           string     `json:"email"`
	LastLoginAt     *time.Time `json:"last_login_at"`
	LastSeasonName  string     `json:"last_season_name"`
	LastRole        string     `json:"last_role"`
	LastTicketsSold int64      `json:"last_tickets_sold"`
}

type teamResponse struct {
	Members []teamMember   `json:"members"`
	Former  []formerMember `json:"former"`
	Summary struct {
		Active    int64 `json:"active"`
		Pending   int64 `json:"pending"`
		LeftChoir int64 `json:"left_choir"`
		Total     int64 `json:"total"`
		// Los agregados que muestra la franja.
		TicketsSold  int64 `json:"tickets_sold"`
		BalanceCents int64 `json:"balance_cents"`
	} `json:"summary"`
}

// handleListUsers: GET /api/users?season_id= — el equipo de una temporada.
// Sin season_id, el de la que esta en curso.
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var seasonID int64
	if raw := r.URL.Query().Get("season_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "season_id tiene que ser un numero.")
			return
		}
		if !s.temporadaExiste(w, r, id) {
			return
		}
		seasonID = id
	} else {
		season, err := s.queries.GetActiveSeason(ctx, s.org(ctx))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.JSON(w, http.StatusOK, teamResponse{Members: []teamMember{}, Former: []formerMember{}})
				return
			}
			httpx.Internal(w, r, err)
			return
		}
		seasonID = season.ID
	}

	rows, err := s.queries.TeamForSeason(ctx, sqlcgen.TeamForSeasonParams{SeasonID: seasonID, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	formerRows, err := s.queries.FormerMembers(ctx, sqlcgen.FormerMembersParams{SeasonID: seasonID, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	summary, err := s.queries.SeasonTeamSummary(ctx, sqlcgen.SeasonTeamSummaryParams{SeasonID: seasonID, OrganizationID: s.org(ctx)})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	resp := teamResponse{Members: make([]teamMember, 0, len(rows)), Former: []formerMember{}}
	for _, row := range rows {
		// Cuantas temporadas lleva: se cuenta aca y no en la query principal
		// para no meter otro subselect por fila en la consulta que ya trae
		// cinco agregados.
		temporadas, err := s.queries.CountMembershipsOfUser(ctx, sqlcgen.CountMembershipsOfUserParams{UserID: row.ID, OrganizationID: s.org(ctx)})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		resp.Members = append(resp.Members, teamMember{
			ID:           row.ID,
			Name:         row.Name,
			Email:        row.Email,
			Role:         row.Role,
			JoinedAt:     row.JoinedAt,
			LeftAt:       row.LeftAt,
			LastLoginAt:  row.LastLoginAt,
			TicketsSold:  row.TicketsSold,
			Assigned:     row.Assigned,
			BalanceCents: row.BalanceCents,
			Checkins:     row.Checkins,
			Seasons:      temporadas,
		})
		resp.Summary.TicketsSold += row.TicketsSold
		if row.BalanceCents > 0 {
			resp.Summary.BalanceCents += row.BalanceCents
		}
	}
	for _, row := range formerRows {
		resp.Former = append(resp.Former, formerMember{
			ID:              row.ID,
			Name:            row.Name,
			Email:           row.Email,
			LastLoginAt:     row.LastLoginAt,
			LastSeasonName:  row.LastSeasonName,
			LastRole:        row.LastRole,
			LastTicketsSold: row.LastTicketsSold,
		})
	}
	resp.Summary.Active = summary.Active
	resp.Summary.Pending = summary.Pending
	resp.Summary.LeftChoir = summary.LeftChoir
	resp.Summary.Total = summary.Total

	httpx.JSON(w, http.StatusOK, resp)
}

// --- Membresias -------------------------------------------------------------

type membershipRequest struct {
	UserID int64  `json:"user_id"`
	Role   string `json:"role"`
}

// handleAddMember: POST /api/seasons/{id}/members — suma (o reincorpora) a una
// persona a una temporada. Es lo que usa "Reincorporar" y el paso de equipo
// del alta de temporada.
func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	seasonID, ok := s.seasonFromPath(w, r)
	if !ok {
		return
	}
	var req membershipRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	role := domain.Role(req.Role)
	if !role.IsValid() {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "El rol no es valido.")
		return
	}

	ctx := r.Context()
	if _, err := s.queries.GetUserByID(ctx, sqlcgen.GetUserByIDParams{ID: req.UserID, OrganizationID: s.org(ctx)}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrUserNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	member, err := s.queries.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
		OrganizationID: s.org(ctx),
		SeasonID:       seasonID, UserID: req.UserID, Role: string(role),
	})
	if err != nil {
		// Sin fila: la temporada no es de esta organizacion (la persona ya
		// se verifico arriba).
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrSeasonNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"member": member})
}

// handleRemoveMember: DELETE /api/seasons/{id}/members/{userId} — la saca de
// la temporada. Si ya vendio algo queda como baja (left_at) y no se borra: sus
// ventas y su deuda siguen contando. Si no hizo nada, se borra la fila.
func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	seasonID, ok := s.seasonFromPath(w, r)
	if !ok {
		return
	}
	userID, err := strconv.ParseInt(chi.URLParam(r, "userId"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrUserNotFound)
		return
	}

	ctx := r.Context()
	actor := auth.MustUserFrom(ctx)
	if actor.ID == userID {
		// ErrSelfLockout no es un error de dominio mapeado: se escribe aca,
		// como en handleUpdateUser.
		httpx.Error(w, http.StatusConflict, httpx.CodeConflict, capitalize(domain.ErrSelfLockout.Error()))
		return
	}

	if _, err := s.queries.GetUserByID(ctx, sqlcgen.GetUserByIDParams{ID: userID, OrganizationID: s.org(ctx)}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrUserNotFound)
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	miembro, err := s.queries.GetMembership(ctx, sqlcgen.GetMembershipParams{
		OrganizationID: s.org(ctx),
		SeasonID:       seasonID, UserID: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		httpx.Internal(w, r, err)
		return
	}

	// Nunca una temporada sin direccion.
	if miembro.Role == string(domain.RoleAdmin) {
		admins, err := s.queries.CountAdminsInSeason(ctx, sqlcgen.CountAdminsInSeasonParams{SeasonID: seasonID, OrganizationID: s.org(ctx)})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if admins <= 1 {
			httpx.Error(w, http.StatusConflict, httpx.CodeConflict,
				"Es la unica persona de direccion de la temporada: sumá otra antes de sacarla.")
			return
		}
	}

	ventas, err := s.queries.CountSalesBySellerInSeason(ctx, sqlcgen.CountSalesBySellerInSeasonParams{
		OrganizationID: s.org(ctx),
		SellerID:       userID, SeasonID: seasonID,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	if ventas > 0 {
		if err := s.queries.LeaveMembership(ctx, sqlcgen.LeaveMembershipParams{
			OrganizationID: s.org(ctx),
			SeasonID:       seasonID, UserID: userID,
		}); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	} else if err := s.queries.DeleteMembership(ctx, sqlcgen.DeleteMembershipParams{
		OrganizationID: s.org(ctx),
		SeasonID:       seasonID, UserID: userID,
	}); err != nil {
		httpx.Internal(w, r, err)
		return
	}

	// Sin cupo que reservar: se sueltan las asignaciones que tuviera.
	if err := s.queries.DeleteAllocationsForUser(ctx, sqlcgen.DeleteAllocationsForUserParams{UserID: userID, OrganizationID: s.org(ctx)}); err != nil {
		slog.ErrorContext(ctx, "no se pudieron soltar los cupos", "user_id", userID, "error", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) seasonFromPath(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		mapDomainError(w, domain.ErrSeasonNotFound)
		return 0, false
	}
	return id, s.temporadaExiste(w, r, id)
}

// temporadaExiste: la temporada es de esta organizacion (C17 §A.2). Una
// ajena no existe: 404. Escribe el error y devuelve false si no.
func (s *Server) temporadaExiste(w http.ResponseWriter, r *http.Request, id int64) bool {
	ctx := r.Context()
	if _, err := s.queries.GetSeason(ctx, sqlcgen.GetSeasonParams{ID: id, OrganizationID: s.org(ctx)}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			mapDomainError(w, domain.ErrSeasonNotFound)
			return false
		}
		httpx.Internal(w, r, err)
		return false
	}
	return true
}
