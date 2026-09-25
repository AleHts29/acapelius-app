package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// signupRequest es el formulario de /crear-cuenta (C17 §B.3).
type signupRequest struct {
	OrgName  string `json:"org_name"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	// Website es el honeypot: un campo que la persona no ve y un bot llena.
	Website string `json:"website"`
}

// handleSignup: POST /api/signup — crea la organizacion, su direccion y la
// primera temporada en una transaccion, y deja la sesion abierta. Devuelve a
// la persona a /app, no a una pantalla de bienvenida.
func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	// Un bot que llena el campo invisible recibe un "listo" vacio y ninguna
	// cuenta: no hay nada que aprender de la respuesta.
	if strings.TrimSpace(req.Website) != "" {
		httpx.JSON(w, http.StatusCreated, map[string]any{})
		return
	}

	orgName := strings.TrimSpace(req.OrgName)
	kind := domain.OrganizationKind(strings.TrimSpace(req.Kind))
	name := strings.TrimSpace(req.Name)
	email := domain.NormalizeEmail(req.Email)
	if err := domain.ValidateSignup(orgName, kind, name, email, req.Password); err != nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, capitalize(err.Error())+".")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Internal(w, r, err)
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

	// El slug sale del nombre; si ya existe, sufijo numerico (-2, -3, …).
	base := domain.Slugify(orgName)
	slug := base
	for i := 2; ; i++ {
		existe, err := q.SlugExists(ctx, slug)
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if !existe {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}

	org, err := q.CreateOrganization(ctx, sqlcgen.CreateOrganizationParams{
		Name: orgName, Kind: string(kind), Slug: slug,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	// La contraseña la eligio recien: no es provisoria.
	user, err := q.CreateUser(ctx, sqlcgen.CreateUserParams{
		Name: name, Email: email, PasswordHash: hash,
		MustChangePassword: false, OrganizationID: org.ID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			httpx.Error(w, http.StatusConflict, httpx.CodeConflict, "Ya hay una cuenta con ese email en este grupo.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	season, err := q.CreateSeason(ctx, sqlcgen.CreateSeasonParams{
		Name:           fmt.Sprintf("Temporada %d", time.Now().Year()),
		OrganizationID: org.ID,
		IsActive:       true,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if _, err := q.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
		SeasonID: season.ID, UserID: user.ID, Role: string(domain.RoleAdmin), OrganizationID: org.ID,
	}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(w, r, err)
		return
	}

	sesion, err := s.auth.OpenSession(ctx, user.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, userResponse{User: *sesion})
}

// isUniqueViolation: la organizacion recien creada no puede tener el email
// repetido, pero el chequeo queda por si el indice cambia.
func isUniqueViolation(err error) bool {
	var pg interface{ SQLState() string }
	return errors.As(err, &pg) && pg.SQLState() == "23505"
}
