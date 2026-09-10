// Package auth resuelve login, sesiones y autorizacion por rol.
package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/alexedwards/scs/pgxstore"
	"github.com/alexedwards/scs/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ale-hts/acapelius/internal/config"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/domain"
)

// sessionUserKey es la clave bajo la que se guarda el id de usuario en la sesion.
const sessionUserKey = "user_id"

// sessionLifetime cubre holgadamente una noche de funcion: nadie deberia tener
// que volver a loguearse en la puerta a mitad del ingreso.
const sessionLifetime = 30 * 24 * time.Hour

// ErrEmailTaken se devuelve al dar de alta un usuario con un email ya usado.
var ErrEmailTaken = errors.New("ya existe un usuario con ese email")

// Service concentra las operaciones de autenticacion contra la base.
type Service struct {
	queries  *sqlcgen.Queries
	sessions *scs.SessionManager
}

// NewSessionManager arma el manejador de sesiones respaldado en Postgres.
// La cookie es HttpOnly + SameSite=Lax, y Secure solo cuando BASE_URL es https
// (en desarrollo se sirve por http y una cookie Secure no viajaria).
func NewSessionManager(pool *pgxpool.Pool, cfg *config.Config) *scs.SessionManager {
	sessions := scs.New()
	sessions.Store = pgxstore.New(pool)
	sessions.Lifetime = sessionLifetime
	sessions.Cookie.Name = "acapelius_session"
	sessions.Cookie.HttpOnly = true
	sessions.Cookie.SameSite = http.SameSiteLaxMode
	sessions.Cookie.Path = "/"
	sessions.Cookie.Secure = cfg.UsesTLS()
	return sessions
}

// NewService construye el servicio de autenticacion.
func NewService(pool *pgxpool.Pool, sessions *scs.SessionManager) *Service {
	return &Service{queries: sqlcgen.New(pool), sessions: sessions}
}

// Sessions expone el manejador de sesiones para montar su middleware.
func (s *Service) Sessions() *scs.SessionManager { return s.sessions }

// Login valida las credenciales y, si son correctas, abre sesion. Renueva el
// token para no arrastrar el de la sesion anonima (fijacion de sesion).
func (s *Service) Login(ctx context.Context, email, password string) (*domain.User, error) {
	row, err := s.queries.GetUserWithMembershipByEmail(ctx, domain.NormalizeEmail(email))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Se gasta el tiempo de un bcrypt igual para que un email
			// inexistente no se distinga por lo rapido que responde.
			_ = CheckPassword("$2a$11$s3zbTUiuZ2kdSNRSC7WjOOdC0LqCLcJ7ZK0KLGKm3wVYPjLUsYQKa", password)
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("buscar usuario: %w", err)
	}

	if err := CheckPassword(row.PasswordHash, password); err != nil {
		return nil, ErrInvalidCredentials
	}

	// Una cuenta desactivada responde igual que una credencial mala: no hay
	// que revelar que la cuenta existe pero fue dada de baja.
	// Participar o no de esta temporada ya no corta el login: quien no esta
	// en el coro este año igual puede entrar a mirar su historial. Lo que no
	// tiene es rol, y sin rol no puede hacer nada (ver RequireRole).

	if err := s.sessions.RenewToken(ctx); err != nil {
		return nil, fmt.Errorf("renovar sesion: %w", err)
	}
	s.sessions.Put(ctx, sessionUserKey, row.ID)

	// Sella el ingreso (C7): con esto la invitacion deja de estar pendiente.
	// Un fallo aca no puede tumbar un login valido; se registra y sigue.
	if err := s.queries.TouchUserLogin(ctx, row.ID); err != nil {
		slog.ErrorContext(ctx, "no se pudo registrar el ultimo ingreso", "user_id", row.ID, "error", err)
	} else {
		now := time.Now()
		row.LastLoginAt = &now
	}

	user := fromMembershipByEmail(row)
	return &user, nil
}

// Logout cierra la sesion actual.
func (s *Service) Logout(ctx context.Context) error {
	if err := s.sessions.Destroy(ctx); err != nil {
		return fmt.Errorf("cerrar sesion: %w", err)
	}
	return nil
}

