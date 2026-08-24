package domain_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/ale-hts/acapelius/internal/domain"
)

func TestRoleCan(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		actual   domain.Role
		required domain.Role
		want     bool
	}{
		{"admin hace de admin", domain.RoleAdmin, domain.RoleAdmin, true},
		{"admin hace de vendedora", domain.RoleAdmin, domain.RoleSeller, true},
		{"admin hace de puerta", domain.RoleAdmin, domain.RoleDoor, true},
		{"vendedora hace de vendedora", domain.RoleSeller, domain.RoleSeller, true},
		{"vendedora no hace de admin", domain.RoleSeller, domain.RoleAdmin, false},
		{"vendedora no hace de puerta", domain.RoleSeller, domain.RoleDoor, false},
		{"puerta no hace de vendedora", domain.RoleDoor, domain.RoleSeller, false},
		{"puerta no hace de admin", domain.RoleDoor, domain.RoleAdmin, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := tc.actual.Can(tc.required); got != tc.want {
				t.Fatalf("Role(%q).Can(%q) = %v, se esperaba %v", tc.actual, tc.required, got, tc.want)
			}
		})
	}
}

func TestRoleCanAny(t *testing.T) {
	t.Parallel()

	if !domain.RoleDoor.CanAny() {
		t.Fatal("sin roles requeridos alcanza con estar autenticado")
	}
	if !domain.RoleSeller.CanAny(domain.RoleDoor, domain.RoleSeller) {
		t.Fatal("la vendedora tendria que pasar si uno de los roles requeridos es seller")
	}
	if domain.RoleDoor.CanAny(domain.RoleSeller, domain.RoleAdmin) {
		t.Fatal("puerta no tendria que pasar un requisito de seller/admin")
	}
	if !domain.RoleAdmin.CanAny(domain.RoleSeller, domain.RoleDoor) {
		t.Fatal("el admin pasa cualquier requisito")
	}
}

func TestRoleIsValid(t *testing.T) {
	t.Parallel()

	for _, role := range domain.ValidRoles {
		if !role.IsValid() {
			t.Fatalf("%q tendria que ser valido", role)
		}
	}
	for _, role := range []domain.Role{"", "ADMIN", "vendedora", "root"} {
		if role.IsValid() {
			t.Fatalf("%q no tendria que ser valido", role)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"  Eli@Acapelius.LOCAL ": "eli@acapelius.local",
		"eli@acapelius.local":    "eli@acapelius.local",
		"\tCARO@X.COM\n":         "caro@x.com",
	}
	for in, want := range cases {
		if got := domain.NormalizeEmail(in); got != want {
			t.Fatalf("NormalizeEmail(%q) = %q, se esperaba %q", in, got, want)
		}
	}
}

func TestValidateEmail(t *testing.T) {
	t.Parallel()

	valid := []string{"eli@acapelius.local", " Caro@Coro.Com ", "a.b+tag@sub.dominio.ar"}
	for _, email := range valid {
		if err := domain.ValidateEmail(email); err != nil {
			t.Fatalf("ValidateEmail(%q) devolvio %v, se esperaba nil", email, err)
		}
	}

	if err := domain.ValidateEmail("  "); !errors.Is(err, domain.ErrEmailRequired) {
		t.Fatalf("email vacio: %v, se esperaba ErrEmailRequired", err)
	}

	// "Eli <eli@x.com>" parsea como direccion de mail pero no es lo que se
	// guarda en la columna; tiene que rechazarse.
	invalid := []string{"eli", "eli@", "@x.com", "Eli <eli@x.com>", "eli@x.com, caro@x.com"}
	for _, email := range invalid {
		if err := domain.ValidateEmail(email); !errors.Is(err, domain.ErrEmailInvalid) {
			t.Fatalf("ValidateEmail(%q) = %v, se esperaba ErrEmailInvalid", email, err)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	t.Parallel()

	if err := domain.ValidatePassword("coro2026"); err != nil {
		t.Fatalf("password de 8 caracteres: %v", err)
	}
	if err := domain.ValidatePassword("corto"); !errors.Is(err, domain.ErrPasswordShort) {
		t.Fatalf("password corta: %v, se esperaba ErrPasswordShort", err)
	}
	// Las tildes cuentan como un caracter, no como sus bytes UTF-8.
	if err := domain.ValidatePassword("cancion"); !errors.Is(err, domain.ErrPasswordShort) {
		t.Fatalf("7 caracteres: %v, se esperaba ErrPasswordShort", err)
	}
	if err := domain.ValidatePassword(strings.Repeat("a", 73)); !errors.Is(err, domain.ErrPasswordLong) {
		t.Fatalf("password de 73 bytes: %v, se esperaba ErrPasswordLong", err)
	}
}

func TestValidateNewUser(t *testing.T) {
	t.Parallel()

	if err := domain.ValidateNewUser("Carolina", "caro@coro.com", domain.RoleSeller); err != nil {
		t.Fatalf("usuario valido: %v", err)
	}
	if err := domain.ValidateNewUser("   ", "caro@coro.com", domain.RoleSeller); !errors.Is(err, domain.ErrNameRequired) {
		t.Fatalf("nombre vacio: %v, se esperaba ErrNameRequired", err)
	}
	if err := domain.ValidateNewUser("Carolina", "caro", domain.RoleSeller); !errors.Is(err, domain.ErrEmailInvalid) {
		t.Fatalf("email invalido: %v, se esperaba ErrEmailInvalid", err)
	}
	if err := domain.ValidateNewUser("Carolina", "caro@coro.com", "cantante"); !errors.Is(err, domain.ErrRoleInvalid) {
		t.Fatalf("rol invalido: %v, se esperaba ErrRoleInvalid", err)
	}
}
