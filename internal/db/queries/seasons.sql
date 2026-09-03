-- name: CreateSeason :one
INSERT INTO seasons (name)
VALUES (sqlc.arg(name)::text)
RETURNING *;

-- name: ListSeasons :many
-- La activa primero: el frontend la toma de aca cuando una pantalla necesita
-- "la temporada en curso" sin preguntar.
SELECT * FROM seasons ORDER BY is_active DESC, created_at DESC;

-- name: DeactivateAllSeasons :exec
UPDATE seasons SET is_active = FALSE WHERE is_active;

-- name: SetActiveSeason :exec
-- Una sola temporada en curso: activa la elegida y apaga el resto de una.
UPDATE seasons SET is_active = (id = sqlc.arg(id)::bigint);

-- name: GetSeason :one
SELECT * FROM seasons WHERE id = $1;