// CurrentUser devuelve el usuario de la sesion. Devuelve (nil, nil) si no hay
// sesion o si el usuario fue borrado desde que se abrio.
func (s *Service) CurrentUser(ctx context.Context) (*domain.User, error) {
	userID, ok := s.sessions.Get(ctx, sessionUserKey).(int64)
	if !ok || userID == 0 {
		return nil, nil
	}
	row, err := s.queries.GetUserWithMembership(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_ = s.sessions.Destroy(ctx)
			return nil, nil
		}
		return nil, fmt.Errorf("cargar usuario de la sesion: %w", err)
	}
	// La sesion sobrevive aunque la persona ya no participe: sin rol no puede
	// hacer nada, pero puede mirar su historial.
	user := fromMembership(row)
	return &user, nil
}

// UpdateUser modifica la identidad de una persona y su participacion en la
// temporada en curso. `actorID` es quien edita: no puede sacarse a si misma ni
// degradarse, para no dejar la temporada sin direccion.
//
// El rol y la participacion viven en season_members: cambiarlos toca este año
// y no reescribe la historia. Norma sigue siendo corista en 2025 aunque este
// año no este.
func (s *Service) UpdateUser(ctx context.Context, actorID, userID int64, name, email string, role domain.Role, participa bool) (*domain.User, error) {
	if err := domain.ValidateNewUser(name, email, role); err != nil {
		return nil, err
	}
	if actorID == userID && (!participa || role != domain.RoleAdmin) {
		return nil, domain.ErrSelfLockout
	}

	season, err := s.queries.GetActiveSeason(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrSeasonNotFound
		}
		return nil, fmt.Errorf("temporada en curso: %w", err)
	}

	if _, err := s.queries.UpdateUser(ctx, sqlcgen.UpdateUserParams{
		Name:  name,
		Email: domain.NormalizeEmail(email),
		ID:    userID,
	}); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("actualizar usuario: %w", err)
	}

	if participa {
		if _, err := s.queries.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
			SeasonID: season.ID, UserID: userID, Role: string(role),
		}); err != nil {
			return nil, fmt.Errorf("actualizar participacion: %w", err)
		}
	} else {
		// Sacarla de la temporada es una baja, no un borrado: sus ventas y su
		// deuda de rendicion siguen contando.
		if err := s.queries.LeaveMembership(ctx, sqlcgen.LeaveMembershipParams{
			SeasonID: season.ID, UserID: userID,
		}); err != nil {
			return nil, fmt.Errorf("dar de baja de la temporada: %w", err)
		}
	}

	// Si deja de ser corista de esta temporada se le sueltan los cupos: si no,
	// quedan reservando lugares que ya no aparecen en el tablero y que nadie
	// puede vender. Un fallo aca no invalida el cambio, pero queda registrado.
	if role != domain.RoleSeller || !participa {
		if err := s.queries.DeleteAllocationsForUser(ctx, userID); err != nil {
			slog.Error("no se pudieron soltar los cupos del usuario", "user_id", userID, "error", err)
		}
	}

	fresh, err := s.queries.GetUserWithMembership(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("releer usuario: %w", err)
	}
	user := fromMembership(fresh)
	return &user, nil
}

// ChangePassword cambia la password del usuario validando la actual, y baja el
// flag must_change_password.
func (s *Service) ChangePassword(ctx context.Context, userID int64, currentPassword, newPassword string) error {
	row, err := s.queries.GetUserByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("cargar usuario: %w", err)
	}
	if err := CheckPassword(row.PasswordHash, currentPassword); err != nil {
		return ErrInvalidCredentials
	}
	if err := domain.ValidatePassword(newPassword); err != nil {
		return err
	}
	if currentPassword == newPassword {
		return domain.ErrPasswordSame
	}

	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.queries.SetUserPassword(ctx, sqlcgen.SetUserPasswordParams{
		PasswordHash:       hash,
		MustChangePassword: false,
		ID:                 userID,
	}); err != nil {
		return fmt.Errorf("guardar password: %w", err)
	}
	return nil
}

