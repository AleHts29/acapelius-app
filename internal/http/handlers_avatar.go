package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ale-hts/acapelius/internal/auth"
	"github.com/ale-hts/acapelius/internal/db/sqlcgen"
	"github.com/ale-hts/acapelius/internal/httpx"
)

// La foto de perfil (C21): cada persona sube la suya. La app la achica a
// 256x256 antes de mandarla; el tope de 400 KB es por si llega sin achicar.
const maxAvatarBytes = 400 << 10

var avatarTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// handlePutAvatar: PUT /api/me/avatar — el cuerpo es la imagen.
func (s *Server) handlePutAvatar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.MustUserFrom(ctx)
	// En la demo la cuenta es compartida: la foto la veria el proximo.
	if user.OrganizationIsDemo {
		httpx.Error(w, http.StatusForbidden, httpx.CodeForbidden, "En la demo no se cambia la foto.")
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxAvatarBytes+1))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "No se pudo leer la foto.")
		return
	}
	if len(data) == 0 {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "Falta la foto.")
		return
	}
	if len(data) > maxAvatarBytes {
		httpx.Error(w, http.StatusRequestEntityTooLarge, httpx.CodeValidation, "La foto es muy pesada.")
		return
	}
	// El tipo sale de los bytes, no del header: no se guarda cualquier cosa.
	tipo := http.DetectContentType(data)
	if !avatarTypes[tipo] {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeValidation, "La foto tiene que ser JPG, PNG o WebP.")
		return
	}
	at, err := s.queries.UpsertAvatar(ctx, sqlcgen.UpsertAvatarParams{
		Image: data, ContentType: tipo, UserID: user.ID, OrganizationID: s.org(ctx),
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"avatar_at": at})
}

// handleDeleteAvatar: DELETE /api/me/avatar — vuelven las iniciales.
func (s *Server) handleDeleteAvatar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.MustUserFrom(ctx)
	if err := s.queries.DeleteAvatar(ctx, sqlcgen.DeleteAvatarParams{UserID: user.ID, OrganizationID: s.org(ctx)}); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleGetAvatar: GET /api/users/{id}/avatar — la foto de alguien del mismo
// grupo. La URL lleva ?v=<fecha de la foto>: se puede cachear sin miedo.
func (s *Server) handleGetAvatar(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "No tiene foto.")
		return
	}
	ctx := r.Context()
	av, err := s.queries.GetAvatar(ctx, sqlcgen.GetAvatarParams{UserID: id, OrganizationID: s.org(ctx)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "No tiene foto.")
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	w.Header().Set("Content-Type", av.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=604800")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(av.Image)
}
