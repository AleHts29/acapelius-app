-- functions no tiene organization_id: cuelga de seasons (C17 §A.1). Toda
-- consulta llega a la organizacion por la temporada; una funcion de otra
-- organizacion no existe (ErrNoRows → 404).

-- name: CreateFunction :one
-- Solo si la temporada es de la organizacion; si no, no inserta y devuelve
-- ErrNoRows.
INSERT INTO functions (season_id, name, venue, starts_at, capacity, price_cents)
SELECT s.id,
  sqlc.narg(name),
  sqlc.arg(venue)::text,
  sqlc.arg(starts_at)::timestamptz,
  sqlc.arg(capacity)::integer,
  sqlc.arg(price_cents)::bigint
FROM seasons s
WHERE s.id = sqlc.arg(season_id)::bigint
  AND s.organization_id = sqlc.arg(organization_id)::bigint
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
  -- Cupo repartido entre coristas que siguen en la temporada de esta funcion.
  (SELECT COALESCE(SUM(a.quantity), 0) FROM allocations a
   JOIN season_members m ON m.user_id = a.user_id AND m.season_id = f.season_id
   WHERE a.function_id = f.id AND m.role = 'seller' AND m.left_at IS NULL)::bigint AS assigned,
  -- Cortesias emitidas. Es un conteo, no plata: en la puerta importa saber
  -- cuantos de los que vienen no pagaron entrada.
  (SELECT count(*) FROM tickets t JOIN sales s ON t.sale_id = s.id
   WHERE s.function_id = f.id AND s.is_comp AND t.status <> 'void')::bigint AS comp_tickets,
  -- Cuantas coristas vendieron algo para esta funcion. Tambien un conteo.
  (SELECT count(DISTINCT s.seller_id) FROM sales s
   WHERE s.function_id = f.id AND s.voided_at IS NULL)::bigint AS sellers
FROM functions f
JOIN seasons se ON se.id = f.season_id
WHERE se.organization_id = sqlc.arg(organization_id)::bigint
  AND (sqlc.narg(season_id)::bigint IS NULL OR f.season_id = sqlc.narg(season_id)::bigint)
ORDER BY f.starts_at;

-- name: GetFunction :one
SELECT f.* FROM functions f
JOIN seasons se ON se.id = f.season_id
WHERE f.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: UpdateFunction :one
UPDATE functions f
SET name        = sqlc.narg(name),
    venue       = sqlc.arg(venue)::text,
    starts_at   = sqlc.arg(starts_at)::timestamptz,
    capacity    = sqlc.arg(capacity)::integer,
    price_cents = sqlc.arg(price_cents)::bigint
FROM seasons se
WHERE se.id = f.season_id
  AND f.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
RETURNING f.*;

-- name: CountSalesForFunction :one
-- Cualquier venta, incluso anulada: si alguna vez se vendio algo, la funcion
-- ya no se puede borrar y hay que hablar de reembolsos, no de un boton.
SELECT count(*)::bigint FROM sales sa
JOIN functions f ON f.id = sa.function_id
JOIN seasons se ON se.id = f.season_id
WHERE sa.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: DeleteAllocationsForFunction :exec
DELETE FROM allocations a
USING functions f, seasons se
WHERE f.id = a.function_id AND se.id = f.season_id
  AND a.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: DeleteFunction :exec
DELETE FROM functions f
USING seasons se
WHERE se.id = f.season_id
  AND f.id = sqlc.arg(id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: CopySeasonFunctions :many
-- Duplica la grilla de una temporada en otra: mismo lugar, cupo y precio, con
-- las fechas corridas 364 dias (52 semanas exactas) para que cada funcion caiga
-- el mismo dia de la semana del año siguiente. Las fechas se ajustan despues;
-- lo que se ahorra es cargar la estructura entera a mano.
-- Las dos temporadas tienen que ser de la organizacion.
INSERT INTO functions (season_id, name, venue, starts_at, capacity, price_cents)
SELECT a.id, f.name, f.venue,
       f.starts_at + interval '364 days', f.capacity, f.price_cents
FROM functions f
JOIN seasons de ON de.id = f.season_id
JOIN seasons a  ON a.id = sqlc.arg(to_season_id)::bigint
WHERE f.season_id = sqlc.arg(from_season_id)::bigint
  AND de.organization_id = sqlc.arg(organization_id)::bigint
  AND a.organization_id  = sqlc.arg(organization_id)::bigint
ORDER BY f.starts_at
RETURNING *;
