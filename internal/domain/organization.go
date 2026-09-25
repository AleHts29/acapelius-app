package domain

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// OrganizationKind decide como la app nombra las cosas (C17 §A.3). Los roles
// no cambian; cambian las etiquetas.
type OrganizationKind string

const (
	KindChoir   OrganizationKind = "choir"
	KindTheatre OrganizationKind = "theatre"
	KindOther   OrganizationKind = "other"
)

// IsValid indica si es uno de los tipos conocidos.
func (k OrganizationKind) IsValid() bool {
	return k == KindChoir || k == KindTheatre || k == KindOther
}

// MinSignupPasswordLength es el minimo para la contraseña que elige quien crea
// la cuenta (C17 §B.3). Mas alto que el de las coristas: es la cuenta que
// administra todo el grupo.
const MinSignupPasswordLength = 10

// maxOrgNameLength acota el nombre del grupo: entra en un titulo.
const maxOrgNameLength = 80

// Errores del alta de cuenta.
var (
	ErrOrgNameRequired     = errors.New("el nombre del grupo es obligatorio")
	ErrOrgNameLong         = errors.New("el nombre del grupo es demasiado largo")
	ErrOrgKindInvalid      = errors.New("el tipo de grupo no es valido")
	ErrSignupPasswordShort = errors.New("la contrasena debe tener al menos 10 caracteres")
)

// ValidateSignup valida los datos del alta de una organizacion (C17 §B.3).
func ValidateSignup(orgName string, kind OrganizationKind, name, email, password string) error {
	orgName = strings.TrimSpace(orgName)
	if orgName == "" {
		return ErrOrgNameRequired
	}
	if utf8.RuneCountInString(orgName) > maxOrgNameLength {
		return ErrOrgNameLong
	}
	if !kind.IsValid() {
		return ErrOrgKindInvalid
	}
	if strings.TrimSpace(name) == "" {
		return ErrNameRequired
	}
	if err := ValidateEmail(email); err != nil {
		return err
	}
	if utf8.RuneCountInString(password) < MinSignupPasswordLength {
		return ErrSignupPasswordShort
	}
	if len(password) > maxPasswordLength {
		return ErrPasswordLong
	}
	return nil
}

// Slugify deriva el slug de una organizacion de su nombre: minusculas ASCII,
// sin tildes, guiones entre palabras. "Coro Acapelius" → "coro-acapelius".
// Un nombre sin nada aprovechable da "grupo"; el sufijo numerico si choca lo
// pone quien inserta.
func Slugify(name string) string {
	sinTildes, _, err := transform.String(transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC), name)
	if err != nil {
		sinTildes = name
	}
	var b strings.Builder
	guion := false
	for _, r := range strings.ToLower(sinTildes) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			guion = false
		case !guion && b.Len() > 0:
			b.WriteByte('-')
			guion = true
		}
	}
	slug := strings.Trim(b.String(), "-")
	if len(slug) > 40 {
		slug = strings.Trim(slug[:40], "-")
	}
	if slug == "" {
		return "grupo"
	}
	return slug
}
