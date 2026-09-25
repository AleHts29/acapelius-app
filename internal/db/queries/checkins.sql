-- checkins cuelga de tickets → sales → functions → seasons (C17 §A.1). Las
-- consultas por funcion exigen que la funcion sea de la organizacion; las
-- que van por ticket confian en que el handler ya resolvio el ticket con
-- GetTicketByCode (que si esta acotado).

-- name: InsertCheckin :one
-- ON CONFLICT DO NOTHING + UNIQUE(ticket_id): si el ticket ya entro, no
-- devuelve fila (pgx.ErrNoRows) y el handler responde already_checked_in.
-- Solo inserta si el ticket es de la organizacion: un id ajeno tampoco
-- devuelve fila.
INSERT INTO checkins (ticket_id, user_id, method, device_id, created_at)
SELECT t.id,
  sqlc.arg(user_id)::bigint,
  sqlc.arg(method)::text,
  sqlc.narg(device_id),
  sqlc.arg(created_at)::timestamptz
FROM tickets t
JOIN sales s ON s.id = t.sale_id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE t.id = sqlc.arg(ticket_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
ON CONFLICT (ticket_id) DO NOTHING
RETURNING *;

-- name: GetCheckinByTicket :one
SELECT c.*, u.name AS by_name
FROM checkins c
JOIN users u ON c.user_id = u.id
JOIN tickets t ON t.id = c.ticket_id
JOIN sales s ON s.id = t.sale_id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE c.ticket_id = sqlc.arg(ticket_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: MarkTicketCheckedIn :exec
UPDATE tickets t SET status = 'checked_in'
FROM sales s
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.id = t.sale_id
  AND t.id = sqlc.arg(id)::bigint AND t.status = 'issued'
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: CountCheckinsForFunction :one
SELECT count(*)
FROM checkins c
JOIN tickets t ON c.ticket_id = t.id
JOIN sales s ON t.sale_id = s.id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint;

-- name: DoorSnapshotTickets :many
-- Todo lo que la puerta necesita de cada ticket. Sin montos ni contacto:
-- el rol door no ve plata (spec §3).
SELECT
  t.code,
  t.status,
  -- sale_id agrupa las entradas de una misma compra: la busqueda por nombre
  -- muestra una fila por comprador, no tres renglones identicos.
  s.id AS sale_id,
  s.buyer_name,
  u.name AS seller_name,
  s.is_comp
FROM tickets t
JOIN sales s ON t.sale_id = s.id
JOIN users u ON s.seller_id = u.id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
ORDER BY s.buyer_name, t.id;

-- name: DoorSnapshotCheckins :many
SELECT
  t.code AS ticket_code,
  c.created_at,
  c.method,
  u.name AS by_name
FROM checkins c
JOIN tickets t ON c.ticket_id = t.id
JOIN sales s ON t.sale_id = s.id
JOIN users u ON c.user_id = u.id
JOIN functions f ON f.id = s.function_id
JOIN seasons se ON se.id = f.season_id
WHERE s.function_id = sqlc.arg(function_id)::bigint
  AND se.organization_id = sqlc.arg(organization_id)::bigint
ORDER BY c.created_at;
