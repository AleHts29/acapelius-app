-- Todas las consultas de temporadas llevan organization_id (C17 §A). Una
-- temporada pedida por id que no es de la organizacion no existe: ErrNoRows,
-- que el handler traduce a 404 y no a 403 —un 403 confirmaria que el id
-- existe en otro lado.

-- name: CreateSeason :one
-- Nace activa o no segun se pida: crearla inactiva y "restituir" la anterior
-- chocaria con el indice seasons_one_active_per_org a mitad del UPDATE.
INSERT INTO seasons (name, organization_id, is_active)
VALUES (sqlc.arg(name)::text, sqlc.arg(organization_id)::bigint, sqlc.arg(is_active)::boolean)
RETURNING *;

-- name: ListSeasons :many
-- La activa primero: el frontend la toma de aca cuando una pantalla necesita
-- "la temporada en curso" sin preguntar.
SELECT * FROM seasons
WHERE organization_id = sqlc.arg(organization_id)::bigint
ORDER BY is_active DESC, created_at DESC;

-- name: DeactivateAllSeasons :exec
-- Acotado a la organizacion: sin el WHERE, crear una temporada en un grupo
-- apagaria la temporada en curso de todos los demas.
UPDATE seasons SET is_active = FALSE
WHERE is_active AND organization_id = sqlc.arg(organization_id)::bigint;

-- name: SetActiveSeason :exec
-- Enciende una. Va siempre despues de DeactivateAllSeasons, en la misma
-- transaccion: hacerlo en un solo UPDATE (is_active = (id = $1)) choca con
-- el indice parcial seasons_one_active_per_org cuando Postgres procesa la
-- nueva antes de apagar la vieja. El indice es el que garantiza que nunca
-- haya dos en curso por organizacion.
UPDATE seasons SET is_active = TRUE
WHERE id = sqlc.arg(id)::bigint AND organization_id = sqlc.arg(organization_id)::bigint;

-- name: GetSeason :one
SELECT * FROM seasons
WHERE id = sqlc.arg(id)::bigint AND organization_id = sqlc.arg(organization_id)::bigint;

-- name: GetActiveSeason :one
SELECT * FROM seasons
WHERE is_active AND organization_id = sqlc.arg(organization_id)::bigint
LIMIT 1;

-- ============================================================================
-- Organizaciones
-- ============================================================================

-- name: GetOrganization :one
SELECT * FROM organizations WHERE id = sqlc.arg(id)::bigint;

-- name: CreateOrganization :one
INSERT INTO organizations (name, kind, slug, is_demo)
VALUES (sqlc.arg(name)::text, sqlc.arg(kind)::text, sqlc.arg(slug)::text, sqlc.arg(is_demo)::boolean)
RETURNING *;

-- name: SlugExists :one
SELECT EXISTS (SELECT 1 FROM organizations WHERE slug = sqlc.arg(slug)::text);

-- name: GetOrganizationBySlug :one
SELECT * FROM organizations WHERE slug = sqlc.arg(slug)::text;

-- name: GetUserByOrgEmail :one
-- La cuenta de una organizacion por email: la sesion de invitado de la demo
-- entra con la direccion de la organizacion demo.
SELECT * FROM users
WHERE organization_id = sqlc.arg(organization_id)::bigint AND lower(email) = lower(sqlc.arg(email)::text);
