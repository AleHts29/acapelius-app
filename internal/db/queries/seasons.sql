-- name: CreateSeason :one
INSERT INTO seasons (name)
VALUES (sqlc.arg(name)::text)
RETURNING *;

-- name: ListSeasons :many
SELECT * FROM seasons ORDER BY created_at DESC;

-- name: GetSeason :one
SELECT * FROM seasons WHERE id = $1;
