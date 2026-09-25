// Package domain contiene los tipos y las reglas de negocio de Acapelius,
// independientes del transporte HTTP y del almacenamiento.
package domain

import (
	"errors"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

// Role es el rol de un usuario. Un usuario tiene exactamente un rol; `admin`
// puede hacer todo lo que pueden `seller` y `door`.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleSeller Role = "seller"
	RoleDoor   Role = "door"
)

// ValidRoles enumera los roles asignables.
var ValidRoles = []Role{RoleAdmin, RoleSeller, RoleDoor}

// IsValid indica si el rol es uno de los conocidos.
func (r Role) IsValid() bool {
	for _, valid := range ValidRoles {
		if r == valid {
			return true
		}
	}
	return false
}

// Can indica si el rol alcanza para actuar como `required`. El admin cumple
// cualquier requisito; el resto solo el propio.
func (r Role) Can(required Role) bool {
	return r == RoleAdmin || r == required
}

// CanAny indica si el rol satisface al menos uno de los requeridos. Sin roles
// requeridos, alcanza con estar autenticado.
func (r Role) CanAny(required ...Role) bool {
	if len(required) == 0 {
		return true
	}
	for _, req := range required {
		if r.Can(req) {
			return true
		}
	}
	return false
}

// User es un usuario de la aplicacion tal como lo ve el dominio.
type User struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	// OrganizationID es el grupo al que pertenece (C17 §A). Sale de la fila
	// del usuario, no de la cookie: es lo que acota cada consulta.
	OrganizationID int64 `json:"organization_id"`
	// OrganizationKind decide como la app nombra las cosas: 'choir',
	// 'theatre' u 'other' (C17 §A.3).
	OrganizationKind string `json:"organization_kind"`
	OrganizationName string `json:"organization_name"`
	// OrganizationIsDemo marca la organizacion de prueba (C17 §C).
	OrganizationIsDemo bool      `json:"organization_is_demo"`
	Email              string    `json:"email"`
	Role               Role      `json:"role"`
	MustChangePassword bool      `json:"must_change_password"`
	IsActive           bool      `json:"is_active"`
	CreatedAt          time.Time `json:"created_at"`
	// LastLoginAt en nil = nunca entro: la invitacion sigue pendiente (C7).
	LastLoginAt *time.Time `json:"last_login_at"`
	// LeftAt con fecha = dejo el coro a mitad de temporada. Sus ventas y su
	// deuda siguen contando; lo que no puede es vender.
	LeftAt *time.Time `json:"left_at"`
}

// Participa indica si esta en la temporada en curso. Sin participar no tiene
// rol, y sin rol solo puede mirar su historial.
func (u User) Participa() bool { return u.IsActive }

// InvitePending indica que la persona todavia no uso su acceso.
func (u User) InvitePending() bool { return u.LastLoginAt == nil }

// MinPasswordLength es el minimo para cualquier password elegida por una
// persona. Corto a proposito: las vendedoras entran de noche desde el celular.
const MinPasswordLength = 8

// maxPasswordLength existe porque bcrypt trunca en 72 bytes; rechazar es mas
// honesto que ignorar silenciosamente el resto.
const maxPasswordLength = 72

// Errores de validacion de usuarios.
var (
	ErrNameRequired  = errors.New("el nombre es obligatorio")
	ErrEmailRequired = errors.New("el email es obligatorio")
	ErrEmailInvalid  = errors.New("el email no es valido")
	ErrRoleInvalid   = errors.New("el rol no es valido")
	ErrPasswordShort = errors.New("la contrasena debe tener al menos 8 caracteres")
	ErrPasswordLong  = errors.New("la contrasena no puede superar los 72 bytes")
	ErrPasswordSame  = errors.New("la contrasena nueva tiene que ser distinta de la actual")
	// ErrSelfLockout evita que el admin se saque a si mismo el acceso.
	ErrSelfLockout = errors.New("no podes desactivarte ni cambiarte el rol a vos misma")
)

// NormalizeEmail deja el email en la forma canonica que se guarda y compara.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// ValidateEmail acepta solo direcciones parseables como `usuario@dominio`.
func ValidateEmail(email string) error {
	email = NormalizeEmail(email)
	if email == "" {
		return ErrEmailRequired
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || !strings.Contains(email, "@") {
		return ErrEmailInvalid
	}
	return nil
}

// ValidatePassword aplica las reglas de longitud a una password en claro.
func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return ErrPasswordShort
	}
	if len(password) > maxPasswordLength {
		return ErrPasswordLong
	}
	return nil
}

// ValidateNewUser valida los datos de alta de un usuario. La password puede
// venir vacia cuando el admin deja que el sistema genere una temporal.
func ValidateNewUser(name, email string, role Role) error {
	if strings.TrimSpace(name) == "" {
		return ErrNameRequired
	}
	if err := ValidateEmail(email); err != nil {
		return err
	}
	if !role.IsValid() {
		return ErrRoleInvalid
	}
	return nil
}
