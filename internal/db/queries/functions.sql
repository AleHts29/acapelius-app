-- name: CreateFunction :one
INSERT INTO functions (season_id, name, venue, starts_at, capacity, price_cents)
VALUES (
  sqlc.arg(season_id)::bigint,
  sqlc.narg(name),
  sqlc.arg(venue)::text,
  sqlc.arg(starts_at)::timestamptz,
  sqlc.arg(capacity)::integer,
  sqlc.arg(price_cents)::bigint
)
RETURNING *;

-- name: ListFunctions :many
-- Incluye cuantas entradas vivas tiene cada funcion (para barras de progreso
-- de venta) y cuantos ingresos ya se registraron: con ingresos, la funcion
-- queda congelada (no se edita, spec §5.1) y la pantalla tiene que saberlo
-- antes de ofrecer el formulario. Solo cuenta, no expone plata.
SELECT
  f.*,
  (SELECT count(*) FROM tickets t JOIN sales s ON t.sale_id = s.id
   WHERE s.function_id = f.id AND t.status <> 'void')::bigint AS sold,
  (SELECT count(*) FROM checkins c
   JOIN tickets t ON c.ticket_id = t.id
   JOIN sales s ON t.sale_id = s.id
   WHERE s.function_id = f.id)::bigint AS entered,
  -- Cupo repartido entre coristas activas: lo mismo que cuenta el tablero.
  (SELECT COALESCE(SUM(a.quantity), 0) FROM allocations a
   JOIN users au ON au.id = a.user_id
   WHERE a.function_id = f.id AND au.role = 'seller' AND au.is_active)::bigint AS assigned
FROM functions f
WHERE sqlc.narg(season_id)::bigint IS NULL OR f.season_id = sqlc.narg(season_id)::bigint
ORDER BY f.starts_at;

-- name: GetFunction :one
SELECT * FROM functions WHERE id = $1;

-- name: UpdateFunction :one
UPDATE functions
SET name        = sqlc.narg(name),
    venue       = sqlc.arg(venue)::text,
    starts_at   = sqlc.arg(starts_at)::timestamptz,
    capacity    = sqlc.arg(capacity)::integer,
    price_cents = sqlc.arg(price_cents)::bigint
WHERE id = sqlc.arg(id)::bigint
RETURNING *;
