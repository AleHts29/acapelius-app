-- name: InsertCheckin :one
-- ON CONFLICT DO NOTHING + UNIQUE(ticket_id): si el ticket ya entro, no
-- devuelve fila (pgx.ErrNoRows) y el handler responde already_checked_in.
INSERT INTO checkins (ticket_id, user_id, method, device_id, created_at)
VALUES (
  sqlc.arg(ticket_id)::bigint,
  sqlc.arg(user_id)::bigint,
  sqlc.arg(method)::text,
  sqlc.narg(device_id),
  sqlc.arg(created_at)::timestamptz
)
ON CONFLICT (ticket_id) DO NOTHING
RETURNING *;

-- name: GetCheckinByTicket :one
SELECT c.*, u.name AS by_name
FROM checkins c
JOIN users u ON c.user_id = u.id
WHERE c.ticket_id = $1;

-- name: MarkTicketCheckedIn :exec
UPDATE tickets SET status = 'checked_in' WHERE id = $1 AND status = 'issued';

-- name: CountCheckinsForFunction :one
SELECT count(*)
FROM checkins c
JOIN tickets t ON c.ticket_id = t.id
JOIN sales s ON t.sale_id = s.id
WHERE s.function_id = $1;

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
WHERE s.function_id = $1
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
WHERE s.function_id = $1
ORDER BY c.created_at;
