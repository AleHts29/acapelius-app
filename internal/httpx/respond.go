// Package httpx tiene los helpers de serializacion y de errores que comparten
// los handlers y los middlewares.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
)

// Codigos de error estables que el frontend puede discriminar.
const (
	CodeBadRequest           = "bad_request"
	CodeValidation           = "validation_error"
	CodeInvalidCredentials   = "invalid_credentials"
	CodeUnauthenticated      = "unauthenticated"
	CodeForbidden            = "forbidden"
	CodeNotFound             = "not_found"
	CodeConflict             = "conflict"
	CodePasswordChangeNeeded = "password_change_required"
	CodeInternal             = "internal_error"
	CodeTooManyRequests      = "too_many_requests"
	CodeUnsupportedMediaType = "unsupported_media_type"
	CodePayloadTooLarge      = "payload_too_large"
)

// APIError es el cuerpo de toda respuesta de error de la API.
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorEnvelope struct {
	Error APIError `json:"error"`
}

// JSON escribe una respuesta JSON con el status dado.
func JSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("no se pudo escribir la respuesta JSON", "error", err)
	}
}

// NoContent responde 204.
func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

// Error escribe un error de API con codigo y mensaje (en espanol, para mostrar).
func Error(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, errorEnvelope{Error: APIError{Code: code, Message: message}})
}

// Internal registra el error real y devuelve un 500 generico, sin filtrar
// detalles internos al cliente.
func Internal(w http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "error interno",
		"error", err,
		"method", r.Method,
		"path", r.URL.Path,
	)
	Error(w, http.StatusInternalServerError, CodeInternal, "Ocurrio un error inesperado. Intentalo de nuevo.")
}

// maxBodyBytes acota el cuerpo de un request JSON. Ningun endpoint de la API
// recibe payloads grandes; el limite evita que uno malformado consuma memoria.
const maxBodyBytes = 1 << 20 // 1 MiB

// DecodeJSON parsea el cuerpo del request en dst y responde el error apropiado
// si falla. Devuelve false cuando ya escribio una respuesta.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if ct := r.Header.Get("Content-Type"); ct != "" && !isJSONContentType(ct) {
		Error(w, http.StatusUnsupportedMediaType, CodeUnsupportedMediaType, "El cuerpo tiene que ser JSON.")
		return false
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		switch {
		case errors.As(err, &maxErr):
			Error(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, "El cuerpo del pedido es demasiado grande.")
		case errors.Is(err, io.EOF):
			Error(w, http.StatusBadRequest, CodeBadRequest, "Falta el cuerpo del pedido.")
		default:
			Error(w, http.StatusBadRequest, CodeBadRequest, fmt.Sprintf("El cuerpo del pedido no es JSON valido: %v", err))
		}
		return false
	}

	// Un segundo objeto JSON en el mismo cuerpo casi siempre es un cliente roto.
	if dec.More() {
		Error(w, http.StatusBadRequest, CodeBadRequest, "El cuerpo tiene que ser un unico objeto JSON.")
		return false
	}
	return true
}

func isJSONContentType(ct string) bool {
	mediaType, _, _ := strings.Cut(ct, ";")
	return strings.EqualFold(strings.TrimSpace(mediaType), "application/json")
}
