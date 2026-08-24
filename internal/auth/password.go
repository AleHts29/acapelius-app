package auth

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"

	"golang.org/x/crypto/bcrypt"
)

// ErrInvalidCredentials se devuelve cuando el email no existe o la password no
// coincide. Es un unico error a proposito: distinguirlos filtra que emails
// estan dados de alta.
var ErrInvalidCredentials = errors.New("credenciales invalidas")

// bcryptCost sube un escalon sobre el default: el login es poco frecuente y
// nadie nota 100ms extra, pero encarece un ataque offline.
const bcryptCost = bcrypt.DefaultCost + 1

// HashPassword devuelve el hash bcrypt de una password en claro.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hashear password: %w", err)
	}
	return string(hash), nil
}

// CheckPassword compara una password en claro contra su hash.
func CheckPassword(hash, password string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return ErrInvalidCredentials
	}
	return nil
}

// tempPasswordAlphabet omite caracteres que se confunden al dictarlos por
// telefono o leerlos de un papel: 0/O, 1/l/I.
const tempPasswordAlphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// tempPasswordLength deja margen sobre domain.MinPasswordLength.
const tempPasswordLength = 10

// GenerateTempPassword arma la password provisoria que el admin le pasa a una
// vendedora y que ella tiene que cambiar en el primer ingreso.
func GenerateTempPassword() (string, error) {
	out := make([]byte, tempPasswordLength)
	max := big.NewInt(int64(len(tempPasswordAlphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("generar password temporal: %w", err)
		}
		out[i] = tempPasswordAlphabet[n.Int64()]
	}
	return string(out), nil
}
