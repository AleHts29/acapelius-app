package auth_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/domain"
)

func TestHashAndCheckPassword(t *testing.T) {
	t.Parallel()

	const password = "coro-2026"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == password || !strings.HasPrefix(hash, "$2") {
		t.Fatalf("el hash no parece bcrypt: %q", hash)
	}
	if err := auth.CheckPassword(hash, password); err != nil {
		t.Fatalf("la password correcta tendria que validar: %v", err)
	}
	if err := auth.CheckPassword(hash, "otra-cosa"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("password incorrecta: %v, se esperaba ErrInvalidCredentials", err)
	}
}

func TestHashPasswordUsesSalt(t *testing.T) {
	t.Parallel()

	first, err := auth.HashPassword("coro-2026")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	second, err := auth.HashPassword("coro-2026")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if first == second {
		t.Fatal("dos hashes de la misma password no pueden ser iguales (falta salt)")
	}
}

func TestCheckPasswordRejectsGarbageHash(t *testing.T) {
	t.Parallel()

	if err := auth.CheckPassword("no-es-un-hash", "cualquiera"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("hash invalido: %v, se esperaba ErrInvalidCredentials", err)
	}
}

func TestGenerateTempPassword(t *testing.T) {
	t.Parallel()

	const iterations = 50
	seen := make(map[string]struct{}, iterations)
	const ambiguous = "0O1lI"

	for range iterations {
		password, err := auth.GenerateTempPassword()
		if err != nil {
			t.Fatalf("GenerateTempPassword: %v", err)
		}
		if err := domain.ValidatePassword(password); err != nil {
			t.Fatalf("la password temporal %q no pasa la validacion: %v", password, err)
		}
		if strings.ContainsAny(password, ambiguous) {
			t.Fatalf("la password temporal %q trae caracteres ambiguos (%s)", password, ambiguous)
		}
		if _, dup := seen[password]; dup {
			t.Fatalf("password temporal repetida en %d intentos: %q", iterations, password)
		}
		seen[password] = struct{}{}
	}
}
