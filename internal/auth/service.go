// Package auth resuelve login, sesiones y autorizacion por rol.
package auth

import (
	"context"
	"errors"
	"fmt"
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
	row, err := s.queries.GetUserByEmail(ctx, domain.NormalizeEmail(email))
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

	if err := s.sessions.RenewToken(ctx); err != nil {
		return nil, fmt.Errorf("renovar sesion: %w", err)
	}
	s.sessions.Put(ctx, sessionUserKey, row.ID)

	user := toDomainUser(row)
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
	row, err := s.queries.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_ = s.sessions.Destroy(ctx)
			return nil, nil
		}
		return nil, fmt.Errorf("cargar usuario de la sesion: %w", err)
	}
	user := toDomainUser(row)
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

	row, err := s.queries.CreateUser(ctx, sqlcgen.CreateUserParams{
		Name:               name,
		Email:              domain.NormalizeEmail(email),
		PasswordHash:       hash,
		Role:               string(role),
		MustChangePassword: true,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("crear usuario: %w", err)
	}
	user := toDomainUser(row)
	return &user, nil
}

// ListUsers devuelve todos los usuarios ordenados por rol y nombre.
func (s *Service) ListUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := s.queries.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("listar usuarios: %w", err)
	}
	users := make([]domain.User, 0, len(rows))
	for _, row := range rows {
		users = append(users, toDomainUser(row))
	}
	return users, nil
}

func toDomainUser(row sqlcgen.User) domain.User {
	return domain.User{
		ID:                 row.ID,
		Name:               row.Name,
		Email:              row.Email,
		Role:               domain.Role(row.Role),
		MustChangePassword: row.MustChangePassword,
		CreatedAt:          row.CreatedAt,
	}
}
