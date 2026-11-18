package domain

import (
	"errors"
	"net/url"
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
	ErrMapsURLInvalid     = errors.New("el link de Google Maps no es valido: pegá el link completo, que empieza con https://")
)

// NormalizeAddress limpia la direccion de la funcion; vacia es nil (opcional).
func NormalizeAddress(address string) *string {
	trimmed := strings.TrimSpace(address)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// NormalizeMapsURL valida el link de Google Maps (opcional) y le saca lo que
// sobra: el "?g_st=ic" que agrega compartir desde el celular no hace falta y
// alarga el link que le llega al comprador por WhatsApp.
func NormalizeMapsURL(raw string) (*string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	u, err := url.Parse(trimmed)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || len(trimmed) > 500 {
		return nil, ErrMapsURLInvalid
	}
	q := u.Query()
	q.Del("g_st")
	u.RawQuery = q.Encode()
	limpio := u.String()
	return &limpio, nil
}

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
