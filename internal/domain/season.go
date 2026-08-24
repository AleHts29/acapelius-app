package domain

import (
	"errors"
	"strings"
	"time"
)

// Errores de validacion de temporadas y funciones.
var (
	ErrSeasonNameRequired = errors.New("el nombre de la temporada es obligatorio")
	ErrSeasonNotFound     = errors.New("la temporada no existe")
	ErrVenueRequired      = errors.New("el lugar es obligatorio")
	ErrStartsAtRequired   = errors.New("la fecha y hora son obligatorias")
	ErrCapacityInvalid    = errors.New("el cupo tiene que ser mayor a cero")
	ErrPriceInvalid       = errors.New("el precio no puede ser negativo")
	ErrFunctionNotFound   = errors.New("la funcion no existe")
)

// ValidateSeasonName valida el alta de una temporada.
func ValidateSeasonName(name string) error {
	if strings.TrimSpace(name) == "" {
		return ErrSeasonNameRequired
	}
	return nil
}

// ValidateFunction valida los datos de una funcion, tanto al crearla como al
// editarla. El precio en cero esta permitido (una funcion a la gorra); las
// cortesias sobre funciones pagas se modelan aparte, en la venta.
func ValidateFunction(venue string, startsAt time.Time, capacity int32, priceCents int64) error {
	if strings.TrimSpace(venue) == "" {
		return ErrVenueRequired
	}
	if startsAt.IsZero() {
		return ErrStartsAtRequired
	}
	if capacity <= 0 {
		return ErrCapacityInvalid
	}
	if priceCents < 0 {
		return ErrPriceInvalid
	}
	return nil
}

// NormalizeFunctionName deja el nombre opcional de la funcion listo para
// guardar: recortado, y nil si quedo vacio.
func NormalizeFunctionName(name string) *string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
