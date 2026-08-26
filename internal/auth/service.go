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

	// Una cuenta desactivada responde igual que una credencial mala: no hay
	// que revelar que la cuenta existe pero fue dada de baja.
	if !row.IsActive {
		return nil, ErrInvalidCredentials
	}

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
	// Desactivada despues de abrir sesion: la sesion muere aca.
	if !row.IsActive {
		_ = s.sessions.Destroy(ctx)
		return nil, nil
	}
	user := toDomainUser(row)
	return &user, nil
}

// UpdateUser modifica nombre, email, rol y estado de un usuario (CRUD del
// admin). `actorID` es quien edita: no puede desactivarse ni degradarse a si
// mismo, para no quedarse afuera de la administracion.
func (s *Service) UpdateUser(ctx context.Context, actorID, userID int64, name, email string, role domain.Role, isActive bool) (*domain.User, error) {
	if err := domain.ValidateNewUser(name, email, role); err != nil {
		return nil, err
	}
	if actorID == userID && (!isActive || role != domain.RoleAdmin) {
		return nil, domain.ErrSelfLockout
	}

	row, err := s.queries.UpdateUser(ctx, sqlcgen.UpdateUserParams{
		Name:     name,
		Email:    domain.NormalizeEmail(email),
		Role:     string(role),
		IsActive: isActive,
		ID:       userID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("actualizar usuario: %w", err)
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

// ResetPassword genera una password provisoria nueva para un usuario y la
// devuelve una sola vez (C7). Deja `must_change_password` en true: la persona
// elige la suya al entrar. Sirve tanto para reenviar la invitacion de quien
// nunca entro como para el "me olvide la contrasena" de quien ya usaba la app.
func (s *Service) ResetPassword(ctx context.Context, userID int64) (*domain.User, string, error) {
	row, err := s.queries.GetUserByID(ctx, userID)
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

	user := toDomainUser(row)
	return &user, password, nil
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
		IsActive:           row.IsActive,
		CreatedAt:          row.CreatedAt,
		LastLoginAt:        row.LastLoginAt,
	}
}
