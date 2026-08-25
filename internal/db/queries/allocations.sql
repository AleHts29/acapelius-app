-- name: UpsertAllocation :one
INSERT INTO allocations (user_id, function_id, quantity)
VALUES (sqlc.arg(user_id)::bigint, sqlc.arg(function_id)::bigint, sqlc.arg(quantity)::integer)
ON CONFLICT (user_id, function_id)
DO UPDATE SET quantity = EXCLUDED.quantity
RETURNING *;

-- name: DeleteAllocation :exec
DELETE FROM allocations
WHERE user_id = sqlc.arg(user_id)::bigint AND function_id = sqlc.arg(function_id)::bigint;

-- name: AllocationsByFunction :many
-- Asignaciones de una funcion con lo vendido por cada corista (cortesias y
-- anuladas no cuentan).
SELECT
  a.user_id,
  u.name AS seller_name,
  a.quantity AS assigned,
  (SELECT COALESCE(SUM(s.quantity), 0) FROM sales s
   WHERE s.seller_id = a.user_id AND s.function_id = a.function_id
     AND s.voided_at IS NULL AND NOT s.is_comp)::bigint AS sold
FROM allocations a
JOIN users u ON a.user_id = u.id
WHERE a.function_id = sqlc.arg(function_id)::bigint
ORDER BY u.name;

-- name: MyAllocations :many
-- Las asignaciones de una corista, con la funcion y su avance de venta.
SELECT
  a.function_id,
  f.name AS function_name,
  f.venue,
  f.starts_at,
  a.quantity AS assigned,
  (SELECT COALESCE(SUM(s.quantity), 0) FROM sales s
   WHERE s.seller_id = a.user_id AND s.function_id = a.function_id
     AND s.voided_at IS NULL AND NOT s.is_comp)::bigint AS sold
FROM allocations a
JOIN functions f ON a.function_id = f.id
WHERE a.user_id = sqlc.arg(user_id)::bigint
ORDER BY f.starts_at;

-- name: GetPublicTicket :one
-- Todo lo que necesita la pagina publica de UNA entrada (/t/{code}).
SELECT
  t.code,
  t.status,
  s.buyer_name,
  s.quantity AS sale_quantity,
  s.is_comp,
  s.voided_at,
  seller.name AS seller_name,
  f.name AS function_name,
  f.venue,
  f.starts_at,
  (SELECT count(*) FROM tickets t2 WHERE t2.sale_id = t.sale_id AND t2.id <= t.id)::bigint AS ticket_index
FROM tickets t
JOIN sales s ON t.sale_id = s.id
JOIN users seller ON s.seller_id = seller.id
JOIN functions f ON s.function_id = f.id
WHERE t.code = sqlc.arg(code)::text;