// CreateUser da de alta un usuario con una password provisoria que tendra que
// cambiar en su primer ingreso.
func (s *Service) CreateUser(ctx context.Context, name, email string, role domain.Role, password string) (*domain.User, error) {
	if err := domain.ValidateNewUser(name, email, role); err != nil {
		return nil, err
	}
	if err := domain.ValidatePassword(password); err != nil {
		return nil, err
	}

	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}

	season, err := s.queries.GetActiveSeason(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrSeasonNotFound
		}
		return nil, fmt.Errorf("temporada en curso: %w", err)
	}

	row, err := s.queries.CreateUser(ctx, sqlcgen.CreateUserParams{
		Name:               name,
		Email:              domain.NormalizeEmail(email),
		PasswordHash:       hash,
		MustChangePassword: true,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("crear usuario: %w", err)
	}

	// Se la suma a la temporada en curso: dar de alta a alguien es sumarlo al
	// equipo de ahora, no a la historia entera.
	if _, err := s.queries.UpsertMembership(ctx, sqlcgen.UpsertMembershipParams{
		SeasonID: season.ID, UserID: row.ID, Role: string(role),
	}); err != nil {
		return nil, fmt.Errorf("sumar a la temporada: %w", err)
	}

	user := domain.User{
		ID:                 row.ID,
		Name:               row.Name,
		Email:              row.Email,
		Role:               role,
		MustChangePassword: row.MustChangePassword,
		IsActive:           true,
		CreatedAt:          row.CreatedAt,
		LastLoginAt:        row.LastLoginAt,
	}
	return &user, nil
}

// ResetPassword genera una password provisoria nueva para un usuario y la
// devuelve una sola vez (C7). Deja `must_change_password` en true: la persona
// elige la suya al entrar. Sirve tanto para reenviar la invitacion de quien
// nunca entro como para el "me olvide la contrasena" de quien ya usaba la app.
func (s *Service) ResetPassword(ctx context.Context, userID int64) (*domain.User, string, error) {
	row, err := s.queries.GetUserWithMembership(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", domain.ErrUserNotFound
		}
		return nil, "", fmt.Errorf("cargar usuario: %w", err)
	}

	password, err := GenerateTempPassword()
	if err != nil {
		return nil, "", err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, "", err
	}
	if err := s.queries.SetUserPassword(ctx, sqlcgen.SetUserPasswordParams{
		PasswordHash:       hash,
		MustChangePassword: true,
		ID:                 userID,
	}); err != nil {
		return nil, "", fmt.Errorf("guardar password provisoria: %w", err)
	}

	user := fromMembership(row)
	return &user, password, nil
}

// fromMembership arma el usuario de dominio a partir del usuario mas su
// membresia en la temporada en curso. Sin membresia el rol queda vacio: no
// puede hacer nada mas que mirar su historial.
func fromMembership(row sqlcgen.GetUserWithMembershipRow) domain.User {
	return domain.User{
		ID:                 row.ID,
		Name:               row.Name,
		Email:              row.Email,
		Role:               domain.Role(row.SeasonRole),
		MustChangePassword: row.MustChangePassword,
		IsActive:           row.Participates.Bool,
		CreatedAt:          row.CreatedAt,
		LastLoginAt:        row.LastLoginAt,
		LeftAt:             row.LeftAt,
	}
}

// fromMembershipByEmail: el mismo armado, para la fila del login.
func fromMembershipByEmail(row sqlcgen.GetUserWithMembershipByEmailRow) domain.User {
	return fromMembership(sqlcgen.GetUserWithMembershipRow(row))
}

// HasHistory indica si la persona vendio alguna vez, en cualquier temporada.
// Es lo que habilita a mirar su historial cuando este año no esta en el coro.
// Quien solo estuvo en la puerta no tiene ventas propias que mirar.
func (s *Service) HasHistory(ctx context.Context, userID int64) (bool, error) {
	n, err := s.queries.CountSellerMembershipsOfUser(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("contar membresias: %w", err)
	}
	return n > 0, nil
}
